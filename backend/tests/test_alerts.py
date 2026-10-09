"""Alert delivery avoids duplicate sends, retries failures and evaluates every configured rule."""

import asyncio
import datetime as dt
import logging
import threading
from collections.abc import Callable
from decimal import Decimal
from email.message import EmailMessage
from typing import Any, Self
from uuid import UUID, uuid4

import aiosmtplib
import httpx2 as httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.alerts import delivery, service, worker
from app.auth.service import alert_box
from app.config import Settings
from app.finance.exchange_rates import ExchangeRateClient
from app.models import (
    Account,
    AlertChannel,
    AlertDelivery,
    AlertSettings,
    AlertState,
    AlertType,
    AppSettings,
    Budget,
    BudgetAmount,
    BudgetKind,
    BudgetLink,
    BudgetPeriod,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    HistoryStatus,
    PaymentFrequency,
    RecurringKind,
    SMTPTransport,
    Subscription,
    Transaction,
    TransactionSource,
)
from app.models.base import utcnow
from app.schemas.budget import BudgetOut, PeriodSummary
from app.schemas.preferences import AlertPreferences, Preferences
from tests.finance import TODAY, add_account, add_transaction

WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/test_token"


def configured(
    session: Session,
    settings: Settings,
    *,
    discord: bool = True,
    smtp: bool = True,
) -> AlertSettings:
    row = AlertSettings(
        id=1,
        discord_enabled=discord,
        discord_webhook_url=alert_box(settings).encrypt(WEBHOOK) if discord else None,
        smtp_enabled=smtp,
        smtp_host="smtp.example.test" if smtp else None,
        smtp_port=587,
        smtp_security=SMTPTransport.STARTTLS,
        smtp_username=alert_box(settings).encrypt("smtp-user") if smtp else None,
        smtp_password=alert_box(settings).encrypt("smtp-password") if smtp else None,
        smtp_from="alerts@example.com" if smtp else None,
        smtp_to="alex@example.com" if smtp else None,
    )
    session.add(row)
    session.commit()
    return row


def preferences(session: Session, **alerts: Any) -> None:
    values = AlertPreferences(**alerts)
    row = session.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1)
    row.data = Preferences(alerts=values).model_dump(mode="json")
    session.add(row)
    session.commit()


def test_smtp_transport_passes_auth_and_security_to_latest_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[EmailMessage, dict[str, object]]] = []

    async def send(
        message: EmailMessage, **kwargs: object
    ) -> tuple[dict[str, aiosmtplib.SMTPResponse], str]:
        calls.append((message, kwargs))
        return {}, "sent"

    monkeypatch.setattr(aiosmtplib, "send", send)
    securities = [
        SMTPTransport.STARTTLS,
        SMTPTransport.SSL,
        SMTPTransport.NONE,
    ]
    for security in securities:
        connection = delivery.SMTPConnection(
            "smtp.example.test",
            2525,
            security,
            "smtp-user",
            "smtp-password",
            "alerts@example.com",
            "alex@example.com",
        )
        asyncio.run(delivery.send_email(connection, "A" * 130, "body"))

    actual = [
        (
            message["From"],
            message["To"],
            message["Subject"],
            message.get_content(),
            kwargs["username"],
            kwargs["password"],
            kwargs["use_tls"],
            kwargs["start_tls"],
            kwargs["timeout"],
        )
        for message, kwargs in calls
    ]
    expected = [
        (
            "alerts@example.com",
            "alex@example.com",
            "A" * 120,
            "body\n",
            "smtp-user",
            "smtp-password",
            security == SMTPTransport.SSL,
            security == SMTPTransport.STARTTLS,
            delivery.SMTP_TIMEOUT,
        )
        for security in securities
    ]
    assert actual == expected


