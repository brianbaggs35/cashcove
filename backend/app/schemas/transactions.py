"""Request and response models for the Transactions tab."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.models import TransactionSource
from app.models.base import utcnow
from app.schemas.fields import (
    STRICT,
    Amount,
    AmountOut,
    Payee,
    PositiveAmount,
    TransactionNotes,
)

EARLIEST = dt.date(1970, 1, 1)


def _not_zero(value: Decimal) -> Decimal:
    if value == 0:
        raise PydanticCustomError("amount_zero", "Enter an amount other than zero.")
    return value


def _plausible(value: dt.date) -> dt.date:
    latest = utcnow().date() + dt.timedelta(days=366)
    if not EARLIEST <= value <= latest:
        raise PydanticCustomError(
            "date_out_of_range", "Choose a date between 1970 and a year from now."
        )
    return value


NonZeroAmount = Annotated[Amount, AfterValidator(_not_zero)]
TransactionDate = Annotated[dt.date, AfterValidator(_plausible)]


class TransactionCreate(BaseModel):
    """A transaction entered by hand, into an account the household keeps up to date."""

    model_config = STRICT

    account_id: uuid.UUID
    date: TransactionDate
    # Positive when money comes in, negative when it goes out.
    amount: NonZeroAmount
    payee: Payee
    category_id: uuid.UUID | None = None
    notes: TransactionNotes = None


class TransactionUpdate(BaseModel):
    """Leave a field out to keep it. Null clears the category or the notes.

    Plaid keeps a synced transaction's account, date and amount up to date, so only its payee,
    category and notes can change.
    """

    model_config = STRICT

    account_id: uuid.UUID | None = None
    date: TransactionDate | None = None
    amount: NonZeroAmount | None = None
    payee: Payee | None = None
    category_id: uuid.UUID | None = None
    notes: TransactionNotes = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    date: dt.date
    amount: AmountOut
    payee: str
    original_description: str | None
    category_id: uuid.UUID | None
    notes: str | None
    pending: bool
    source: TransactionSource
    created_at: dt.datetime
    updated_at: dt.datetime


Sort = Literal["date", "-date", "amount", "-amount", "payee", "-payee"]


class TransactionQuery(BaseModel):
    """Which transactions to list. Filters combine: a transaction has to match all of them."""

    model_config = STRICT

    page: Annotated[int, Field(ge=1, le=1_000_000)] = 1
    page_size: Annotated[int, Field(ge=1, le=200)] = 50
    # Words in the payee, the bank's description, the notes or the category, or an amount.
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""
    account_id: list[uuid.UUID] = []
    category_id: list[uuid.UUID] = []
    # With category_id, also transactions without a category; on its own, only those.
    uncategorized: bool = False
    start: dt.date | None = None
    end: dt.date | None = None
    direction: Literal["in", "out"] | None = None
    status: Literal["pending", "posted"] | None = None
    source: list[TransactionSource] = []
    # How big the amount is, whichever way the money went.
    min_amount: PositiveAmount | None = None
    max_amount: PositiveAmount | None = None
    sort: Sort = "-date"

    @model_validator(mode="after")
    def _ranges_are_in_order(self) -> Self:
        if self.start and self.end and self.start > self.end:
            raise PydanticCustomError(
                "date_range", "The start date has to be on or before the end date."
            )
        if (
            self.min_amount is not None
            and self.max_amount is not None
            and self.min_amount > self.max_amount
        ):
            raise PydanticCustomError(
                "amount_range", "The smallest amount can't be more than the largest."
            )
        return self


class TransactionTotals(BaseModel):
    """What the matching transactions add up to, in one currency."""

    currency: str
    count: int
    money_in: AmountOut
    money_out: AmountOut


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    page: int
    page_size: int
    totals: list[TransactionTotals]


class PayeeSuggestion(BaseModel):
    payee: str
    # The category its most recent transaction has, to suggest for a new one.
    category_id: uuid.UUID | None
    count: int


class TransactionIds(BaseModel):
    model_config = STRICT

    ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=500)]


class BulkCategorize(TransactionIds):
    category_id: uuid.UUID | None


class BulkResult(BaseModel):
    count: int
