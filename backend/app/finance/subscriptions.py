"""Link transactions to the recurring payment they belong to."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Subscription, Transaction


def normalized_payee(payee: str) -> str:
    """The exact payee used for matching, ignoring surrounding and letter case."""
    return payee.strip().lower()


def matching_subscription(
    db: Session, account_id: uuid.UUID, payee: str
) -> Subscription | None:
    key = normalized_payee(payee)
    return db.scalar(
        select(Subscription).where(
            Subscription.account_id == account_id,
            Subscription.active.is_(True),
            func.lower(func.trim(Subscription.payee)) == key,
        )
    )


def apply_subscription_rule(db: Session, transaction: Transaction) -> bool:
    """Link a payment to its account/payee rule, and apply its category when set."""
    subscription = matching_subscription(db, transaction.account_id, transaction.payee)
    if transaction.amount >= 0:
        subscription = None
    changed = transaction.subscription_id != (subscription.id if subscription else None)
    transaction.subscription_id = subscription.id if subscription else None
    if subscription and subscription.category_id is not None:
        changed = changed or transaction.category_id != subscription.category_id
        transaction.category_id = subscription.category_id
    return changed


def backfill_subscription(db: Session, subscription: Subscription) -> int:
    """Link every existing outgoing transaction for a subscription's matching account/payee."""
    rows = list(
        db.scalars(
            select(Transaction).where(
                Transaction.account_id == subscription.account_id,
                Transaction.amount < 0,
                func.lower(func.trim(Transaction.payee)) == normalized_payee(subscription.payee),
            )
        )
    )
    for transaction in rows:
        transaction.subscription_id = subscription.id
        if subscription.category_id is not None:
            transaction.category_id = subscription.category_id
    return len(rows)