def test_smtp_transport_works_without_authentication(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    async def send(
        message: EmailMessage, **kwargs: object
    ) -> tuple[dict[str, aiosmtplib.SMTPResponse], str]:
        calls.append(kwargs)
        return {}, "sent"

    monkeypatch.setattr(aiosmtplib, "send", send)
    asyncio.run(
        delivery.send_email(
            delivery.SMTPConnection(
                "mail.lan",
                25,
                SMTPTransport.NONE,
                None,
                None,
                "alerts@example.test",
                "alex@example.test",
            ),
            "Test",
            "Body",
        )
    )

    assert calls[0]["username"] is None
    assert calls[0]["password"] is None


def test_smtp_rejected_recipient_is_not_reported_as_sent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refuse(
        message: EmailMessage, **kwargs: object
    ) -> tuple[dict[str, aiosmtplib.SMTPResponse], str]:
        return {"alex@example.com": aiosmtplib.SMTPResponse(550, "Rejected")}, "refused"

    monkeypatch.setattr(aiosmtplib, "send", refuse)
    connection = delivery.SMTPConnection(
        "mail.lan",
        25,
        SMTPTransport.NONE,
        None,
        None,
        "alerts@example.com",
        "alex@example.com",
    )

    def send_email() -> None:
        asyncio.run(delivery.send_email(connection, "Test", "Body"))

    with pytest.raises(aiosmtplib.SMTPRecipientsRefused):
        send_email()


def test_smtp_subject_newlines_cannot_add_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    messages: list[EmailMessage] = []

    async def send(
        message: EmailMessage, **kwargs: object
    ) -> tuple[dict[str, aiosmtplib.SMTPResponse], str]:
        messages.append(message)
        return {}, "sent"

    monkeypatch.setattr(aiosmtplib, "send", send)
    connection = delivery.SMTPConnection(
        "mail.lan",
        25,
        SMTPTransport.NONE,
        None,
        None,
        "alerts@example.com",
        "alex@example.com",
    )
    asyncio.run(delivery.send_email(connection, "Alert\r\nBcc: hidden@example.com", "Body"))

    assert messages[0]["Subject"] == "Alert Bcc: hidden@example.com"


def test_discord_transport_limits_content_and_disables_mentions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    class Response:
        def raise_for_status(self) -> None:
            return None

    class Client:
        def __init__(self, **kwargs: object) -> None:
            assert kwargs["timeout"] == delivery.HTTP_TIMEOUT
            assert kwargs["follow_redirects"] is False

        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, *, json: dict[str, object]) -> Response:
            calls.append((url, json))
            return Response()

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    asyncio.run(delivery.send_discord(WEBHOOK, "@everyone " + "a" * 2000))

    assert calls[0][0] == WEBHOOK
    content = calls[0][1]["content"]
    assert isinstance(content, str)
    assert len(content) == delivery.DISCORD_LIMIT
    assert calls[0][1]["allowed_mentions"] == {"parse": []}


