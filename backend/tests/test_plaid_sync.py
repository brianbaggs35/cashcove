"""Syncing, down to the edge cases: paging, Plaid changing its pages mid-read, history
arriving in stages, failures that aren't Plaid's, and the schedule's worker."""

import datetime as dt
import logging
import runpy
import signal
import sys
import threading
import uuid
from collections.abc import Callable
from typing import Any

import httpx2 as httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.service import plaid_box
from app.config import Settings
from app.finance.categories import add_suggested_categories
from app.models import (
    Account,
    Connection,
    ConnectionStatus,
    ConnectionSync,
    HistoryStatus,
    SyncTrigger,
    Transaction,
)
from app.models.base import utcnow
from app.plaid import sync as sync_module
from app.plaid import worker
from app.plaid.accounts import import_account, shared_accounts
from app.plaid.client import PlaidClient
from app.plaid.sync import KEPT_SYNCS, MUTATED, sync_connection
from e2e.plaid import KEYS, FakePlaid
from tests.plaid import rewriting, seeded, transactions_in


@pytest.fixture
def settings(settings: Settings) -> Settings:
    client_id, secret = KEYS
    return settings.model_copy(
        update={"plaid_client_id": client_id, "plaid_secret": SecretStr(secret)}
    )


@pytest.fixture
def fake() -> FakePlaid:
    return FakePlaid()


