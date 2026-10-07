"""Recurring payments: which transactions belong to one, and when its next payment is due."""

import calendar
import datetime as dt
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import status
from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.orm import Session

from app.auth.deps import ApiError
from app.finance.categories import find_category
from app.models import Account, PaymentFrequency, RecurringKind, Subscription, Transaction
from app.models.base import CENT
from app.schemas.subscriptions import SubscriptionCreate, SubscriptionUpdate

# How many of a subscription's latest payments its typical amount is the average of.
RECENT_PAYMENTS = 6

# How many months each frequency that repeats by the month steps by; the rest step by days.
_MONTHS = {
    PaymentFrequency.MONTHLY: 1,
    PaymentFrequency.QUARTERLY: 3,
    PaymentFrequency.SEMIANNUAL: 6,
    PaymentFrequency.ANNUAL: 12,
}
_DAYS = {PaymentFrequency.WEEKLY: 7, PaymentFrequency.BIWEEKLY: 14}
# A payment settles the next due date when it's made up to this long before it: half of
# what separates two payments, so an early payment counts and last cycle's doesn't.
_EARLY = {
    PaymentFrequency.WEEKLY: dt.timedelta(days=3),
    PaymentFrequency.BIWEEKLY: dt.timedelta(days=7),
    PaymentFrequency.MONTHLY: dt.timedelta(days=15),
    PaymentFrequency.QUARTERLY: dt.timedelta(days=45),
    PaymentFrequency.SEMIANNUAL: dt.timedelta(days=91),
    PaymentFrequency.ANNUAL: dt.timedelta(days=182),
}


@dataclass
class PaymentStats:
    """What a subscription's linked payments came to."""

    count: int = 0
    latest_on: dt.date | None = None
    last_amount: Decimal | None = None
    # The average of its latest few payments, which is what to expect of a bill that changes
    # every time.
    typical_amount: Decimal | None = None
    recent: list[Decimal] = field(default_factory=list[Decimal])


def payment_stats(
    db: Session, subscription_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, PaymentStats]:
    """How many payments each subscription has, when the latest was and for how much, and
    what its recent ones average. Amounts are what was paid, without the minus sign."""
    order = (Transaction.date.desc(), Transaction.created_at.desc(), Transaction.id.desc())
    ranked = (
        select(
            Transaction.subscription_id.label("subscription_id"),
            Transaction.amount.label("amount"),
            Transaction.date.label("day"),
            func.row_number()
            .over(partition_by=Transaction.subscription_id, order_by=order)
            .label("rank"),
            func.count().over(partition_by=Transaction.subscription_id).label("total"),
        )
        .where(Transaction.subscription_id.in_(subscription_ids))
        .subquery()
    )
    stats: defaultdict[uuid.UUID, PaymentStats] = defaultdict(PaymentStats)
    for subscription_id, amount, day, total in db.execute(
        select(ranked.c.subscription_id, ranked.c.amount, ranked.c.day, ranked.c.total)
        .where(ranked.c.rank <= RECENT_PAYMENTS)
        .order_by(ranked.c.subscription_id, ranked.c.rank)
    ):
        item = stats[subscription_id]
        if item.latest_on is None:
            item.count, item.latest_on, item.last_amount = total, day, abs(amount)
        item.recent.append(abs(amount))
    for item in stats.values():
        item.typical_amount = (sum(item.recent, Decimal(0)) / len(item.recent)).quantize(
            CENT, ROUND_HALF_UP
        )
    return dict(stats)


def expected_amount(subscription: Subscription, stats: PaymentStats | None) -> Decimal:
    """What its next payment is expected to be: the amount it was set up with, or for a bill that
    changes every time, what recent payments averaged once it has some."""
    if subscription.amount_varies and stats is not None and stats.typical_amount is not None:
        return stats.typical_amount
    return subscription.amount


def normalized_payee(payee: str) -> str:
    """The exact payee used for matching, ignoring surrounding and letter case."""
    return payee.strip().lower()


def payee_is(payee: str) -> ColumnElement[bool]:
    """Transactions with this payee, the way `normalized_payee` reads it."""
    return func.lower(func.trim(Transaction.payee)) == normalized_payee(payee)


