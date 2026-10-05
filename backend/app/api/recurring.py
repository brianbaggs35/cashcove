"""Create, track and manage recurring payments: the API of both subscriptions and bills.

The two are the same thing to Cashcove, a payment that comes round on a schedule and whose
transactions are matched to it, so one set of routes serves both. Each is mounted for one kind,
and only ever sees that kind: a bill's ID isn't a subscription's, and asking for one as the other
is as good as asking for something that isn't there.
"""

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
from app.models import Account, RecurringKind, Subscription, Transaction
from app.schemas.subscriptions import (
    PaymentsLinked,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionUpdate,
)
from app.schemas.transactions import TransactionIds


def _subscription(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, *, lock: bool = False
) -> Subscription:
    subscription = db.get(Subscription, subscription_id, with_for_update=lock)
    if subscription is None or subscription.kind != kind:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", f"That {kind} doesn't exist anymore."
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


def _seed(
    db: Session,
    kind: RecurringKind,
    account_id: uuid.UUID,
    payee: str,
    transaction_id: uuid.UUID | None,
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
            f"Choose an outgoing transaction as a {kind} payment.",
        )
    if transaction.account_id != account_id:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "account_mismatch",
            f"The selected payment must come from the {kind} account.",
        )
    return account_id, transaction.payee


def _outs(db: Session, subscriptions: Sequence[Subscription]) -> list[SubscriptionOut]:
    """The payments with how many each tracks, when and for how much the latest was made, and
    what to expect of the next."""
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


def _set_fields(subscription: Subscription, changes: dict[str, Any]) -> None:
    """Sets what a change mentions. Only the category and notes can be cleared, with null."""
    for field, value in changes.items():
        if value is not None or field in {"category_id", "notes"}:
            setattr(subscription, field, value)


def _list(db: Session, kind: RecurringKind, active: bool | None) -> list[SubscriptionOut]:
    query = select(Subscription).where(Subscription.kind == kind)
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


def _create(db: Session, kind: RecurringKind, body: SubscriptionCreate) -> SubscriptionOut:
    _account(db, body.account_id)
    find_category(db, body.category_id)
    _, payee = _seed(db, kind, body.account_id, body.payee or body.name, body.seed_transaction_id)
    _unique_rule(db, body.account_id, payee)
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
    db.commit()
    return _out(db, subscription)


def _update(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, body: SubscriptionUpdate
) -> SubscriptionOut:
    subscription = _subscription(db, kind, subscription_id, lock=True)
    changes = body.model_dump(exclude_unset=True)
    seed_transaction_id = changes.pop("seed_transaction_id", None)
    account_id = changes.get("account_id") or subscription.account_id
    payee = changes.get("payee") or subscription.payee
    if seed_transaction_id is not None:
        account_id, payee = _seed(db, kind, account_id, payee, seed_transaction_id)
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


def _link(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, body: TransactionIds
) -> PaymentsLinked:
    subscription = _subscription(db, kind, subscription_id, lock=True)
    transactions = list(
        db.scalars(select(Transaction).where(Transaction.id.in_(body.ids)).with_for_update())
    )
    if any(transaction.amount >= 0 for transaction in transactions):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_payment",
            f"Only payments, money going out, can be linked to a {kind}.",
        )
    count = link_payments(subscription, transactions)
    db.commit()
    return PaymentsLinked(count=count, subscription=_out(db, subscription))


def recurring_router(kind: RecurringKind) -> APIRouter:
    """The routes for one kind of recurring payment: `/subscriptions` or `/bills`."""
    router = APIRouter(prefix=f"/{kind}s", tags=[f"{kind}s"])

    def list_payments(
        auth: CurrentAuth, db: Db, active: Annotated[bool | None, Query()] = None
    ) -> list[SubscriptionOut]:
        return _list(db, kind, active)

    def create_payment(body: SubscriptionCreate, auth: AdminAuth, db: Db) -> SubscriptionOut:
        return _create(db, kind, body)

    def read_payment(subscription_id: uuid.UUID, auth: CurrentAuth, db: Db) -> SubscriptionOut:
        return _out(db, _subscription(db, kind, subscription_id))

    def update_payment(
        subscription_id: uuid.UUID, body: SubscriptionUpdate, auth: AdminAuth, db: Db
    ) -> SubscriptionOut:
        return _update(db, kind, subscription_id, body)

    def delete_payment(subscription_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
        db.delete(_subscription(db, kind, subscription_id, lock=True))
        db.commit()

    def link_payment_transactions(
        subscription_id: uuid.UUID, body: TransactionIds, auth: AdminAuth, db: Db
    ) -> PaymentsLinked:
        """Links payments from any account, whatever they're called. They take its category.
        Ones already gone are skipped."""
        return _link(db, kind, subscription_id, body)

    def unlink_payment_transaction(
        subscription_id: uuid.UUID, transaction_id: uuid.UUID, auth: AdminAuth, db: Db
    ) -> SubscriptionOut:
        """Takes a payment off. It keeps its category."""
        subscription = _subscription(db, kind, subscription_id, lock=True)
        unlink_payment(db, subscription.id, transaction_id)
        db.commit()
        return _out(db, subscription)

    one = "/{subscription_id}"
    router.add_api_route("", list_payments, methods=["GET"])
    router.add_api_route("", create_payment, methods=["POST"], status_code=status.HTTP_201_CREATED)
    router.add_api_route(one, read_payment, methods=["GET"])
    router.add_api_route(one, update_payment, methods=["PATCH"])
    router.add_api_route(
        one, delete_payment, methods=["DELETE"], status_code=status.HTTP_204_NO_CONTENT
    )
    router.add_api_route(f"{one}/payments", link_payment_transactions, methods=["POST"])
    router.add_api_route(
        f"{one}/payments/{{transaction_id}}", unlink_payment_transaction, methods=["DELETE"]
    )
    return router
