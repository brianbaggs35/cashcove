"""Request and response models for budgets."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.finance.periods import MAX_PERIODS
from app.models import BudgetKind, BudgetPeriod, RecurringKind
from app.schemas.fields import MAX_AMOUNT, STRICT, AmountOut

# Far enough back for any history, and far enough ahead for any plan.
FIRST_DAY = dt.date(1970, 1, 1)
LAST_DAY = dt.date(2199, 12, 31)
Day = Annotated[dt.date, Field(ge=FIRST_DAY, le=LAST_DAY)]

BudgetName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
# What a budget has for each period, which has to be something.
BudgetAmountIn = Annotated[Decimal, Field(gt=0, le=MAX_AMOUNT, max_digits=14, decimal_places=2)]
# The most periods one look back covers, and the most transactions linked at once.
MAX_HISTORY = MAX_PERIODS
MAX_LINKED = 500

# What a source of a budget is: everything in an account or category, the payments of a
# subscription or of a bill, or what an automation sorts.
SourceType = Literal["account", "category", "subscription", "bill", "automation"]
# Why a transaction counts: it was linked itself, or by one of the sources. A payment linked to
# a subscription or to a bill counts "via" the subscription, since they're linked the same way.
Via = Literal["transaction", "automation", "subscription", "category", "account"]


class BudgetCreate(BaseModel):
    model_config = STRICT

    name: BudgetName
    period: BudgetPeriod
    amount: BudgetAmountIn
    # A day a period starts on, when it isn't the usual one: a week or two weeks on the
    # household's first day of the week, a month on the 1st, a year in the month the budget year
    # starts in.
    starts_on: Day | None = None
    # The date where the person is, which says which period they are in.
    today: Day | None = None


class BudgetUpdate(BaseModel):
    """Leave a field out to keep it. A new amount applies from the period the person is in, so
    periods that are over stay as they were, and changing how often a budget repeats starts it
    over with one amount."""

    model_config = STRICT

    name: BudgetName | None = None
    period: BudgetPeriod | None = None
    amount: BudgetAmountIn | None = None
    starts_on: Day | None = None
    today: Day | None = None


class PeriodSummary(BaseModel):
    """What a budget came to in one of its periods."""

    start: dt.date
    end: dt.date
    amount: AmountOut
    income: AmountOut
    spent: AmountOut


class BudgetOut(BaseModel):
    id: uuid.UUID
    name: str
    period: BudgetPeriod
    starts_on: dt.date
    # What it has for each period now, and how the period the person is in is going.
    amount: AmountOut
    current: PeriodSummary
    created_at: dt.datetime
    updated_at: dt.datetime


class BudgetSourceIn(BaseModel):
    """Something to count toward a budget, other than single transactions: all the money out of
    an account (as spending) or in (as income), everything in a category, the payments of a
    subscription or of a bill, or what an automation sorts. Name exactly one.

    A bill is named by `subscription_id` too, since both are recurring payments that
    transactions are linked to the same way."""

    model_config = STRICT

    kind: BudgetKind
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    subscription_id: uuid.UUID | None = None
    automation_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _is_one_thing(self) -> Self:
        named = [
            self.account_id,
            self.category_id,
            self.subscription_id,
            self.automation_id,
        ]
        if sum(item is not None for item in named) != 1:
            raise PydanticCustomError(
                "one_source", "Choose one account, category, subscription, bill or automation."
            )
        if self.subscription_id is not None and self.kind != BudgetKind.SPENDING:
            raise PydanticCustomError(
                "subscription_income", "The payments of a subscription or bill count as spending."
            )
        return self


class BudgetLinkOut(BaseModel):
    """A source of a budget."""

    id: uuid.UUID
    kind: BudgetKind
    type: SourceType
    target_id: uuid.UUID
    name: str
    # Paused, for an automation, a subscription or a bill, which has nothing counted until it's
    # resumed.
    active: bool = True


class BudgetSource(BudgetLinkOut):
    """A source, and what it counted in the period being looked at."""

    amount: AmountOut
    count: int


class DayTotal(BaseModel):
    day: dt.date
    income: AmountOut
    spent: AmountOut


class CategoryTotal(BaseModel):
    """What was spent in a category, or with none."""

    category_id: uuid.UUID | None
    amount: AmountOut
    count: int


class UpcomingBill(BaseModel):
    """A subscription or bill counted as spending that is due before the period ends."""

    subscription_id: uuid.UUID
    name: str
    kind: RecurringKind
    due_on: dt.date
    amount: AmountOut


class BudgetPeriodView(BaseModel):
    """One period of a budget: how it's going, or how it went."""

    budget: BudgetOut
    start: dt.date
    end: dt.date
    # The first days of the periods either side that can be looked at: none after this one,
    # or before the first with a transaction.
    previous: dt.date | None
    next: dt.date | None
    # The period the person is in.
    current: bool
    # How many days it is, and how many have gone, today's included (all or none, for periods
    # that are over or haven't begun).
    days: int
    days_gone: int
    amount: AmountOut
    income: AmountOut
    spent: AmountOut
    # What's left of the amount, which is negative when more was spent than that.
    left: AmountOut
    # What came in, less what was spent.
    saved: AmountOut
    # For the period the person is in: what spending would be by now if it were spread evenly
    # over the days, and what it comes to if it carries on at the pace so far.
    expected: AmountOut | None
    projected: AmountOut | None
    # How many transactions count, and how many that would count were taken off.
    transactions: int
    removed: int
    daily: list[DayTotal]
    categories: list[CategoryTotal]
    sources: list[BudgetSource]
    upcoming: list[UpcomingBill]
    # Currencies other than the household's that were converted, and ones that couldn't be,
    # for lack of an exchange rate, so their transactions aren't in the totals.
    converted: list[str]
    unavailable: list[str]


class HistoryPeriod(BaseModel):
    start: dt.date
    end: dt.date
    amount: AmountOut
    income: AmountOut
    spent: AmountOut
    current: bool


class BudgetHistory(BaseModel):
    """What a budget came to in each of its latest periods, the earliest first."""

    periods: list[HistoryPeriod]
    converted: list[str]
    unavailable: list[str]


class BudgetTransaction(BaseModel):
    """A transaction that counts toward a budget (or that would, if it hadn't been taken off)."""

    id: uuid.UUID
    date: dt.date
    payee: str
    amount: AmountOut
    account_id: uuid.UUID
    category_id: uuid.UUID | None
    kind: BudgetKind
    via: Via
    # The source it counts through, when it isn't linked itself.
    source_id: uuid.UUID | None


class BudgetTransactionPage(BaseModel):
    items: list[BudgetTransaction]
    total: int


class TransactionsLink(BaseModel):
    """Transactions to count toward a budget, as income or as spending. Ones that were taken
    off are put back."""

    model_config = STRICT

    ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_LINKED)]
    kind: BudgetKind


class TransactionsLinked(BaseModel):
    count: int


class AutomationCount(BaseModel):
    """An automation counting what it sorts toward a budget, as income or as spending."""

    model_config = STRICT

    budget_id: uuid.UUID
    kind: BudgetKind