def _add_months(day: dt.date, months: int) -> dt.date:
    """The same day of the month `months` later, or its last day when that month is shorter."""
    year, month = divmod(day.year * 12 + day.month - 1 + months, 12)
    return dt.date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def _due_after(due: dt.date, frequency: PaymentFrequency, cycles: int) -> dt.date:
    """The due date `cycles` payments after `due`. Counted from `due` each time, so a payment
    due on the 31st goes back to the 31st after a short month."""
    if frequency in _DAYS:
        return due + dt.timedelta(days=_DAYS[frequency] * cycles)
    return _add_months(due, _MONTHS[frequency] * cycles)


def due_dates(subscription: Subscription, first: dt.date, last: dt.date) -> list[dt.date]:
    """The days from `first` to `last` its payments are due, counted on from the next one."""
    frequency = subscription.frequency
    due = subscription.next_due_date
    # Starts a little before `first`, so a payment that's been due for years isn't counted up to.
    longest = _DAYS[frequency] if frequency in _DAYS else 31 * _MONTHS[frequency]
    cycles = max(0, (first - due).days // longest - 1)
    while _due_after(due, frequency, cycles) < first:
        cycles += 1
    days: list[dt.date] = []
    while (day := _due_after(due, frequency, cycles)) <= last:
        days.append(day)
        cycles += 1
    return days


def advance_due_date(subscription: Subscription, paid_on: dt.date) -> None:
    """Moves the next due date past every payment a payment on `paid_on` settles, so the
    subscription is due again a cycle later. A payment from long before it, like history
    from an old statement, changes nothing."""
    settled = paid_on + _EARLY[subscription.frequency]
    due = subscription.next_due_date
    cycles = 0
    while _due_after(due, subscription.frequency, cycles) <= settled:
        cycles += 1
    if cycles:
        subscription.next_due_date = _due_after(due, subscription.frequency, cycles)


def backfill_subscription(db: Session, subscription: Subscription) -> int:
    """Link every existing outgoing transaction for a subscription's matching account/payee."""
    rows = list(
        db.scalars(
            select(Transaction).where(
                Transaction.account_id == subscription.account_id,
                Transaction.amount < 0,
                payee_is(subscription.payee),
            )
        )
    )
    for transaction in rows:
        transaction.subscription_id = subscription.id
        if subscription.category_id is not None:
            transaction.category_id = subscription.category_id
    return len(rows)


def detach_matching(db: Session, subscription: Subscription) -> None:
    """Unlinks the payments a subscription's account and payee caught, which is what changing
    them stops it from tracking. Payments someone linked by hand from elsewhere stay."""
    db.execute(
        update(Transaction)
        .where(
            Transaction.subscription_id == subscription.id,
            Transaction.account_id == subscription.account_id,
            payee_is(subscription.payee),
        )
        .values(subscription_id=None)
    )


def link_payments(subscription: Subscription, transactions: Sequence[Transaction]) -> int:
    """Links payments, from any account, to a subscription. They take its category, if it has
    one, and the latest of them settles its next due date. Returns how many changed."""
    changed = 0
    for transaction in transactions:
        category_id = subscription.category_id
        if transaction.subscription_id != subscription.id or (
            category_id is not None and transaction.category_id != category_id
        ):
            changed += 1
        transaction.subscription_id = subscription.id
        if category_id is not None:
            transaction.category_id = category_id
    if transactions:
        advance_due_date(subscription, max(transaction.date for transaction in transactions))
    return changed


def unlink_payment(db: Session, subscription_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
    """Takes a payment off a subscription. It keeps its category."""
    db.execute(
        update(Transaction)
        .where(Transaction.id == transaction_id, Transaction.subscription_id == subscription_id)
        .values(subscription_id=None)
    )


# ---- Setting one up, and changing it -------------------------------------------------------------
#
# These don't commit, so a request can set up several things and keep all of them or none.


def find_recurring(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, *, lock: bool = False
) -> Subscription:
    """The subscription or the bill, which has to be one of that kind: a bill's ID isn't a
    subscription's, and asking for one as the other is as good as asking for something that isn't
    there."""
    subscription = db.get(Subscription, subscription_id, with_for_update=lock)
    if subscription is None or subscription.kind != kind:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", f"That {kind} doesn't exist anymore."
        )
    return subscription


def open_account(db: Session, account_id: uuid.UUID) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_account", "Choose an account."
        )
    if account.is_closed:
        raise ApiError(
            status.HTTP_409_CONFLICT, "closed_account", "Choose an open account for payments."
        )
    return account


