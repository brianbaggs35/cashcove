"""Request and response models for recurring payments: subscriptions and bills."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import BudgetPeriod, PaymentFrequency, RecurringKind
from app.schemas.budget import Day
from app.schemas.fields import STRICT, AmountOut, TransactionNotes

SubscriptionName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
SubscriptionPayee = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
]
SubscriptionAmount = Annotated[
    Decimal, Field(gt=0, max_digits=14, decimal_places=2, le=Decimal("999999999999.99"))
]


class SubscriptionCreate(BaseModel):
    model_config = STRICT

    name: SubscriptionName
    amount: SubscriptionAmount
    # The amount is a different one each time, like a utility bill.
    amount_varies: bool = False
    frequency: PaymentFrequency
    account_id: uuid.UUID
    next_due_date: dt.date
    # The day it ends, when it's known: no payment is expected on or after it.
    ends_on: Day | None = None
    category_id: uuid.UUID | None = None
    notes: TransactionNotes = None
    payee: SubscriptionPayee | None = None
    seed_transaction_id: uuid.UUID | None = None


class SubscriptionUpdate(BaseModel):
    model_config = STRICT

    name: SubscriptionName | None = None
    amount: SubscriptionAmount | None = None
    amount_varies: bool | None = None
    frequency: PaymentFrequency | None = None
    account_id: uuid.UUID | None = None
    next_due_date: dt.date | None = None
    # Null takes the end date away. A cancelled one can't do without: reactivate it instead.
    ends_on: Day | None = None
    category_id: uuid.UUID | None = None
    notes: TransactionNotes = None
    payee: SubscriptionPayee | None = None
    active: bool | None = None
    seed_transaction_id: uuid.UUID | None = None


class SubscriptionCancel(BaseModel):
    """Cancelling a subscription or bill, which keeps it and everything it tracked."""

    model_config = STRICT

    # The day it was cancelled, where the person is. Today, when it isn't said.
    cancelled_on: Day | None = None
    # The day it ends: no payment is expected on or after it. The day it was cancelled, when it
    # isn't said, which ends it at once. Usually it is the day it would next have been paid, as a
    # service stays until what was paid for runs out.
    ends_on: Day | None = None


class SubscriptionReactivate(BaseModel):
    """Picking a cancelled or ended subscription or bill up again, as a regular one."""

    model_config = STRICT

    # The day its next payment is due. When it isn't said, the first day on its old schedule that
    # isn't before today, so it doesn't come back already late.
    next_due_date: Day | None = None
    # The day it is where the person is, which says whether it has ended and which days are past.
    # Today where the server is, when it isn't said.
    today: Day | None = None


class SubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    # Whether it's a subscription or a bill, which is the API it's under: it can't be changed.
    kind: RecurringKind
    payee: str
    amount: AmountOut
    amount_varies: bool
    frequency: PaymentFrequency
    account_id: uuid.UUID
    next_due_date: dt.date
    category_id: uuid.UUID | None
    notes: str | None
    active: bool
    # No payment is expected on or after this day, and once it has come it is over. Null when it
    # carries on.
    ends_on: dt.date | None = None
    # When a person cancelled it, which a cancelled one always has, and has an end date with.
    cancelled_on: dt.date | None = None
    payment_count: int = 0
    # The day of the latest payment linked to it, which is what moves its due date along, and
    # what that payment was for.
    last_payment_on: dt.date | None = None
    last_payment_amount: AmountOut | None = None
    # What its recent payments average, and so what to expect of one that changes every time.
    typical_amount: AmountOut | None = None
    # What its next payment is expected to be: the amount, or for a bill that changes every time,
    # the typical amount once there is one.
    expected_amount: AmountOut | None = None
    created_at: dt.datetime
    updated_at: dt.datetime


class PaymentsLinked(BaseModel):
    """What linking payments did: how many changed, and the subscription (or bill) as it is now."""

    count: int
    subscription: SubscriptionOut


class PaymentSummary(BaseModel):
    """What the payments linked to a subscription or bill came to. Amounts are what was paid,
    without the minus sign, in the currency of the account it is paid from."""

    total: AmountOut
    # The nulls are for one with no payments yet.
    average: AmountOut | None
    highest: AmountOut | None
    lowest: AmountOut | None
    first_on: dt.date | None
    # What was paid in the calendar year the person is in.
    this_year: AmountOut


class PaymentPoint(BaseModel):
    """One payment on a chart of what a subscription or bill has cost."""

    on: dt.date
    amount: AmountOut


class UpcomingPayment(BaseModel):
    """A payment that is coming, counted on from the next one by how often it repeats."""

    due_on: dt.date
    amount: AmountOut


class LinkedAutomation(BaseModel):
    """An automation that links payments to a subscription or bill as they come in."""

    id: uuid.UUID
    name: str
    active: bool


class LinkedBudget(BaseModel):
    """A budget that counts a subscription's or bill's payments as spending."""

    id: uuid.UUID
    name: str
    period: BudgetPeriod


class RecurringOverview(BaseModel):
    """Everything about one subscription or bill that its own page shows: it, what it has cost,
    what is coming, and what else in Cashcove refers to it."""

    subscription: SubscriptionOut
    summary: PaymentSummary
    # The latest payments, the oldest first, to draw what it has cost over time.
    history: list[PaymentPoint]
    upcoming: list[UpcomingPayment]
    automations: list[LinkedAutomation]
    budgets: list[LinkedBudget]
