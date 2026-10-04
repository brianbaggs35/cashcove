"""Create, track and manage recurring payments."""

import uuid
from collections.abc import Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.finance.categories import find_category
from app.finance.subscriptions import (
    backfill_subscription,
    detach_matching,
    expected_amount,
    link_payments,
    normalized_payee,
    payment_stats,
    unlink_payment,
)
from app.models import Account, Subscription, Transaction
from app.schemas.subscriptions import (
    PaymentsLinked,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionUpdate,
)
from app.schemas.transactions import TransactionIds

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


def _subscription(db: Session, subscription_id: uuid.UUID, *, lock: bool = False) -> Subscription:
    subscription = db.get(Subscription, subscription_id, with_for_update=lock)
    if subscription is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That subscription doesn't exist anymore."
        )
    return subscription


def _account(db: Session, account_id: uuid.UUID) -> Account:
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


def _unique_rule(
    db: Session, account_id: uuid.UUID, payee: str, except_id: uuid.UUID | None = None
) -> None:
    query = select(Subscription.id).where(
        Subscription.account_id == account_id,
        func.lower(func.trim(Subscription.payee)) == normalized_payee(payee),
    )
    if except_id is not None:
        query = query.where(Subscription.id != except_id)
    if db.scalar(query) is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "duplicate_rule",
            "A subscription already tracks this payee from this account.",
        )


def _seed(
    db: Session, account_id: uuid.UUID, payee: str, transaction_id: uuid.UUID | None
) -> tuple[uuid.UUID, str]:
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
            "Choose an outgoing transaction as a subscription payment.",
        )
    if transaction.account_id != account_id:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "account_mismatch",
            "The selected payment must come from the subscription account.",
        )
    return account_id, transaction.payee


def _outs(db: Session, subscriptions: Sequence[Subscription]) -> list[SubscriptionOut]:
    """The subscriptions with how many payments each tracks, when and for how much the latest
    was made, and what to expect of the next."""
    stats = payment_stats(db, [item.id for item in subscriptions])
    outs: list[SubscriptionOut] = []
    for item in subscriptions:
        found = stats.get(item.id)
        outs.append(
            SubscriptionOut.model_validate(item).model_copy(
                update={
                    "payment_count": found.count if found else 0,
                    "last_payment_on": found.latest_on if found else None,
                    "last_payment_amount": found.last_amount if found else None,
                    "typical_amount": found.typical_amount if found else None,
                    "expected_amount": expected_amount(item, found),
                }
            )
        )
    return outs


def _out(db: Session, subscription: Subscription) -> SubscriptionOut:
    return _outs(db, [subscription])[0]


@router.get("")
def list_subscriptions(
    auth: CurrentAuth, db: Db, active: Annotated[bool | None, Query()] = None
) -> list[SubscriptionOut]:
    query = select(Subscription)
    if active is not None:
        query = query.where(Subscription.active.is_(active))
    return _outs(
        db,
        db.scalars(
            query.order_by(
                Subscription.active.desc(), Subscription.next_due_date, Subscription.name
            )
        ).all(),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_subscription(body: SubscriptionCreate, auth: AdminAuth, db: Db) -> SubscriptionOut:
    _account(db, body.account_id)
    find_category(db, body.category_id)
    _, payee = _seed(db, body.account_id, body.payee or body.name, body.seed_transaction_id)
    _unique_rule(db, body.account_id, payee)
    subscription = Subscription(
        name=body.name,
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
    db.commit()
    return _out(db, subscription)


@router.get("/{subscription_id}")
def read_subscription(subscription_id: uuid.UUID, auth: CurrentAuth, db: Db) -> SubscriptionOut:
    return _out(db, _subscription(db, subscription_id))


def _set_fields(subscription: Subscription, changes: dict[str, Any]) -> None:
    """Sets what a change mentions. Only the category and notes can be cleared, with null."""
    for field, value in changes.items():
        if value is not None or field in {"category_id", "notes"}:
            setattr(subscription, field, value)


@router.patch("/{subscription_id}")
def update_subscription(
    subscription_id: uuid.UUID, body: SubscriptionUpdate, auth: AdminAuth, db: Db
) -> SubscriptionOut:
    subscription = _subscription(db, subscription_id, lock=True)
    changes = body.model_dump(exclude_unset=True)
    seed_transaction_id = changes.pop("seed_transaction_id", None)
    account_id = changes.get("account_id") or subscription.account_id
    payee = changes.get("payee") or subscription.payee
    if seed_transaction_id is not None:
        account_id, payee = _seed(db, account_id, payee, seed_transaction_id)
        changes["account_id"] = account_id
        changes["payee"] = payee
    _account(db, account_id)
    if "category_id" in changes:
        find_category(db, changes["category_id"])
    account_changed = account_id != subscription.account_id
    matcher_changed = account_changed or normalized_payee(payee) != normalized_payee(
        subscription.payee
    )
    resumed = changes.get("active") is True and not subscription.active
    if matcher_changed:
        _unique_rule(db, account_id, payee, subscription.id)
        detach_matching(db, subscription)
    _set_fields(subscription, changes)
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
    db.commit()
    return _out(db, subscription)


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(subscription_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    subscription = _subscription(db, subscription_id, lock=True)
    db.delete(subscription)
    db.commit()


@router.post("/{subscription_id}/payments")
def link_subscription_payments(
    subscription_id: uuid.UUID, body: TransactionIds, auth: AdminAuth, db: Db
) -> PaymentsLinked:
    """Links payments from any account to the subscription, whatever they're called. They
    take its category. Ones already gone are skipped."""
    subscription = _subscription(db, subscription_id, lock=True)
    transactions = list(
        db.scalars(select(Transaction).where(Transaction.id.in_(body.ids)).with_for_update())
    )
    if any(transaction.amount >= 0 for transaction in transactions):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_payment",
            "Only payments, money going out, can be linked to a subscription.",
        )
    count = link_payments(subscription, transactions)
    db.commit()
    return PaymentsLinked(count=count, subscription=_out(db, subscription))


@router.delete("/{subscription_id}/payments/{transaction_id}")
def unlink_subscription_payment(
    subscription_id: uuid.UUID, transaction_id: uuid.UUID, auth: AdminAuth, db: Db
) -> SubscriptionOut:
    """Takes a payment off the subscription. It keeps its category."""
    subscription = _subscription(db, subscription_id, lock=True)
    unlink_payment(db, subscription.id, transaction_id)
    db.commit()
    return _out(db, subscription)