def ensure_untracked(
    db: Session, account_id: uuid.UUID, payee: str, except_id: uuid.UUID | None = None
) -> None:
    """A payee is tracked once from an account, as a subscription or as a bill, since a payment
    can only be one of them."""
    query = select(Subscription.kind).where(
        Subscription.account_id == account_id,
        func.lower(func.trim(Subscription.payee)) == normalized_payee(payee),
    )
    if except_id is not None:
        query = query.where(Subscription.id != except_id)
    tracked_as = db.scalar(query)
    if tracked_as is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "duplicate_rule",
            f"A {tracked_as} already tracks this payee from this account.",
        )


def seed_payee(
    db: Session,
    kind: RecurringKind,
    account_id: uuid.UUID,
    payee: str,
    transaction_id: uuid.UUID | None,
) -> tuple[uuid.UUID, str]:
    """The account and the payee to track: the ones given, or a payment's own."""
    if transaction_id is None:
        return account_id, payee
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "transaction_not_found",
            "That transaction doesn't exist anymore.",
        )
    if transaction.amount >= 0:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_payment",
            f"Choose an outgoing transaction as a {kind} payment.",
        )
    if transaction.account_id != account_id:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "account_mismatch",
            f"The selected payment must come from the {kind} account.",
        )
    return account_id, transaction.payee


def set_fields(subscription: Subscription, changes: dict[str, Any]) -> None:
    """Sets what a change mentions. Only the category and notes can be cleared, with null."""
    for name, value in changes.items():
        if value is not None or name in {"category_id", "notes"}:
            setattr(subscription, name, value)


def create_recurring(db: Session, kind: RecurringKind, body: SubscriptionCreate) -> Subscription:
    """Adds a subscription or a bill, and links the payments it already has to it."""
    open_account(db, body.account_id)
    find_category(db, body.category_id)
    _, payee = seed_payee(
        db, kind, body.account_id, body.payee or body.name, body.seed_transaction_id
    )
    ensure_untracked(db, body.account_id, payee)
    subscription = Subscription(
        name=body.name,
        kind=kind,
        payee=payee,
        amount=body.amount,
        amount_varies=body.amount_varies,
        frequency=body.frequency,
        account_id=body.account_id,
        next_due_date=body.next_due_date,
        category_id=body.category_id,
        notes=body.notes,
    )
    db.add(subscription)
    db.flush()
    backfill_subscription(db, subscription)
    return subscription


def change_recurring(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, body: SubscriptionUpdate
) -> Subscription:
    """Changes what a change mentions. A new account or payee changes which payments it tracks,
    and a new category goes on the payments already linked."""
    subscription = find_recurring(db, kind, subscription_id, lock=True)
    changes = body.model_dump(exclude_unset=True)
    seed_transaction_id = changes.pop("seed_transaction_id", None)
    account_id = changes.get("account_id") or subscription.account_id
    payee = changes.get("payee") or subscription.payee
    if seed_transaction_id is not None:
        account_id, payee = seed_payee(db, kind, account_id, payee, seed_transaction_id)
        changes["account_id"] = account_id
        changes["payee"] = payee
    open_account(db, account_id)
    if "category_id" in changes:
        find_category(db, changes["category_id"])
    account_changed = account_id != subscription.account_id
    matcher_changed = account_changed or normalized_payee(payee) != normalized_payee(
        subscription.payee
    )
    resumed = changes.get("active") is True and not subscription.active
    if matcher_changed:
        ensure_untracked(db, account_id, payee, subscription.id)
        detach_matching(db, subscription)
    set_fields(subscription, changes)
    if matcher_changed:
        subscription.account_id = account_id
        subscription.payee = payee
    if "category_id" in changes:
        db.execute(
            update(Transaction)
            .where(Transaction.subscription_id == subscription.id)
            .values(category_id=changes["category_id"])
        )
    # Payments that arrived while matching was paused are caught up when it resumes.
    if subscription.active and (matcher_changed or resumed):
        backfill_subscription(db, subscription)
    return subscription
