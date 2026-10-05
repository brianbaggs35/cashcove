"""The Connect tab's API: connecting banks through Plaid, choosing which accounts to import,
syncing, reconnecting and removing them."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.service import plaid_box
from app.config import Settings, get_settings
from app.finance.categories import add_suggested_categories
from app.models import (
    Account,
    AccountSource,
    AuditEvent,
    Category,
    Connection,
    ConnectionSync,
    Transaction,
    TransactionSource,
)
from app.models.base import utcnow
from app.plaid.deps import plaid_transport
from e2e.plaid import KEYS, FakePlaid
from tests.helpers import error
from tests.plaid import (
    LOGO,
    accounts_of,
    choose,
    connect,
    plaid_ids,
    rewriting,
    seeded,
    transactions_in,
)


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
def app(app: FastAPI, fake: FakePlaid) -> FastAPI:
    app.dependency_overrides[plaid_transport] = lambda: fake.transport
    return app


@pytest.fixture(autouse=True)
def categories(session: Session) -> None:
    add_suggested_categories(session)
    session.commit()


def category(session: Session, name: str) -> uuid.UUID:
    return session.scalars(select(Category.id).where(Category.name == name)).one()


def stored(session: Session, connection_id: object) -> Connection:
    session.expire_all()
    connection = session.get(Connection, uuid.UUID(str(connection_id)))
    assert connection is not None
    return connection


def imported(client: TestClient, bank: str = "platypus") -> dict[str, Any]:
    """A bank with its checking account and credit card imported, and its savings skipped."""
    connection = connect(client, bank)
    ids = plaid_ids(connection)
    response = choose(client, connection, ids["Plaid Checking"], ids["Plaid Credit Card"])
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def sync(client: TestClient, connection: dict[str, Any], **body: str) -> dict[str, Any]:
    response = client.post(f"/api/connections/{connection['id']}/sync", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def by_name(accounts: list[Account]) -> dict[str, Account]:
    return {account.name: account for account in accounts}


# ---- Who can do what ---------------------------------------------------------------------


def test_viewers_see_connections_but_cant_change_them(
    viewer_client: TestClient, session: Session, settings: Settings, fake: FakePlaid
) -> None:
    connection = seeded(session, settings, fake)
    path = f"/api/connections/{connection.id}"

    listed = viewer_client.get("/api/connections").json()

    assert [item["institution_name"] for item in listed] == ["Tartan Bank"]
    assert viewer_client.get(path).json()["id"] == str(connection.id)
    assert viewer_client.get(f"{path}/syncs").json() == []
    for response in (
        viewer_client.post("/api/connections/link-token", json={}),
        viewer_client.post("/api/connections", json={"public_token": "public-sandbox-tartan-1"}),
        viewer_client.put(f"{path}/accounts", json={"accounts": [{"id": "e2e-card"}]}),
        viewer_client.post(f"{path}/link-token", json={}),
        viewer_client.post(f"{path}/sync", json={}),
        viewer_client.delete(path),
    ):
        assert response.status_code == 403
        assert error(response) == "admin_only"
    assert fake.link_tokens == []


def test_connecting_needs_plaids_keys(
    admin_client: TestClient, app: FastAPI, settings: Settings
) -> None:
    unconfigured = settings.model_copy(update={"plaid_client_id": None, "plaid_secret": None})
    app.dependency_overrides[get_settings] = lambda: unconfigured

    response = admin_client.post("/api/connections/link-token", json={})

    assert response.status_code == 409
    assert error(response) == "plaid_not_configured"


def test_unknown_connections_arent_found(admin_client: TestClient) -> None:
    response = admin_client.get(f"/api/connections/{uuid.uuid4()}")

    assert response.status_code == 404
    assert error(response) == "not_found"


# ---- Connecting --------------------------------------------------------------------------


def test_a_link_token_asks_for_the_history_chosen_in_settings(
    admin_client: TestClient, fake: FakePlaid, admin: Any
) -> None:
    response = admin_client.post("/api/connections/link-token", json={})

    assert response.status_code == 200
    assert response.json()["link_token"].startswith("link-sandbox-")
    sent = fake.link_tokens[-1]
    assert sent["transactions"] == {"days_requested": 730}
    assert sent["user"] == {"client_user_id": str(admin.id)}
    assert sent["language"] == "en"

    admin_client.post("/api/connections/link-token", json={"history_days": 90})

    assert fake.link_tokens[-1]["transactions"] == {"days_requested": 90}


def test_plaid_turning_down_a_link_token_is_a_bad_gateway(
    admin_client: TestClient, fake: FakePlaid
) -> None:
    fake.failures["/link/token/create"] = ("INVALID_REQUEST", "INVALID_FIELD")

    response = admin_client.post("/api/connections/link-token", json={})

    assert response.status_code == 502
    assert error(response) == "plaid_error"
    assert response.json()["detail"]["plaid_code"] == "INVALID_FIELD"


def test_connecting_lists_the_banks_accounts_to_choose_from(
    admin_client: TestClient, session: Session, settings: Settings, fake: FakePlaid
) -> None:
    connection = connect(admin_client)

    assert connection["institution_name"] == "First Platypus Bank"
    assert connection["institution_color"] == "#1f6f5c"
    assert connection["institution_url"] == "https://plaid.com"
    assert connection["institution_logo"] is None
    assert (connection["status"], connection["history"]) == ("healthy", "pending")
    assert connection["syncing"] is False
    assert connection["next_sync_at"] is None
    assert connection["last_sync"] is None
    accounts = {account["name"]: account for account in connection["accounts"]}
    assert set(accounts) == {"Plaid Checking", "Plaid Saving", "Plaid Credit Card"}
    card = accounts["Plaid Credit Card"]
    assert (card["type"], card["balance"], card["mask"], card["state"]) == (
        "credit_card",
        "-410.00",
        "3333",
        "new",
    )
    assert card["account_id"] is None
    # Nothing is imported until someone chooses.
    assert accounts_of(session, connection["id"]) == []
    row = stored(session, connection["id"])
    assert row.access_token.startswith("v1.")
    assert "access-sandbox" not in row.access_token
    assert fake.item(row.external_id).access_token == plaid_box(settings).decrypt(row.access_token)
    event = session.scalars(select(AuditEvent).where(AuditEvent.event == "bank_connected")).one()
    assert event.details == {"bank": "First Platypus Bank"}


def test_plaid_turning_down_a_public_token_is_a_bad_gateway(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/connections", json={"public_token": "public-sandbox-nowhere-1"}
    )

    assert response.status_code == 502
    assert response.json()["detail"]["plaid_code"] == "INVALID_PUBLIC_TOKEN"


def test_public_tokens_have_to_look_like_plaids(admin_client: TestClient) -> None:
    response = admin_client.post("/api/connections", json={"public_token": "access-sandbox-1"})

    assert response.status_code == 422


def test_a_bank_that_fails_after_connecting_is_removed_from_plaid(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    fake.failures["/accounts/get"] = ("API_ERROR", "INTERNAL_SERVER_ERROR")

    response = admin_client.post(
        "/api/connections", json={"public_token": "public-sandbox-platypus-1"}
    )

    assert response.status_code == 502
    assert [item.bank.key for item in fake.items.values()] == ["tartan", "fidelity"]
    assert session.scalar(select(func.count()).select_from(Connection)) == 0


def test_a_bank_plaid_wont_remove_after_failing_is_left_for_plaid(
    admin_client: TestClient, fake: FakePlaid
) -> None:
    fake.failures["/accounts/get"] = ("API_ERROR", "INTERNAL_SERVER_ERROR")
    fake.failures["/item/remove"] = ("API_ERROR", "INTERNAL_SERVER_ERROR")

    response = admin_client.post(
        "/api/connections", json={"public_token": "public-sandbox-platypus-1"}
    )

    assert response.status_code == 502
    assert "platypus" in {item.bank.key for item in fake.items.values()}


def test_the_same_bank_accounts_cant_be_connected_twice(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connect(admin_client, "platypus", 1)

    response = admin_client.post(
        "/api/connections", json={"public_token": "public-sandbox-platypus-2"}
    )

    assert response.status_code == 409
    assert error(response) == "already_connected"
    assert "First Platypus Bank is already connected" in response.json()["detail"]["message"]
    # Removed at Plaid, so it isn't billed.
    assert len([item for item in fake.items.values() if item.bank.key == "platypus"]) == 1
    assert session.scalar(select(func.count()).select_from(Connection)) == 1
    # Another bank is fine.
    connect(admin_client, "gingham")


def test_other_logins_at_the_same_bank_can_be_connected(
    admin_client: TestClient, session: Session, settings: Settings, fake: FakePlaid
) -> None:
    # Someone else's accounts at Tartan Bank, not the ones already connected.
    seeded(session, settings, fake, "tartan")

    connection = connect(admin_client, "tartan")

    assert connection["institution_name"] == "Tartan Bank"
    assert session.scalar(select(func.count()).select_from(Connection)) == 2


def test_a_bank_without_its_details_still_connects(
    admin_client: TestClient, app: FastAPI, fake: FakePlaid
) -> None:
    fake.failures["/institutions/get_by_id"] = ("INVALID_INPUT", "INVALID_INSTITUTION")

    connection = connect(admin_client)

    assert connection["institution_name"] == "First Platypus Bank"
    assert connection["institution_logo"] is None
    assert connection["institution_color"] is None

    def anonymous(body: dict[str, Any]) -> None:
        body["item"]["institution_id"] = None
        body["item"]["institution_name"] = None

    app.dependency_overrides[plaid_transport] = lambda: rewriting(fake, "/accounts/get", anonymous)

    unnamed = connect(admin_client, "gingham")

    assert unnamed["institution_name"] == "Your bank"


def test_a_banks_logo_comes_with_it(
    admin_client: TestClient, app: FastAPI, fake: FakePlaid
) -> None:
    def with_logo(body: dict[str, Any]) -> None:
        body["institution"]["logo"] = LOGO

    app.dependency_overrides[plaid_transport] = lambda: rewriting(
        fake, "/institutions/get_by_id", with_logo
    )

    connection = connect(admin_client)

    assert connection["institution_logo"] == LOGO


def test_bank_details_that_dont_look_right_are_left_out(
    admin_client: TestClient, app: FastAPI, fake: FakePlaid
) -> None:
    def odd(body: dict[str, Any]) -> None:
        body["institution"] |= {"url": "javascript:alert(1)", "primary_color": "red"}

    app.dependency_overrides[plaid_transport] = lambda: rewriting(
        fake, "/institutions/get_by_id", odd
    )

    connection = connect(admin_client)

    assert connection["institution_url"] is None
    assert connection["institution_color"] is None


# ---- Choosing accounts -------------------------------------------------------------------


def test_chosen_accounts_are_imported_with_their_history(
    admin_client: TestClient, session: Session
) -> None:
    connection = connect(admin_client)
    ids = plaid_ids(connection)

    response = choose(
        admin_client,
        connection,
        {"id": ids["Plaid Checking"], "name": "Joint checking"},
        ids["Plaid Credit Card"],
    )

    assert response.status_code == 200, response.text
    result = response.json()
    states = {account["name"]: account["state"] for account in result["accounts"]}
    assert states == {
        "Plaid Checking": "imported",
        "Plaid Saving": "skipped",
        "Plaid Credit Card": "imported",
    }
    assert result["history"] == "complete"
    assert result["last_sync"]["trigger"] == "linked"
    assert result["last_sync"]["added"] == 15
    assert result["next_sync_at"] is not None
    accounts = by_name(accounts_of(session, connection["id"]))
    assert set(accounts) == {"Joint checking", "Plaid Credit Card"}
    checking, card = accounts["Joint checking"], accounts["Plaid Credit Card"]
    assert {item["account_id"] for item in result["accounts"]} == {
        str(checking.id),
        str(card.id),
        None,
    }
    assert (checking.source, checking.institution, checking.balance) == (
        AccountSource.PLAID,
        "First Platypus Bank",
        Decimal("110.00"),
    )
    assert checking.available_balance == Decimal("100.00")
    assert (card.balance, card.credit_limit) == (Decimal("-410.00"), Decimal("2000.00"))
    assert card.sync_cursor == f"{card.external_id}:7"
    assert stored(session, connection["id"]).skipped_accounts == [ids["Plaid Saving"]]

    history = transactions_in(session, checking)
    assert len(history) == 8
    paychecks = [item for item in history if item.payee == "Acme Corp Payroll"]
    assert [item.amount for item in paychecks] == [Decimal("2450.00")] * 2
    assert {item.category_id for item in paychecks} == {category(session, "Paycheck")}
    groceries = next(item for item in history if item.payee == "Whole Foods")
    assert groceries.amount == Decimal("-84.12")
    assert groceries.category_id == category(session, "Groceries")
    assert groceries.original_description == "WHOLE FOODS #1001"
    assert groceries.source == TransactionSource.PLAID
    coffee = next(item for item in transactions_in(session, card) if item.payee == "Starbucks")
    assert coffee.pending is True
    assert coffee.category_id == category(session, "Coffee")


def test_the_first_choice_can_rename_nothing_and_skip_nothing(
    admin_client: TestClient, session: Session
) -> None:
    connection = connect(admin_client)

    response = choose(admin_client, connection, *plaid_ids(connection).values())

    assert response.status_code == 200
    assert {account["state"] for account in response.json()["accounts"]} == {"imported"}
    assert len(accounts_of(session, connection["id"])) == 3


def test_an_account_imported_later_brings_its_whole_history(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    ids = plaid_ids(connection)

    response = choose(
        admin_client,
        connection,
        ids["Plaid Checking"],
        ids["Plaid Credit Card"],
        {"id": ids["Plaid Saving"], "name": "Rainy day"},
    )

    assert response.json()["last_sync"]["trigger"] == "manual"
    accounts = by_name(accounts_of(session, connection["id"]))
    assert accounts["Rainy day"].balance == Decimal("210.00")
    assert len(transactions_in(session, accounts["Rainy day"])) == 0
    # The others weren't imported twice.
    assert len(transactions_in(session, accounts["Plaid Checking"])) == 8


def test_accounts_left_out_later_stay_kept_by_hand(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    ids = plaid_ids(connection)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]

    response = choose(
        admin_client, connection, {"id": ids["Plaid Checking"], "name": "Household checking"}
    )

    assert response.status_code == 200
    states = {account["name"]: account["state"] for account in response.json()["accounts"]}
    assert states["Plaid Credit Card"] == "skipped"
    session.expire_all()
    kept = session.get(Account, card.id)
    assert kept is not None
    assert (kept.source, kept.connection_id, kept.external_id) == (AccountSource.MANUAL, None, None)
    assert len(transactions_in(session, kept)) == 7
    assert [account.name for account in accounts_of(session, connection["id"])] == [
        "Household checking"
    ]


def test_accounts_left_out_can_be_deleted_instead(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    ids = plaid_ids(connection)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]

    choose(admin_client, connection, ids["Plaid Checking"], removed="delete")

    session.expire_all()
    assert session.get(Account, card.id) is None
    assert (
        session.scalar(
            select(func.count()).select_from(Transaction).where(Transaction.account_id == card.id)
        )
        == 0
    )


def test_an_account_the_bank_stopped_sharing_is_left_for_the_sync(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    ids = plaid_ids(connection)
    fake.item("platypus").hidden.add(ids["Plaid Credit Card"])
    row = stored(session, connection["id"])
    row.available_accounts = [
        account for account in row.available_accounts if account["name"] != "Plaid Credit Card"
    ]
    session.commit()

    response = choose(admin_client, connection, ids["Plaid Checking"], removed="delete")

    assert response.status_code == 200
    assert [account.name for account in accounts_of(session, connection["id"])] == [
        "Plaid Checking"
    ]
    # Not deleted with the accounts left out: the sync kept it, by hand, with its history.
    card = session.scalars(select(Account).where(Account.name == "Plaid Credit Card")).one()
    assert card.source == AccountSource.MANUAL
    assert len(transactions_in(session, card)) == 7


def test_an_account_the_bank_doesnt_share_cant_be_chosen(admin_client: TestClient) -> None:
    connection = connect(admin_client)

    response = choose(admin_client, connection, "not-shared")

    assert response.status_code == 422
    assert error(response) == "unknown_account"


def test_at_least_one_account_has_to_be_chosen(admin_client: TestClient) -> None:
    connection = connect(admin_client)

    assert choose(admin_client, connection).status_code == 422


def test_deleting_an_imported_account_skips_it(admin_client: TestClient, session: Session) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]

    assert admin_client.delete(f"/api/accounts/{card.id}").status_code == 204

    states = {
        account["name"]: account["state"]
        for account in admin_client.get(f"/api/connections/{connection['id']}").json()["accounts"]
    }
    assert states["Plaid Credit Card"] == "skipped"


# ---- Syncing -----------------------------------------------------------------------------


def test_new_transactions_arrive_with_the_next_sync(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    checking = by_name(accounts_of(session, connection["id"]))["Plaid Checking"]
    groceries = next(
        item for item in transactions_in(session, checking) if item.payee == "Whole Foods"
    )
    admin_client.patch(
        f"/api/transactions/{groceries.id}",
        json={"category_id": str(category(session, "Restaurants"))},
    )
    fake.add_transaction(
        "platypus",
        str(checking.external_id),
        "23.10",
        "Whole Foods",
        "GENERAL_MERCHANDISE_SUPERSTORES",
    )

    result = sync(admin_client, connection)

    last = result["last_sync"]
    assert (last["trigger"], last["succeeded"], last["added"]) == ("manual", True, 1)
    newest = transactions_in(session, checking)[0]
    assert (newest.payee, newest.amount) == ("Whole Foods", Decimal("-23.10"))
    # The household's own category for the payee wins over Plaid's.
    assert newest.category_id == category(session, "Restaurants")
    assert result["last_synced_at"] is not None
    assert len(admin_client.get(f"/api/connections/{connection['id']}/syncs").json()) == 2


def test_the_bank_changing_and_dropping_transactions_is_followed(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    account = next(item for item in fake.item("platypus").accounts if item.subtype == "credit card")
    events = {kind_tx[1]["merchant_name"]: kind_tx[1] for kind_tx in account.events}
    rows = {item.payee: item for item in transactions_in(session, card)}
    # The household renames the pending coffee, notes it and deletes Best Buy.
    admin_client.patch(
        f"/api/transactions/{rows['Starbucks'].id}",
        json={"payee": "Morning coffee", "notes": "With Sam"},
    )
    admin_client.delete(f"/api/transactions/{rows['Best Buy'].id}")
    admin_client.patch(f"/api/transactions/{rows['Uber'].id}", json={"payee": "Uber to airport"})
    posted = events["Starbucks"] | {
        "transaction_id": "posted-coffee",
        "pending": False,
        "pending_transaction_id": events["Starbucks"]["transaction_id"],
        "amount": 6.83,
    }
    account.events += [
        ("added", posted),
        ("removed", events["Starbucks"]),
        ("modified", events["Uber"] | {"amount": 25.18, "name": "UBER *TRIP"}),
        ("modified", events["Best Buy"] | {"amount": 99.99}),
        ("removed", events["Netflix"]),
        ("removed", {"transaction_id": "never-seen"}),
    ]

    last = sync(admin_client, connection)["last_sync"]

    assert (last["added"], last["updated"], last["removed"]) == (1, 1, 2)
    after = {item.payee: item for item in transactions_in(session, card)}
    coffee = after["Morning coffee"]
    assert (coffee.external_id, coffee.pending, coffee.amount, coffee.notes) == (
        "posted-coffee",
        False,
        Decimal("-6.83"),
        "With Sam",
    )
    assert coffee.category_id == category(session, "Coffee")
    assert after["Uber to airport"].amount == Decimal("-25.18")
    assert "Netflix" not in after
    assert "Best Buy" not in after


def test_a_sync_with_nothing_new_changes_nothing(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    account = fake.item("platypus").accounts[0]
    # Plaid sends a transaction Cashcove already has again, unchanged.
    account.events.append(("added", account.events[1][1]))

    last = sync(admin_client, connection)["last_sync"]

    assert (last["added"], last["updated"], last["removed"]) == (0, 0, 0)


def test_an_account_the_bank_stops_sharing_is_kept_by_hand(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    fake.item("platypus").hidden.add(str(card.external_id))

    result = sync(admin_client, connection)

    assert "Plaid Credit Card" not in {account["name"] for account in result["accounts"]}
    session.expire_all()
    kept = session.get(Account, card.id)
    assert kept is not None
    assert kept.source == AccountSource.MANUAL
    assert len(transactions_in(session, kept)) == 7


def test_a_bank_that_wants_a_new_sign_in_waits_for_a_reconnect(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    fake.item("platypus").error = "ITEM_LOGIN_REQUIRED"

    result = sync(admin_client, connection)

    assert result["status"] == "login_required"
    assert result["error_code"] == "ITEM_LOGIN_REQUIRED"
    assert "sign in again" in result["error_message"]
    assert result["next_sync_at"] is None
    assert result["last_sync"]["succeeded"] is False
    assert result["last_sync"]["error_message"] == result["error_message"]

    token = admin_client.post(
        f"/api/connections/{connection['id']}/link-token", json={"mode": "reconnect"}
    )

    assert token.status_code == 200
    sent = fake.link_tokens[-1]
    assert sent["access_token"] == fake.item("platypus").access_token
    assert "products" not in sent
    assert "update" not in sent

    fixed = sync(admin_client, connection, reason="reconnected")

    assert (fixed["status"], fixed["error_code"], fixed["error_message"]) == (
        "healthy",
        None,
        None,
    )
    assert fixed["last_sync"]["trigger"] == "reconnected"


def test_a_bank_plaid_cant_get_transactions_from_says_so_and_recovers_by_itself(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    """Some banks connect fine and then share nothing: Plaid answers every request, says the
    history is complete, and has no transactions. Cashcove says what's wrong rather than that
    it's up to date, and brings the history in once the bank shares it."""
    connection = connect(admin_client)
    ids = plaid_ids(connection)
    fake.item("platypus").feed_down = True

    chosen = choose(admin_client, connection, ids["Plaid Checking"], ids["Plaid Credit Card"])

    assert chosen.status_code == 200
    down = chosen.json()
    assert (down["status"], down["error_code"]) == ("error", "BANK_DATA_UNAVAILABLE")
    assert "Plaid can't get transactions from First Platypus Bank" in down["error_message"]
    assert "Import tab" in down["error_message"]
    assert down["last_sync"]["succeeded"] is False
    assert down["last_sync"]["error_message"] == down["error_message"]
    assert down["last_synced_at"] is None
    assert session.scalar(select(func.count()).select_from(Transaction)) == 0

    # It stays connected, and keeps checking on the usual schedule.
    assert {account["state"] for account in down["accounts"]} == {"imported", "skipped"}
    assert down["next_sync_at"] is not None

    fake.item("platypus").feed_down = False
    recovered = sync(admin_client, connection)

    assert (recovered["status"], recovered["error_code"], recovered["error_message"]) == (
        "healthy",
        None,
        None,
    )
    assert recovered["last_sync"]["added"] == 15
    assert session.scalar(select(func.count()).select_from(Transaction)) == 15


