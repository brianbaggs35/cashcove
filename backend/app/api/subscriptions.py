"""Create, track and manage recurring payments."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.finance.categories import find_category
from app.finance.subscriptions import backfill_subscription, normalized_payee
from app.models import Account, Subscription, Transaction
from app.schemas.subscriptions import SubscriptionCreate, SubscriptionOut, SubscriptionUpdate

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


def _out(db: Session, subscription: Subscription) -> SubscriptionOut:
    count = db.scalar(
        select(func.count()).select_from(Transaction).where(
            Transaction.subscription_id == subscription.id
        )
    )
    return SubscriptionOut.model_validate(subscription).model_copy(
        update={"payment_count": count or 0}
    )


@router.get("")
def list_subscriptions(
    auth: CurrentAuth, db: Db, active: Annotated[bool | None, Query()] = None
) -> list[SubscriptionOut]:
    query = select(Subscription)
    if active is not None:
        query = query.where(Subscription.active.is_(active))
    subscriptions = db.scalars(
        query.order_by(Subscription.active.desc(), Subscription.next_due_date, Subscription.name)
    ).all()
    return [_out(db, subscription) for subscription in subscriptions]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_subscription(
    body: SubscriptionCreate, auth: AdminAuth, db: Db
) -> SubscriptionOut:
    _account(db, body.account_id)
    find_category(db, body.category_id)
    _, payee = _seed(db, body.account_id, body.payee or body.name, body.seed_transaction_id)
    _unique_rule(db, body.account_id, payee)
    subscription = Subscription(
        name=body.name,
        payee=payee,
        amount=body.amount,
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
    if matcher_changed:
        _unique_rule(db, account_id, payee, subscription.id)
        db.query(Transaction).filter(Transaction.subscription_id == subscription.id).update(
            {Transaction.subscription_id: None}, synchronize_session=False
        )
    for field, value in changes.items():
        if value is not None or field in {"category_id", "notes"}:
            setattr(subscription, field, value)
    if matcher_changed:
        subscription.account_id = account_id
        subscription.payee = payee
        if subscription.active:
            backfill_subscription(db, subscription)
    elif "category_id" in changes:
        db.query(Transaction).filter(Transaction.subscription_id == subscription.id).update(
            {Transaction.category_id: changes["category_id"]}, synchronize_session=False
        )
    db.commit()
    return _out(db, subscription)


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(subscription_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    subscription = _subscription(db, subscription_id, lock=True)
    db.delete(subscription)
    db.commit()
