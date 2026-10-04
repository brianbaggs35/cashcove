"""Request and response models for recurring payments."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import PaymentFrequency
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
    category_id: uuid.UUID | None = None
    notes: TransactionNotes = None
    payee: SubscriptionPayee | None = None
    active: bool | None = None
    seed_transaction_id: uuid.UUID | None = None


class SubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    payee: str
    amount: AmountOut
    amount_varies: bool
    frequency: PaymentFrequency
    account_id: uuid.UUID
    next_due_date: dt.date
    category_id: uuid.UUID | None
    notes: str | None
    active: bool
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
    """What linking payments did: how many changed, and the subscription as it is now."""

    count: int
    subscription: SubscriptionOut