def test_alert_sends_once_per_channel_and_skips_successful_deliveries(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured(session, settings)
    sent: list[tuple[str, str]] = []

    async def discord(url: str, content: str) -> None:
        sent.append(("discord", content))

    async def email(connection: delivery.SMTPConnection, subject: str, body: str) -> None:
        sent.append(("email", subject))

    monkeypatch.setattr(delivery, "send_discord", discord)
    monkeypatch.setattr(delivery, "send_email", email)

    args = (
        session,
        settings,
        AlertType.LOW_BALANCE,
        "low_balance:account:1",
        "Low balance",
        "Balance is low.",
    )
    assert service.deliver_alert(*args)
    assert service.deliver_alert(*args)
    assert {channel for channel, _ in sent} == {"discord", "email"}
    assert len(sent) == 2
    assert all(
        row.sent_at is not None and row.attempts == 1
        for row in session.scalars(select(AlertDelivery))
    )


def test_failed_alerts_are_throttled_and_retried(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured(session, settings, smtp=False)
    calls = 0

    async def fail(url: str, content: str) -> None:
        nonlocal calls
        calls += 1
        raise OSError("A token should not be logged.")

    monkeypatch.setattr(delivery, "send_discord", fail)
    args = (
        session,
        settings,
        AlertType.SYNC_FAILURE,
        "sync:connection:1",
        "Bank sync failed",
        "The sync did not finish.",
    )
    assert service.deliver_alert(*args) is False
    row = session.scalar(select(AlertDelivery))
    assert row is not None
    assert row.attempts == 1
    assert row.last_error == "OSError"
    assert row.sent_at is None
    assert service.deliver_alert(*args) is False
    assert calls == 1

    row.last_attempt_at = utcnow() - service.RETRY_AFTER - dt.timedelta(seconds=1)
    session.commit()

    async def succeed(url: str, content: str) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(delivery, "send_discord", succeed)
    assert service.deliver_alert(*args)
    assert calls == 2
    assert row.attempts == 2
    assert row.sent_at is not None
    assert row.last_error is None


def test_alerts_are_skipped_when_disabled_or_no_channel_is_configured(
    session: Session, settings: Settings
) -> None:
    assert not service.deliver_alert(
        session, settings, AlertType.BILL_DUE, "bill:1", "Bill", "Due."
    )
    configured(session, settings, discord=False, smtp=False)
    preferences(session, bill_due_enabled=False)
    assert not service.deliver_alert(
        session, settings, AlertType.BILL_DUE, "bill:2", "Bill", "Due."
    )
    assert session.scalar(select(AlertDelivery)) is None


def test_enqueue_large_transaction_checks_preference_threshold_and_account(
    session: Session,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = add_account(session, balance="1000")
    below = add_transaction(session, account, "-500.00")
    above = add_transaction(session, account, "-501.00")
    configured(session, settings)

    assert not service.enqueue_large_transaction(session, settings, below)
    assert not service.deliver_large_transaction(session, settings, below)
    assert service.enqueue_large_transaction(session, settings, above)
    assert {(row.event_key, row.channel) for row in session.scalars(select(AlertDelivery))} == {
        (f"large_transaction:{above.id}", AlertChannel.DISCORD),
        (f"large_transaction:{above.id}", AlertChannel.EMAIL),
    }
    assert not service.enqueue_large_transaction(session, settings, above)

    preferences(session, large_transaction_enabled=False)
    assert not service.enqueue_large_transaction(session, settings, above)

    preferences(session)
    missing = Transaction(
        account_id=uuid4(),
        amount=Decimal("-900"),
        payee="Missing account",
        date=TODAY,
        source=TransactionSource.MANUAL,
    )
    original_get = session.get

    def missing_account(model: type[Any], ident: Any, *args: Any, **kwargs: Any) -> Any:
        return None if model is Account else original_get(model, ident, *args, **kwargs)

    monkeypatch.setattr(session, "get", missing_account)
    assert not service.enqueue_large_transaction(session, settings, missing)


def test_worker_delivers_queued_large_transactions(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = add_account(session)
    transaction = add_transaction(session, account, "-900")
    configured(session, settings, smtp=False)
    assert service.enqueue_large_transaction(session, settings, transaction)
    sent: list[str] = []

    async def discord(url: str, content: str) -> None:
        sent.append(content)

    monkeypatch.setattr(delivery, "send_discord", discord)
    worker.retry_pending_large_transactions(session, settings)

    rows = list(session.scalars(select(AlertDelivery)))
    assert len(rows) == 1
    assert rows[0].sent_at is not None
    assert rows[0].attempts == 1
    assert "Large transaction: Corner Market" in sent[0]


def test_low_balance_state_tracks_crossings_and_closed_accounts(session: Session) -> None:
    low = add_account(session, name="Low", balance="50")
    at_threshold = add_account(session, name="At threshold", balance="100")
    closed = add_account(
        session,
        name="Closed",
        balance="10",
        closed_at=utcnow(),
    )
    session.add_all(
        [
            AlertState(key=f"low_balance:{at_threshold.id}", active=True, episode=3),
            AlertState(key=f"low_balance:{closed.id}", active=True, episode=1),
            AlertState(key="low_balance:deleted", active=True, episode=1),
        ]
    )
    session.commit()

    first = worker.low_balance_notices(session, Decimal("100"), enabled=True)
    assert [notice.event_key for notice in first] == [f"low_balance:{low.id}:1"]
    assert session.get_one(AlertState, f"low_balance:{low.id}").episode == 1
    assert session.get_one(AlertState, f"low_balance:{at_threshold.id}").active is False
    assert session.get_one(AlertState, f"low_balance:{closed.id}").active is False
    assert session.get_one(AlertState, "low_balance:deleted").active is False

    repeated = worker.low_balance_notices(session, Decimal("100"), enabled=True)
    assert [notice.event_key for notice in repeated] == [f"low_balance:{low.id}:1"]

    low.balance = Decimal("150")
    session.commit()
    assert worker.low_balance_notices(session, Decimal("100"), enabled=True) == []
    low.balance = Decimal("50")
    session.commit()
    crossed_again = worker.low_balance_notices(session, Decimal("100"), enabled=True)
    assert [notice.event_key for notice in crossed_again] == [f"low_balance:{low.id}:2"]


def test_low_balance_state_resets_when_the_rule_is_disabled(session: Session) -> None:
    account = add_account(session, balance="20")
    state = AlertState(key=f"low_balance:{account.id}", active=True, episode=2)
    session.add(state)
    session.commit()

    assert worker.low_balance_notices(session, Decimal("100"), enabled=False) == []
    assert state.active is False
    assert state.episode == 2


def test_recurring_notices_use_each_due_window_and_ignore_inactive_or_overdue_payments(
    session: Session,
) -> None:
    account = add_account(session)
    today = dt.date(2026, 10, 9)
    session.add_all(
        [
            Subscription(
                name="Music",
                kind=RecurringKind.SUBSCRIPTION,
                payee="Music",
                amount=Decimal("10"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=account.id,
                next_due_date=today + dt.timedelta(days=2),
                active=True,
            ),
            Subscription(
                name="Power",
                kind=RecurringKind.BILL,
                payee="Power",
                amount=Decimal("100"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=account.id,
                next_due_date=today + dt.timedelta(days=5),
                active=True,
            ),
            Subscription(
                name="Late",
                kind=RecurringKind.BILL,
                payee="Late",
                amount=Decimal("20"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=account.id,
                next_due_date=today - dt.timedelta(days=1),
                active=True,
            ),
            Subscription(
                name="Paused",
                kind=RecurringKind.SUBSCRIPTION,
                payee="Paused",
                amount=Decimal("20"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=account.id,
                next_due_date=today + dt.timedelta(days=1),
                active=False,
            ),
        ]
    )
    session.commit()

    alerts = AlertPreferences(
        subscription_due_enabled=True,
        subscription_due_days_before=3,
        bill_due_enabled=True,
        bill_due_days_before=5,
    )
    notices = worker.recurring_notices(session, today, alerts)
    assert {notice.alert_type for notice in notices} == {
        AlertType.SUBSCRIPTION_DUE,
        AlertType.BILL_DUE,
    }
    assert {notice.title for notice in notices} == {"Subscription due: Music", "Bill due: Power"}
    assert (
        worker.recurring_notices(
            session,
            today,
            AlertPreferences(subscription_due_enabled=False, bill_due_enabled=False),
        )
        == []
    )


def test_budget_notices_skip_empty_disabled_or_below_threshold_budgets(
    session: Session, settings: Settings
) -> None:
    today = dt.date(2026, 10, 9)
    no_rates = settings.model_copy(update={"exchange_rate_url": ""})
    enabled = AlertPreferences(budget_threshold_enabled=True, budget_threshold_percent=90)
    assert worker.budget_notices(session, no_rates, today, enabled) == []
    assert (
        worker.budget_notices(
            session, no_rates, today, AlertPreferences(budget_threshold_enabled=False)
        )
        == []
    )

    account = add_account(session)
    budget = Budget(
        name="Groceries",
        period=BudgetPeriod.MONTHLY,
        starts_on=dt.date(2026, 10, 1),
    )
    budget.amounts.append(BudgetAmount(starts_on=dt.date(2026, 10, 1), amount=Decimal("100")))
    budget.links.append(BudgetLink(kind=BudgetKind.SPENDING, account_id=account.id))
    session.add(budget)
    session.commit()
    add_transaction(session, account, "-89.00", date=today)

    assert worker.budget_notices(session, no_rates, today, enabled) == []
    add_transaction(session, account, "-1.00", date=today)
    notices = worker.budget_notices(session, no_rates, today, enabled)
    assert len(notices) == 1
    assert notices[0].alert_type == AlertType.BUDGET_THRESHOLD
    assert notices[0].event_key == f"budget:{budget.id}:2026-10-01"
    assert notices[0].message == "Spending is 90.00 USD of 100.00 USD (90%)."


def test_budget_notice_ignores_a_zero_amount_summary(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = dt.datetime(2026, 10, 9, tzinfo=dt.UTC)
    budget = BudgetOut(
        id=uuid4(),
        name="Zero",
        period=BudgetPeriod.MONTHLY,
        starts_on=dt.date(2026, 10, 1),
        amount=Decimal("0"),
        current=PeriodSummary(
            start=dt.date(2026, 10, 1),
            end=dt.date(2026, 10, 31),
            amount=Decimal("0"),
            income=Decimal("0"),
            spent=Decimal("0"),
        ),
        created_at=now,
        updated_at=now,
    )

    def list_budgets(
        db: Session, client: ExchangeRateClient | None, today: dt.date
    ) -> list[BudgetOut]:
        return [budget]

    monkeypatch.setattr(worker, "list_budgets", list_budgets)
    session.add(Budget(name="A row", period=BudgetPeriod.MONTHLY, starts_on=dt.date(2026, 10, 1)))
    session.commit()

    assert (
        worker.budget_notices(
            session,
            settings.model_copy(update={"exchange_rate_url": ""}),
            TODAY,
            AlertPreferences(),
        )
        == []
    )


def test_retries_pending_large_transaction_deliveries(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = add_account(session)
    transaction = add_transaction(session, account, "-900")
    session.add_all(
        [
            AlertDelivery(
                event_key="large_transaction:present",
                alert_type=AlertType.LARGE_TRANSACTION,
                channel=AlertChannel.DISCORD,
                subject_id=transaction.id,
                attempts=1,
            ),
            AlertDelivery(
                event_key="large_transaction:missing",
                alert_type=AlertType.LARGE_TRANSACTION,
                channel=AlertChannel.EMAIL,
                subject_id=uuid4(),
                attempts=1,
            ),
            AlertDelivery(
                event_key="large_transaction:without-subject",
                alert_type=AlertType.LARGE_TRANSACTION,
                channel=AlertChannel.EMAIL,
                subject_id=None,
                attempts=1,
            ),
        ]
    )
    session.commit()
    retried: list[UUID] = []

    def send_large(db: Session, app_settings: Settings, row: Transaction) -> bool:
        retried.append(row.id)
        return True

    monkeypatch.setattr(worker, "deliver_large_transaction", send_large)

    worker.retry_pending_large_transactions(session, settings)

    assert retried == [transaction.id]


def test_sync_worker_checks_alerts_and_logs_failures(
    session: Session,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.plaid import worker as sync_worker

    class OneTick(threading.Event):
        def __init__(self) -> None:
            super().__init__()
            self.waits = 0

        def wait(self, timeout: float | None = None) -> bool:
            self.waits += 1
            return self.waits > 1

    def run_due(
        sessions: Callable[[], Session],
        app_settings: Settings,
        transport: httpx.BaseTransport | None = None,
    ) -> int:
        return 0

    monkeypatch.setattr(sync_worker, "run_due", run_due)
    monkeypatch.setattr(sync_worker, "TICK", 0.0)
    sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    checked: list[Session] = []

    def check_alerts(db: Session, app_settings: Settings) -> int:
        checked.append(db)
        return 0

    monkeypatch.setattr(sync_worker, "run_alert_checks", check_alerts)
    sync_worker.serve(OneTick(), sessions, settings)
    assert len(checked) == 1

    def fail(db: Session, app_settings: Settings) -> int:
        raise RuntimeError("Alert-check errors are logged.")

    monkeypatch.setattr(sync_worker, "run_alert_checks", fail)
    with caplog.at_level(logging.ERROR, logger="cashcove.sync"):
        sync_worker.serve(OneTick(), sessions, settings)
    assert caplog.records[-1].getMessage() == "Checking household alerts failed"


def test_run_alert_checks_dispatches_each_active_rule(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    today = dt.date(2026, 10, 9)
    account = add_account(session, name="Daily", balance="50")
    session.add_all(
        [
            Subscription(
                name="Stream",
                kind=RecurringKind.SUBSCRIPTION,
                payee="Stream",
                amount=Decimal("10"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=account.id,
                next_due_date=today + dt.timedelta(days=2),
                active=True,
            ),
            Subscription(
                name="Heat",
                kind=RecurringKind.BILL,
                payee="Heat",
                amount=Decimal("100"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=account.id,
                next_due_date=today + dt.timedelta(days=5),
                active=True,
            ),
            Connection(
                provider=ConnectionProvider.PLAID,
                external_id="connection-alert",
                access_token="encrypted-token",
                institution_name="Tartan Bank",
                status=ConnectionStatus.ERROR,
                error_message="Plaid is unavailable.",
                history=HistoryStatus.COMPLETE,
                last_attempt_at=dt.datetime(2026, 10, 9, 12, tzinfo=dt.UTC),
            ),
        ]
    )
    budget = Budget(
        name="Groceries",
        period=BudgetPeriod.MONTHLY,
        starts_on=dt.date(2026, 10, 1),
    )
    budget.amounts.append(BudgetAmount(starts_on=dt.date(2026, 10, 1), amount=Decimal("100")))
    budget.links.append(BudgetLink(kind=BudgetKind.SPENDING, account_id=account.id))
    session.add(budget)
    session.commit()
    add_transaction(session, account, "-100", date=today)

    notices: list[tuple[AlertType, str]] = []

    def deliver(
        db: Session,
        app_settings: Settings,
        alert_type: AlertType,
        event_key: str,
        title: str,
        message: str,
        *,
        subject_id: UUID | None = None,
    ) -> bool:
        notices.append((alert_type, event_key))
        return True

    monkeypatch.setattr(worker, "deliver_alert", deliver)

    count = worker.run_alert_checks(
        session,
        settings.model_copy(update={"exchange_rate_url": ""}),
        now=dt.datetime(2026, 10, 9, 12, tzinfo=dt.UTC),
    )

    assert count == 5
    assert {kind for kind, _ in notices} == {
        AlertType.LOW_BALANCE,
        AlertType.SUBSCRIPTION_DUE,
        AlertType.BILL_DUE,
        AlertType.BUDGET_THRESHOLD,
        AlertType.SYNC_FAILURE,
    }
    assert session.get_one(AlertState, f"low_balance:{account.id}").episode == 1


def test_run_alert_checks_resets_disabled_rules_and_handles_no_pending_alerts(
    session: Session, settings: Settings
) -> None:
    account = add_account(session, balance="20")
    session.add(AlertState(key=f"low_balance:{account.id}", active=True, episode=1))
    session.add(
        AppSettings(
            id=1,
            data=Preferences(
                alerts=AlertPreferences(
                    subscription_due_enabled=False,
                    bill_due_enabled=False,
                    low_balance_enabled=False,
                    budget_threshold_enabled=False,
                    sync_failure_enabled=False,
                )
            ).model_dump(mode="json"),
        )
    )
    session.commit()

    assert worker.run_alert_checks(session, settings) == 0
    assert session.get_one(AlertState, f"low_balance:{account.id}").active is False


def test_run_alert_checks_counts_only_delivered_notices(
    session: Session,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    add_account(session, balance="20")

    def do_not_deliver(
        db: Session,
        app_settings: Settings,
        alert_type: AlertType,
        event_key: str,
        title: str,
        message: str,
        *,
        subject_id: UUID | None = None,
    ) -> bool:
        return False

    monkeypatch.setattr(worker, "deliver_alert", do_not_deliver)

    assert (
        worker.run_alert_checks(
            session,
            settings.model_copy(update={"exchange_rate_url": ""}),
            now=dt.datetime(2026, 10, 9, 12, tzinfo=dt.UTC),
        )
        == 0
    )


def test_missing_account_does_not_send_a_large_transaction(
    session: Session, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = add_account(session)
    transaction = Transaction(
        account_id=account.id,
        amount=Decimal("-900"),
        payee="Missing account",
        date=TODAY,
        source=TransactionSource.MANUAL,
    )
    configured(session, settings, smtp=False)
    original_get = session.get

    def missing(model: type[Any], ident: Any, *args: Any, **kwargs: Any) -> Any:
        return None if model is Account else original_get(model, ident, *args, **kwargs)

    monkeypatch.setattr(session, "get", missing)
    assert service.enqueue_large_transaction(session, settings, transaction) is False


def test_low_balance_notice_amount_formatting() -> None:
    assert service.amount_text(Decimal("12.3"), "USD") == "12.30 USD"
