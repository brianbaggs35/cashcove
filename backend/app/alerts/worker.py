"""Find alerts whose conditions have become true and retry any unsent channel deliveries."""

import datetime as dt
from contextlib import nullcontext
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.alerts.service import amount_text, deliver_alert, deliver_large_transaction
from app.auth.service import load_preferences
from app.config import Settings
from app.finance.budget import list_budgets
from app.finance.exchange_rates import ExchangeRateClient
from app.models import (
    Account,
    AlertDelivery,
    AlertState,
    AlertType,
    Budget,
    Connection,
    ConnectionStatus,
    RecurringKind,
    Subscription,
    Transaction,
)
from app.models.base import utcnow
from app.schemas.preferences import AlertPreferences


@dataclass(frozen=True)
class Notice:
    alert_type: AlertType
    event_key: str
    title: str
    message: str


def low_balance_notices(db: Session, threshold: Decimal, enabled: bool) -> list[Notice]:
    accounts = list(db.scalars(select(Account)))
    account_keys = {f"low_balance:{account.id}" for account in accounts}
    states = list(db.scalars(select(AlertState).where(AlertState.key.like("low_balance:%"))))
    by_key = {state.key: state for state in states}
    notices: list[Notice] = []
    for saved_state in states:
        if saved_state.key not in account_keys:
            saved_state.active = False
    for account in accounts:
        key = f"low_balance:{account.id}"
        state = by_key.get(key)
        if state is None:
            state = AlertState(key=key, active=False, episode=0)
            db.add(state)
        is_low = enabled and account.closed_at is None and account.balance < threshold
        if not is_low:
            state.active = False
            continue
        if not state.active:
            state.active = True
            state.episode += 1
        notices.append(
            Notice(
                AlertType.LOW_BALANCE,
                f"{key}:{state.episode}",
                f"Low balance: {account.name}",
                f"Balance is {amount_text(account.balance, account.currency)}.",
            )
        )
    return notices


def recurring_notices(db: Session, today: dt.date, alerts: AlertPreferences) -> list[Notice]:
    notices: list[Notice] = []
    for kind, enabled_name, days_name in (
        (RecurringKind.SUBSCRIPTION, "subscription_due_enabled", "subscription_due_days_before"),
        (RecurringKind.BILL, "bill_due_enabled", "bill_due_days_before"),
    ):
        if not getattr(alerts, enabled_name):
            continue
        latest = today + dt.timedelta(days=getattr(alerts, days_name))
        for payment in db.scalars(
            select(Subscription).where(
                Subscription.kind == kind,
                Subscription.active.is_(True),
                Subscription.next_due_date >= today,
                Subscription.next_due_date <= latest,
            )
        ):
            alert_type = (
                AlertType.SUBSCRIPTION_DUE
                if kind == RecurringKind.SUBSCRIPTION
                else AlertType.BILL_DUE
            )
            notices.append(
                Notice(
                    alert_type,
                    f"{kind.value}:{payment.id}:{payment.next_due_date.isoformat()}",
                    f"{'Subscription' if kind == RecurringKind.SUBSCRIPTION else 'Bill'} due: "
                    f"{payment.name}",
                    f"{payment.name} is due on {payment.next_due_date.isoformat()}.",
                )
            )
    return notices


def budget_notices(
    db: Session, settings: Settings, today: dt.date, alerts: AlertPreferences
) -> list[Notice]:
    if not alerts.budget_threshold_enabled:
        return []
    if db.scalar(select(Budget.id).limit(1)) is None:
        return []
    with ExchangeRateClient(settings) if settings.exchange_rate_url else nullcontext(None) as rates:
        budgets = list_budgets(db, rates, today)
    notices: list[Notice] = []
    percent = alerts.budget_threshold_percent
    currency = load_preferences(db).general.currency
    for budget in budgets:
        if (
            budget.current.amount <= 0
            or budget.current.spent * 100 < budget.current.amount * percent
        ):
            continue
        notices.append(
            Notice(
                AlertType.BUDGET_THRESHOLD,
                f"budget:{budget.id}:{budget.current.start.isoformat()}",
                f"Budget limit: {budget.name}",
                f"Spending is {amount_text(budget.current.spent, currency)} of "
                f"{amount_text(budget.current.amount, currency)} ({percent}%).",
            )
        )
    return notices


def sync_notices(db: Session) -> list[Notice]:
    notices: list[Notice] = []
    for connection in db.scalars(
        select(Connection).where(Connection.status != ConnectionStatus.HEALTHY)
    ):
        attempt = (
            connection.last_attempt_at.isoformat() if connection.last_attempt_at else "unknown"
        )
        notices.append(
            Notice(
                AlertType.SYNC_FAILURE,
                f"sync:{connection.id}:{attempt}",
                f"Bank sync problem: {connection.institution_name}",
                connection.error_message or "The bank connection needs attention.",
            )
        )
    return notices


def retry_pending_large_transactions(db: Session, settings: Settings) -> None:
    transaction_ids = set(
        db.scalars(
            select(AlertDelivery.subject_id)
            .where(
                AlertDelivery.alert_type == AlertType.LARGE_TRANSACTION,
                AlertDelivery.sent_at.is_(None),
            )
            .distinct()
        )
    )
    for transaction_id in transaction_ids:
        if transaction_id is None:
            continue
        transaction = db.get(Transaction, transaction_id)
        if transaction is not None:
            deliver_large_transaction(db, settings, transaction)


def run_alert_checks(db: Session, settings: Settings, *, now: dt.datetime | None = None) -> int:
    """Checks balances, budgets, recurring payments and bank syncs, and retries pending sends."""
    moment = now or utcnow()
    preferences = load_preferences(db).alerts
    notices = low_balance_notices(
        db, preferences.low_balance_threshold, preferences.low_balance_enabled
    )
    notices.extend(recurring_notices(db, moment.date(), preferences))
    notices.extend(budget_notices(db, settings, moment.date(), preferences))
    if preferences.sync_failure_enabled:
        notices.extend(sync_notices(db))
    db.commit()

    delivered = 0
    for notice in notices:
        if deliver_alert(
            db,
            settings,
            notice.alert_type,
            notice.event_key,
            notice.title,
            notice.message,
        ):
            delivered += 1
    retry_pending_large_transactions(db, settings)
    return delivered