def test_link_can_change_which_accounts_a_bank_shares(
    admin_client: TestClient, fake: FakePlaid
) -> None:
    connection = imported(admin_client)

    admin_client.post(f"/api/connections/{connection['id']}/link-token", json={"mode": "accounts"})

    assert fake.link_tokens[-1]["update"] == {"account_selection_enabled": True}


def test_only_one_sync_runs_at_a_time(admin_client: TestClient, session: Session) -> None:
    connection = imported(admin_client)
    row = stored(session, connection["id"])
    row.sync_started_at = utcnow() - dt.timedelta(minutes=1)
    session.commit()

    assert admin_client.get(f"/api/connections/{connection['id']}").json()["syncing"] is True
    response = admin_client.post(f"/api/connections/{connection['id']}/sync", json={})

    assert response.status_code == 409
    assert error(response) == "already_syncing"

    # One that never finished is given up on.
    row = stored(session, connection["id"])
    row.sync_started_at = utcnow() - dt.timedelta(minutes=11)
    session.commit()

    assert sync(admin_client, connection)["syncing"] is False


def test_an_access_token_the_secret_key_cant_open_fails_the_sync(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    row = stored(session, connection["id"])
    row.access_token = plaid_box(
        Settings(secret_key=SecretStr("another-secret-key-that-is-long-enough"))
    ).encrypt("access-sandbox-platypus-1")
    session.commit()

    result = sync(admin_client, connection)

    assert result["status"] == "error"
    assert result["error_code"] == "INVALID_ACCESS_TOKEN"

    response = admin_client.post(f"/api/connections/{connection['id']}/link-token", json={})

    assert response.status_code == 409
    assert error(response) == "connection_lost"


# ---- Removing ----------------------------------------------------------------------------


def test_removing_a_bank_keeps_its_accounts_by_default(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    accounts = accounts_of(session, connection["id"])

    response = admin_client.delete(f"/api/connections/{connection['id']}")

    assert response.status_code == 204
    assert "platypus" not in {item.bank.key for item in fake.items.values()}
    session.expire_all()
    assert session.get(Connection, uuid.UUID(connection["id"])) is None
    assert session.scalar(select(func.count()).select_from(ConnectionSync)) == 0
    for account in accounts:
        kept = session.get(Account, account.id)
        assert kept is not None
        assert kept.source == AccountSource.MANUAL
    event = session.scalars(select(AuditEvent).where(AuditEvent.event == "bank_disconnected")).one()
    assert event.details == {"bank": "First Platypus Bank", "accounts": 2, "kept_accounts": True}


def test_removing_a_bank_can_delete_its_accounts(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    accounts = accounts_of(session, connection["id"])

    response = admin_client.delete(
        f"/api/connections/{connection['id']}", params={"keep_accounts": "false"}
    )

    assert response.status_code == 204
    session.expire_all()
    assert all(session.get(Account, account.id) is None for account in accounts)
    assert session.scalar(select(func.count()).select_from(Transaction)) == 0


def test_a_bank_plaid_already_forgot_can_be_removed(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    item = fake.item("platypus")
    del fake.items[item.access_token]

    assert admin_client.delete(f"/api/connections/{connection['id']}").status_code == 204


def test_plaid_refusing_a_removal_keeps_the_connection(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    fake.failures["/item/remove"] = ("API_ERROR", "INTERNAL_SERVER_ERROR")

    response = admin_client.delete(f"/api/connections/{connection['id']}")

    assert response.status_code == 502
    assert stored(session, connection["id"]).institution_name == "First Platypus Bank"


def test_banks_can_be_removed_without_plaids_keys(
    admin_client: TestClient, app: FastAPI, session: Session, settings: Settings
) -> None:
    connection = imported(admin_client)
    unconfigured = settings.model_copy(update={"plaid_client_id": None, "plaid_secret": None})
    app.dependency_overrides[get_settings] = lambda: unconfigured

    assert admin_client.delete(f"/api/connections/{connection['id']}").status_code == 204


def test_a_bank_whose_token_is_lost_can_still_be_removed(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    row = stored(session, connection["id"])
    row.access_token = "v1.lost"
    session.commit()

    assert admin_client.delete(f"/api/connections/{connection['id']}").status_code == 204


# ---- Transactions from a bank ------------------------------------------------------------


def test_a_banks_transactions_can_be_edited_once_its_account_is_kept_by_hand(
    admin_client: TestClient, session: Session
) -> None:
    connection = imported(admin_client)
    ids = plaid_ids(connection)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    transaction = transactions_in(session, card)[0]
    path = f"/api/transactions/{transaction.id}"

    linked = admin_client.patch(path, json={"amount": "-1.00"})

    assert linked.status_code == 409
    assert error(linked) == "from_bank"

    choose(admin_client, connection, ids["Plaid Checking"])

    response = admin_client.patch(path, json={"amount": "-1.00"})

    assert response.status_code == 200, response.text
    assert response.json()["amount"] == "-1.00"


def test_what_the_bank_sends_is_sorted_by_automations_and_subscriptions(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    item = fake.item("platypus")
    shopping, entertainment = category(session, "Shopping"), category(session, "Entertainment")
    admin_client.post(
        "/api/automations",
        json={
            "name": "Coffee runs",
            "payees": ["starbucks"],
            "category_id": str(shopping),
            "apply_to": "future",
        },
    )
    subscription = admin_client.post(
        "/api/subscriptions",
        json={
            "name": "Netflix",
            "payee": "Netflix",
            "amount": "15.49",
            "frequency": "monthly",
            "account_id": str(card.id),
            "next_due_date": utcnow().date().isoformat(),
            "category_id": str(entertainment),
        },
    ).json()
    fake.add_transaction(
        item.item_id, str(card.external_id), "6.10", "Starbucks", "FOOD_AND_DRINK_COFFEE"
    )
    fake.add_transaction(
        item.item_id, str(card.external_id), "15.49", "Netflix", "ENTERTAINMENT_TV_AND_MOVIES"
    )

    last = sync(admin_client, connection)["last_sync"]

    assert last["added"] == 2
    rows = [row for row in transactions_in(session, card) if row.date == utcnow().date()]
    by_payee = {
        row.payee: row for row in rows if row.amount in (Decimal("-6.10"), Decimal("-15.49"))
    }
    # Plaid called the coffee Coffee, and the automation put it in Shopping.
    assert by_payee["Starbucks"].category_id == shopping
    netflix = by_payee["Netflix"]
    assert (netflix.subscription_id, netflix.category_id) == (
        uuid.UUID(subscription["id"]),
        entertainment,
    )
    updated = admin_client.get(f"/api/subscriptions/{subscription['id']}").json()
    assert updated["last_payment_on"] == utcnow().date().isoformat()
    assert updated["next_due_date"] > utcnow().date().isoformat()


def test_what_the_bank_sends_is_linked_to_bills_by_their_payee_and_by_automations(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    item = fake.item("platypus")
    utilities = category(session, "Utilities")
    today = utcnow().date()
    own = admin_client.post(
        "/api/bills",
        json={
            "name": "Phone",
            "payee": "Tartan Mobile",
            "amount": "55.00",
            "frequency": "monthly",
            "account_id": str(card.id),
            "next_due_date": today.isoformat(),
            "category_id": str(utilities),
        },
    ).json()
    by_automation = admin_client.post(
        "/api/bills",
        json={
            "name": "Water",
            "payee": "Not what Plaid calls it",
            "amount": "40.00",
            "amount_varies": True,
            "frequency": "monthly",
            "account_id": str(card.id),
            "next_due_date": today.isoformat(),
        },
    ).json()
    admin_client.post(
        "/api/automations",
        json={
            "name": "Water",
            "payees": ["metro water"],
            "match": "contains",
            "subscription_id": by_automation["id"],
            "apply_to": "future",
        },
    )
    fake.add_transaction(
        item.item_id,
        str(card.external_id),
        "55.00",
        "Tartan Mobile",
        "RENT_AND_UTILITIES_TELEPHONE",
    )
    fake.add_transaction(
        item.item_id,
        str(card.external_id),
        "41.20",
        "Metro Water District",
        "RENT_AND_UTILITIES_WATER",
    )
    fake.add_transaction(
        item.item_id, str(card.external_id), "9.00", "Corner Cafe", "FOOD_AND_DRINK_COFFEE"
    )

    last = sync(admin_client, connection)["last_sync"]

    assert last["added"] == 3
    by_payee = {row.payee: row for row in transactions_in(session, card) if row.date == today}
    assert by_payee["Tartan Mobile"].subscription_id == uuid.UUID(own["id"])
    assert by_payee["Tartan Mobile"].category_id == utilities
    assert by_payee["Metro Water District"].subscription_id == uuid.UUID(by_automation["id"])
    assert by_payee["Corner Cafe"].subscription_id is None
    for bill in (own, by_automation):
        updated = admin_client.get(f"/api/bills/{bill['id']}").json()
        assert (updated["kind"], updated["payment_count"]) == ("bill", 1)
        assert updated["next_due_date"] > today.isoformat()


def test_what_the_household_chose_for_a_pending_transaction_survives_it_posting(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    account = next(item for item in fake.item("platypus").accounts if item.subtype == "credit card")
    pending = {event[1]["merchant_name"]: event[1] for event in account.events}["Starbucks"]
    shopping, restaurants = category(session, "Shopping"), category(session, "Restaurants")
    admin_client.post(
        "/api/automations",
        json={
            "name": "Coffee runs",
            "payees": ["starbucks"],
            "category_id": str(shopping),
            "apply_to": "future",
        },
    )
    row = {item.payee: item for item in transactions_in(session, card)}["Starbucks"]
    admin_client.patch(f"/api/transactions/{row.id}", json={"category_id": str(restaurants)})
    posted = pending | {
        "transaction_id": "posted-coffee",
        "pending": False,
        "pending_transaction_id": pending["transaction_id"],
    }
    account.events += [("added", posted), ("removed", pending)]

    sync(admin_client, connection)

    after = {item.external_id: item for item in transactions_in(session, card)}
    assert after["posted-coffee"].category_id == restaurants

    # Had they taken the category away, the automation would sort the posted one.
    second = posted | {
        "transaction_id": "posted-again",
        "pending_transaction_id": "posted-coffee",
    }
    admin_client.patch(f"/api/transactions/{after['posted-coffee'].id}", json={"category_id": None})
    account.events += [("added", second), ("removed", posted)]
    sync(admin_client, connection)
    again = {item.external_id: item for item in transactions_in(session, card)}
    assert again["posted-again"].category_id == shopping


def test_what_the_bank_calls_a_transaction_is_found_too(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    item = fake.item("platypus")
    shopping = category(session, "Shopping")
    # Plaid names it Starbucks, and the bank calls it STARBUCKS #1000, which a statement file
    # would call it too; so one automation can sort what comes either way.
    admin_client.post(
        "/api/automations",
        json={
            "name": "Coffee runs",
            "payees": ["starbucks #"],
            "match": "contains",
            "category_id": str(shopping),
            "apply_to": "all",
        },
    )
    fake.add_transaction(
        item.item_id, str(card.external_id), "6.10", "Starbucks", "FOOD_AND_DRINK_COFFEE"
    )

    sync(admin_client, connection)

    rows = [row for row in transactions_in(session, card) if row.payee == "Starbucks"]
    assert len(rows) == 2
    assert {row.category_id for row in rows} == {shopping}


def test_a_transaction_the_bank_changes_is_sorted_by_what_it_now_is(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    account = next(item for item in fake.item("platypus").accounts if item.subtype == "credit card")
    events = {kind_tx[1]["merchant_name"]: kind_tx[1] for kind_tx in account.events}
    shopping = category(session, "Shopping")
    # Only what costs at least 20 is sorted, and Uber came to less.
    admin_client.post(
        "/api/automations",
        json={
            "name": "Rides",
            "payees": ["uber"],
            "category_id": str(shopping),
            "min_amount": "20.00",
            "apply_to": "future",
        },
    )
    before = {item.payee: item for item in transactions_in(session, card)}["Uber"]
    assert before.category_id != shopping
    account.events += [("modified", events["Uber"] | {"amount": 25.18})]

    last = sync(admin_client, connection)["last_sync"]

    assert last["updated"] == 1
    session.expire_all()
    after = {item.payee: item for item in transactions_in(session, card)}["Uber"]
    assert (after.amount, after.category_id) == (Decimal("-25.18"), shopping)


def test_a_category_chosen_for_a_pending_transaction_is_still_chosen_when_it_posts(
    admin_client: TestClient, session: Session, fake: FakePlaid
) -> None:
    connection = imported(admin_client)
    card = by_name(accounts_of(session, connection["id"]))["Plaid Credit Card"]
    account = next(item for item in fake.item("platypus").accounts if item.subtype == "credit card")
    pending = {event[1]["merchant_name"]: event[1] for event in account.events}["Starbucks"]
    shopping, restaurants = category(session, "Shopping"), category(session, "Restaurants")
    row = {item.payee: item for item in transactions_in(session, card)}["Starbucks"]
    admin_client.patch(f"/api/transactions/{row.id}", json={"category_id": str(restaurants)})
    posted = pending | {
        "transaction_id": "posted-coffee",
        "pending": False,
        "pending_transaction_id": pending["transaction_id"],
    }
    account.events += [("added", posted), ("removed", pending)]
    sync(admin_client, connection)

    # An automation made after, which covers the past, leaves what the household chose.
    created = admin_client.post(
        "/api/automations",
        json={
            "name": "Coffee runs",
            "payees": ["starbucks"],
            "category_id": str(shopping),
            "apply_to": "all",
        },
    )

    assert created.json()["applied"] == 0
    session.expire_all()
    after = {item.external_id: item for item in transactions_in(session, card)}
    assert (after["posted-coffee"].category_id, after["posted-coffee"].category_chosen) == (
        restaurants,
        True,
    )