@pytest.fixture
def sessions(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def linked(
    session: Session, settings: Settings, fake: FakePlaid, key: str = "platypus"
) -> Connection:
    """A connection to one of the fake's banks with every account imported."""
    if key not in {item.bank.key for item in fake.items.values()}:
        fake.handle(
            httpx.Request(
                "POST",
                "https://sandbox.plaid.com/item/public_token/exchange",
                json={"public_token": f"public-sandbox-{key}-1"},
                headers={"PLAID-CLIENT-ID": KEYS[0], "PLAID-SECRET": KEYS[1]},
            )
        )
    connection = seeded(session, settings, fake, key)
    now = utcnow()
    for shared in shared_accounts(connection):
        session.add(import_account(connection, shared, shared.name, now))
    session.commit()
    return connection


def run(
    session: Session,
    settings: Settings,
    connection: Connection,
    transport: httpx.BaseTransport,
    trigger: SyncTrigger = SyncTrigger.MANUAL,
) -> bool:
    with PlaidClient(settings, transport=transport) as plaid:
        return sync_connection(
            session, plaid, plaid_box(settings), connection.id, trigger, default_currency="USD"
        )


def refreshed(session: Session, connection: Connection) -> Connection:
    session.expire_all()
    return session.get_one(Connection, connection.id)


def test_long_histories_arrive_over_several_pages(
    session: Session, settings: Settings, fake: FakePlaid, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.plaid.client.SYNC_PAGE_SIZE", 3)
    connection = linked(session, settings, fake)

    assert run(session, settings, connection, fake.transport)

    counts = session.scalars(select(ConnectionSync.added)).one()
    assert counts == 15
    checking = session.scalars(select(Account).where(Account.name == "Plaid Checking")).one()
    assert checking.sync_cursor == f"{checking.external_id}:8"


def test_pages_that_change_mid_read_are_read_again(
    session: Session, settings: Settings, fake: FakePlaid, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.plaid.client.SYNC_PAGE_SIZE", 3)
    connection = linked(session, settings, fake)
    calls: list[dict[str, Any]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        response = fake.handle(request)
        if request.url.path == "/transactions/sync":
            calls.append(response.json())
            # The second page of the first account's first read changes under it.
            if len(calls) == 2:
                return error_response("TRANSACTIONS_ERROR", MUTATED)
        return response

    assert run(session, settings, connection, httpx.MockTransport(handle))

    assert refreshed(session, connection).status == ConnectionStatus.HEALTHY
    assert session.scalars(select(ConnectionSync.added)).one() == 15


def error_response(error_type: str, code: str) -> httpx.Response:
    return httpx.Response(
        400,
        json={"error_type": error_type, "error_code": code, "error_message": "", "request_id": "r"},
    )


def test_pages_that_keep_changing_fail_the_sync(
    session: Session, settings: Settings, fake: FakePlaid
) -> None:
    connection = linked(session, settings, fake)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/transactions/sync":
            return error_response("TRANSACTIONS_ERROR", MUTATED)
        return fake.handle(request)

    assert run(session, settings, connection, httpx.MockTransport(handle))

    failed = refreshed(session, connection)
    assert failed.status == ConnectionStatus.ERROR
    assert failed.error_code == MUTATED
    assert session.scalar(select(func.count()).select_from(Transaction)) == 0


@pytest.mark.parametrize(
    ("statuses", "history"),
    [
        (["NOT_READY"], HistoryStatus.PENDING),
        (["INITIAL_UPDATE_COMPLETE"], HistoryStatus.RECENT),
        (["INITIAL_UPDATE_COMPLETE", "HISTORICAL_UPDATE_COMPLETE"], HistoryStatus.RECENT),
        (["HISTORICAL_UPDATE_COMPLETE"], HistoryStatus.COMPLETE),
        # Plaid can't tell, so it stays as it was.
        (["TRANSACTIONS_UPDATE_STATUS_UNKNOWN"], HistoryStatus.PENDING),
    ],
)
def test_history_arrives_in_stages(
    session: Session,
    settings: Settings,
    fake: FakePlaid,
    statuses: list[str],
    history: HistoryStatus,
) -> None:
    connection = linked(session, settings, fake)
    connection.history = HistoryStatus.PENDING
    session.commit()
    answers = iter(statuses * 3)

    def stage(body: dict[str, Any]) -> None:
        body["transactions_update_status"] = next(answers)

    run(session, settings, connection, rewriting(fake, "/transactions/sync", stage))

    assert refreshed(session, connection).history == history


def test_an_item_error_in_plaids_answer_fails_the_sync(
    session: Session, settings: Settings, fake: FakePlaid
) -> None:
    connection = linked(session, settings, fake)

    def expired(body: dict[str, Any]) -> None:
        body["item"]["error"] = {
            "error_type": "ITEM_ERROR",
            "error_code": "ITEM_LOGIN_REQUIRED",
            "error_message": "",
        }

    run(session, settings, connection, rewriting(fake, "/accounts/get", expired))

    assert refreshed(session, connection).status == ConnectionStatus.LOGIN_REQUIRED


def test_payees_fall_back_to_what_the_bank_called_it(
    session: Session, settings: Settings, fake: FakePlaid
) -> None:
    add_suggested_categories(session)
    connection = linked(session, settings, fake)
    account = fake.item("platypus").accounts[0]
    template = account.events[1][1]
    account.events[:] = [
        ("added", template | {"transaction_id": "a", "merchant_name": None, "name": "ACH DEBIT"}),
        (
            "added",
            template
            | {
                "transaction_id": "b",
                "merchant_name": " ",
                "name": None,
                "original_description": "POS 1234 ",
            },
        ),
        (
            "added",
            template
            | {
                "transaction_id": "c",
                "merchant_name": None,
                "name": None,
                "original_description": None,
                "personal_finance_category": None,
                "authorized_date": None,
            },
        ),
    ]

    run(session, settings, connection, fake.transport)

    checking = session.scalars(select(Account).where(Account.name == "Plaid Checking")).one()
    rows = {row.external_id: row for row in transactions_in(session, checking)}
    assert (rows["a"].payee, rows["a"].original_description) == ("ACH DEBIT", "WHOLE FOODS #1001")
    assert rows["b"].payee == "POS 1234"
    assert (rows["c"].payee, rows["c"].original_description, rows["c"].category_id) == (
        "Unknown payee",
        None,
        None,
    )
    assert rows["c"].date == dt.date.fromisoformat(template["date"])


def test_an_account_imported_mid_sync_waits_for_the_next_one(
    session: Session, settings: Settings, fake: FakePlaid, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = linked(session, settings, fake)
    session.delete(session.scalars(select(Account).where(Account.name == "Plaid Saving")).one())
    session.commit()
    shared = next(item for item in shared_accounts(connection) if item.name == "Plaid Saving")
    read_changes = sync_module.read_changes

    def importing(*args: Any, **kwargs: Any) -> sync_module.AccountChanges:
        # Someone imports the savings account while Plaid is being read.
        if session.scalar(select(func.count()).select_from(Account)) == 2:
            session.add(import_account(connection, shared, "Plaid Saving", utcnow()))
            session.commit()
        return read_changes(*args, **kwargs)

    monkeypatch.setattr(sync_module, "read_changes", importing)

    run(session, settings, connection, fake.transport)

    session.expire_all()
    cursors = {
        name: cursor for name, cursor in session.execute(select(Account.name, Account.sync_cursor))
    }
    assert cursors["Plaid Saving"] is None
    assert cursors["Plaid Checking"] is not None


def test_only_the_latest_syncs_are_kept(
    session: Session, settings: Settings, fake: FakePlaid
) -> None:
    connection = linked(session, settings, fake)
    for _ in range(KEPT_SYNCS + 2):
        run(session, settings, connection, fake.transport)

    assert session.scalar(select(func.count()).select_from(ConnectionSync)) == KEPT_SYNCS


def test_a_connection_removed_mid_sync_is_left_alone(
    session: Session, settings: Settings, fake: FakePlaid, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = linked(session, settings, fake)

    def removed(db: Session, connection_id: uuid.UUID) -> None:
        return None

    monkeypatch.setattr(sync_module, "_locked", removed)

    assert run(session, settings, connection, fake.transport)
    # Nothing is left to release a removed connection's sync.
    refreshed(session, connection).sync_started_at = None
    session.commit()
    fake.item("platypus").error = "ITEM_LOGIN_REQUIRED"
    assert run(session, settings, connection, fake.transport)

    assert session.scalar(select(func.count()).select_from(ConnectionSync)) == 0


@pytest.mark.parametrize("stage", ["reading", "writing"])
def test_a_sync_that_breaks_lets_the_next_one_run(
    session: Session,
    settings: Settings,
    fake: FakePlaid,
    monkeypatch: pytest.MonkeyPatch,
    stage: str,
) -> None:
    connection = linked(session, settings, fake)

    def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("bug")

    if stage == "reading":
        monkeypatch.setattr(sync_module, "read_changes", broken)
    else:
        monkeypatch.setattr(sync_module, "_apply", broken)

    with pytest.raises(RuntimeError, match="bug"):
        run(session, settings, connection, fake.transport)

    assert refreshed(session, connection).sync_started_at is None
    assert session.scalar(select(func.count()).select_from(Transaction)) == 0


# ---- The schedule's worker ---------------------------------------------------------------


def test_the_worker_does_nothing_without_plaids_keys(
    sessions: sessionmaker[Session], settings: Settings
) -> None:
    unconfigured = settings.model_copy(update={"plaid_client_id": None, "plaid_secret": None})

    assert worker.run_due(sessions, unconfigured) == 0


def test_the_worker_syncs_whatever_is_due(
    session: Session, sessions: sessionmaker[Session], settings: Settings, fake: FakePlaid
) -> None:
    due = linked(session, settings, fake)
    recent = linked(session, settings, fake, "gingham")
    recent.last_attempt_at = utcnow() - dt.timedelta(minutes=5)
    waiting = linked(session, settings, fake, "tartan")
    waiting.status = ConnectionStatus.LOGIN_REQUIRED
    nothing_imported = seeded(session, settings, fake, "fidelity")
    session.commit()

    with sessions() as db:
        assert worker.due(db) == [(due.id, SyncTrigger.SCHEDULED)]

    assert worker.run_due(sessions, settings, fake.transport) == 1
    assert worker.run_due(sessions, settings, fake.transport) == 0
    session.expire_all()
    assert session.get_one(Connection, due.id).last_synced_at is not None
    assert session.get_one(Connection, nothing_imported.id).last_attempt_at is None


def test_new_connections_are_checked_while_their_history_comes_in(
    session: Session, sessions: sessionmaker[Session], settings: Settings, fake: FakePlaid
) -> None:
    connection = linked(session, settings, fake)
    connection.history = HistoryStatus.RECENT
    connection.last_attempt_at = utcnow() - dt.timedelta(minutes=3)
    session.commit()

    with sessions() as db:
        assert worker.due(db) == [(connection.id, SyncTrigger.LINKED)]


def test_one_connections_bug_doesnt_stop_the_others(
    session: Session,
    sessions: sessionmaker[Session],
    settings: Settings,
    fake: FakePlaid,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = linked(session, settings, fake)
    linked(session, settings, fake, "gingham")
    real = sync_connection

    def flaky(
        db: Session,
        plaid: PlaidClient,
        box: Any,
        connection_id: uuid.UUID,
        *args: Any,
        **kwargs: Any,
    ) -> bool:
        if connection_id == first.id:
            raise RuntimeError("bug")
        return real(db, plaid, box, connection_id, *args, **kwargs)

    monkeypatch.setattr(worker, "sync_connection", flaky)

    with caplog.at_level(logging.ERROR, logger="cashcove.sync"):
        assert worker.run_due(sessions, settings, fake.transport) == 1

    assert f"Syncing connection {first.id} failed" in caplog.text


class Ticks(threading.Event):
    """A stop event that lets the worker check a set number of times, without waiting."""

    def __init__(self, checks: int) -> None:
        super().__init__()
        self.checks = checks

    def wait(self, timeout: float | None = None) -> bool:
        self.checks -= 1
        return self.checks < 0


def test_the_worker_checks_every_tick_until_told_to_stop(
    sessions: sessionmaker[Session],
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    runs: list[Settings] = []

    def run_due(sessions: Callable[[], Session], settings: Settings, transport: object) -> int:
        runs.append(settings)
        if len(runs) == 1:
            raise RuntimeError("database not ready")
        return 0

    monkeypatch.setattr(worker, "run_due", run_due)

    with caplog.at_level(logging.INFO, logger="cashcove.sync"):
        worker.serve(Ticks(2), sessions, settings)

    assert runs == [settings, settings]
    assert "Checking for connections to sync failed" in caplog.text
    assert "Stopped syncing" in caplog.text


def test_the_worker_stops_on_sigterm(
    sessions: sessionmaker[Session], settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    # As supervisord starts it: python -m app.plaid.worker
    stop = Ticks(0)
    monkeypatch.setattr("app.db.get_sessionmaker", lambda: sessions)
    monkeypatch.setattr("app.config.get_settings", lambda: settings)
    monkeypatch.setattr(threading, "Event", lambda: stop)
    monkeypatch.delitem(sys.modules, "app.plaid.worker")
    handlers = {signum: signal.getsignal(signum) for signum in (signal.SIGTERM, signal.SIGINT)}
    try:
        runpy.run_module("app.plaid.worker", run_name="__main__")
        shut_down = signal.getsignal(signal.SIGTERM)
        assert callable(shut_down)
        shut_down(signal.SIGTERM, None)
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)

    assert stop.is_set()
