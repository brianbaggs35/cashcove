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
    frequency: PaymentFrequency
    account_id: uuid.UUID
    next_due_date: dt.date
    category_id: uuid.UUID | None
    notes: str | None
    active: bool
    payment_count: int = 0
    created_at: dt.datetime
    updated_at: dt.datetime
