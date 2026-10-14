"""One subscription or bill, in full: what it has cost, what is coming and what refers to it."""

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.finance.subscriptions import expected_amount, payment_stats, upcoming_dates
from app.finance.transactions import SORT_ORDERS
from app.models import Automation, Budget, BudgetLink, Subscription, Transaction
from app.models.base import CENT
from app.schemas.subscriptions import (
    LinkedAutomation,
    LinkedBudget,
    PaymentPoint,
    PaymentSummary,
    RecurringOverview,
    SubscriptionOut,
    UpcomingPayment,
)

# How many of the latest payments its chart draws.
HISTORY = 24


def payment_summary(db: Session, subscription: Subscription, today: dt.date) -> PaymentSummary:
    """What its linked payments came to. Payments are money going out, so they're negative: the
    most negative is the biggest payment, and amounts are given as what was paid."""
    in_year = Transaction.date.between(dt.date(today.year, 1, 1), dt.date(today.year, 12, 31))
    count, total, biggest, smallest, first_on, this_year = db.execute(
        select(
            func.count(),
            func.sum(Transaction.amount),
            func.min(Transaction.amount),
            func.max(Transaction.amount),
            func.min(Transaction.date),
            func.sum(case((in_year, Transaction.amount), else_=0)),
        ).where(Transaction.subscription_id == subscription.id)
    ).one()
    if not count:
        return PaymentSummary(
            total=Decimal(0),
            average=None,
            highest=None,
            lowest=None,
            first_on=None,
            this_year=Decimal(0),
        )
    return PaymentSummary(
        total=abs(total),
        average=(abs(total) / count).quantize(CENT, ROUND_HALF_UP),
        highest=abs(biggest),
        lowest=abs(smallest),
        first_on=first_on,
        this_year=abs(this_year),
    )


def payment_history(db: Session, subscription: Subscription) -> list[PaymentPoint]:
    """Its latest payments, the oldest first."""
    rows = db.execute(
        select(Transaction.date, Transaction.amount)
        .where(Transaction.subscription_id == subscription.id)
        .order_by(*SORT_ORDERS["-date"])
        .limit(HISTORY)
    ).all()
    return [PaymentPoint(on=day, amount=abs(amount)) for day, amount in reversed(rows)]


def linked_automations(db: Session, subscription: Subscription) -> list[LinkedAutomation]:
    """The automations that link payments to it, the ones at work first."""
    return [
        LinkedAutomation(id=id_, name=name, active=active)
        for id_, name, active in db.execute(
            select(Automation.id, Automation.name, Automation.active)
            .where(Automation.subscription_id == subscription.id)
            .order_by(Automation.active.desc(), func.lower(Automation.name), Automation.id)
        )
    ]


def linked_budgets(db: Session, subscription: Subscription) -> list[LinkedBudget]:
    """The budgets that count its payments as spending."""
    return [
        LinkedBudget(id=id_, name=name, period=period)
        for id_, name, period in db.execute(
            select(Budget.id, Budget.name, Budget.period)
            .join(BudgetLink, BudgetLink.budget_id == Budget.id)
            .where(BudgetLink.subscription_id == subscription.id)
            .order_by(func.lower(Budget.name), Budget.id)
        )
    ]


def recurring_overview(
    db: Session, subscription: Subscription, out: SubscriptionOut, today: dt.date
) -> RecurringOverview:
    """Everything its own page shows. `today` is the date where the person is, which says which
    year they're in."""
    expected = expected_amount(
        subscription, payment_stats(db, [subscription.id]).get(subscription.id)
    )
    return RecurringOverview(
        subscription=out,
        summary=payment_summary(db, subscription, today),
        history=payment_history(db, subscription),
        upcoming=[
            UpcomingPayment(due_on=day, amount=expected) for day in upcoming_dates(subscription)
        ],
        automations=linked_automations(db, subscription),
        budgets=linked_budgets(db, subscription),
    )
