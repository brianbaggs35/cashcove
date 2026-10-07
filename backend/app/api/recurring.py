"""Create, track and manage recurring payments: the API of both subscriptions and bills.

The two are the same thing to Cashcove, a payment that comes round on a schedule and whose
transactions are matched to it, so one set of routes serves both. Each is mounted for one kind,
and only ever sees that kind: a bill's ID isn't a subscription's, and asking for one as the other
is as good as asking for something that isn't there.
"""

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.finance.subscriptions import (
    change_recurring,
    create_recurring,
    expected_amount,
    find_recurring,
    link_payments,
    payment_stats,
    unlink_payment,
)
from app.models import RecurringKind, Subscription, Transaction
from app.schemas.subscriptions import (
    PaymentsLinked,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionUpdate,
)
from app.schemas.transactions import TransactionIds


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
    subscription = create_recurring(db, kind, body)
    db.commit()
    return _out(db, subscription)


def _update(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, body: SubscriptionUpdate
) -> SubscriptionOut:
    subscription = change_recurring(db, kind, subscription_id, body)
    db.commit()
    return _out(db, subscription)


def _link(
    db: Session, kind: RecurringKind, subscription_id: uuid.UUID, body: TransactionIds
) -> PaymentsLinked:
    subscription = find_recurring(db, kind, subscription_id, lock=True)
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
        return _out(db, find_recurring(db, kind, subscription_id))

    def update_payment(
        subscription_id: uuid.UUID, body: SubscriptionUpdate, auth: AdminAuth, db: Db
    ) -> SubscriptionOut:
        return _update(db, kind, subscription_id, body)

    def delete_payment(subscription_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
        db.delete(find_recurring(db, kind, subscription_id, lock=True))
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
        subscription = find_recurring(db, kind, subscription_id, lock=True)
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
