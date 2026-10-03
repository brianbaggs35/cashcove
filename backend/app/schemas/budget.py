"""Request and response models for the Budget tab."""

import datetime as dt
import re
import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, PlainSerializer, PlainValidator, model_validator
from pydantic_core import PydanticCustomError

from app.models import BudgetPeriod, CategoryKind
from app.schemas.fields import STRICT, AmountOut, PositiveAmount

# Far enough back for any history, and far enough ahead for any plan.
FIRST_YEAR = 1970
LAST_YEAR = 2199
# The most categories one change to a month's budget can cover.
MAX_PLAN = 500

_MONTH = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")


def _month(value: object) -> dt.date:
    """A month as "2026-09", which stands for its first day."""
    if isinstance(value, str) and (match := _MONTH.fullmatch(value)):
        year = int(match[1])
        if FIRST_YEAR <= year <= LAST_YEAR:
            return dt.date(year, int(match[2]), 1)
    raise PydanticCustomError("month", "Choose a month between 1970 and 2199, like 2026-09.")


def _month_text(value: dt.date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


# Months travel as "2026-09" both ways.
Month = Annotated[dt.date, PlainValidator(_month, json_schema_input_type=str)]
MonthOut = Annotated[dt.date, PlainSerializer(_month_text, return_type=str)]
Year = Annotated[int, Field(ge=FIRST_YEAR, le=LAST_YEAR)]
# A change applies from the month (or budget year) being looked at on, or only to it.
Scope = Literal["onward", "only"]


class BudgetChange(BaseModel):
    """A category's budget, from the month being looked at, or from the budget year it's in
    for a yearly budget. Switching between monthly and yearly starts the budget afresh."""

    model_config = STRICT

    month: Month
    period: BudgetPeriod = BudgetPeriod.MONTHLY
    # For each month, or for the budget year. None stops budgeting the category.
    amount: PositiveAmount | None
    scope: Scope = "onward"
    # Carry what's left of each month into the next. Monthly spending budgets only.
    rollover: bool = False
    # Optional: for weekly/biweekly budgets, the recurring payday or cycle anchor.
    cycle_anchor: dt.date | None = None
    # None leaves the existing account scope alone; an empty list includes every account.
    account_ids: Annotated[list[uuid.UUID], Field(max_length=100)] | None = None

    @model_validator(mode="after")
    def _only_monthly_budgets_roll_over(self) -> Self:
        if self.rollover and self.period != BudgetPeriod.MONTHLY:
            raise PydanticCustomError(
                "rollover_period", "Only monthly budgets can roll over to the next month."
            )
        if self.cycle_anchor is not None and self.period not in {
            BudgetPeriod.WEEKLY,
            BudgetPeriod.BIWEEKLY,
        }:
            raise PydanticCustomError(
                "cycle_anchor_period",
                "Choose a cycle anchor only for a weekly or biweekly budget.",
            )
        if self.account_ids is not None and len(set(self.account_ids)) != len(self.account_ids):
            raise PydanticCustomError("duplicate_account", "Each account can only be linked once.")
        return self


class PlanAmount(BaseModel):
    model_config = STRICT

    category_id: uuid.UUID
    # For each month, or for the budget year when the category's budget is yearly. None stops
    # budgeting it.
    amount: PositiveAmount | None


class BudgetPlan(BaseModel):
    """Several categories' budgets at once, for the month being looked at."""

    model_config = STRICT

    scope: Scope = "onward"
    amounts: Annotated[list[PlanAmount], Field(min_length=1, max_length=MAX_PLAN)]

    @model_validator(mode="after")
    def _each_category_once(self) -> Self:
        ids = [item.category_id for item in self.amounts]
        if len(set(ids)) != len(ids):
            raise PydanticCustomError(
                "duplicate_category", "Each category can only be budgeted once."
            )
        return self


# ---- The month ---------------------------------------------------------------------------


class MonthTotals(BaseModel):
    """What a month's budgets add up to, what rolled over into it, and what actually came in
    or went out."""

    budgeted: AmountOut
    carried: AmountOut
    actual: AmountOut


class Uncategorized(BaseModel):
    """Transactions without a category. They count toward the totals, but no budget."""

    received: AmountOut
    spent: AmountOut
    count: int


class BudgetLine(BaseModel):
    """A category in a month: its budget, and what came in or went out."""

    category_id: uuid.UUID
    name: str
    emoji: str
    # How the category is budgeted, if it is (it may not be in this month).
    period: BudgetPeriod | None
    # Its budget for the month, or for the budget year when it's yearly. None when nothing's
    # budgeted then.
    amount: AmountOut | None
    # What is budgeted in this calendar month, including weekly/biweekly cycles.
    budgeted: AmountOut
    rollover: bool
    # What was left over (or overspent) in the months before, for a budget that rolls over.
    carried: AmountOut
    # What was spent in the month, for spending, or received, for income.
    actual: AmountOut
    # For a yearly budget: what was spent or received from the start of the budget year to
    # the end of the month.
    year_to_date: AmountOut | None
    # What a month came to on average over the three before, to suggest a budget.
    average: AmountOut
    # How many transactions it had in the month.
    count: int


class BudgetGroup(BaseModel):
    id: uuid.UUID
    name: str
    kind: CategoryKind
    categories: list[BudgetLine]


class BudgetMonth(BaseModel):
    """A month's budget. Income comes first, then spending; transfers between the household's
    own accounts aren't budgeted."""

    month: MonthOut
    currency: str
    # The budget year the month is in, which yearly budgets are for, by the year it starts in.
    year: int
    year_start: MonthOut
    year_end: MonthOut
    # Budgeted includes a twelfth of each yearly budget.
    income: MonthTotals
    spending: MonthTotals
    groups: list[BudgetGroup]
    uncategorized: Uncategorized
    # Transactions in accounts in these currencies aren't counted, since budgets are in the
    # household's own.
    other_currencies: list[str]


# ---- The year ----------------------------------------------------------------------------


class Totals(BaseModel):
    budgeted: AmountOut
    actual: AmountOut


class MonthCell(BaseModel):
    """A category in one month of the year."""

    # The month's budget, for a category budgeted monthly.
    budgeted: AmountOut | None
    actual: AmountOut


class BudgetYearLine(BaseModel):
    category_id: uuid.UUID
    name: str
    emoji: str
    period: BudgetPeriod | None
    # The year's budget: its months' budgets added up, or the yearly budget. None when it
    # isn't budgeted in the year.
    amount: AmountOut | None
    actual: AmountOut
    months: list[MonthCell]


class BudgetYearGroup(BaseModel):
    id: uuid.UUID
    name: str
    kind: CategoryKind
    categories: list[BudgetYearLine]


class YearMonth(BaseModel):
    month: MonthOut
    # Budgeted includes a twelfth of each yearly budget.
    income: Totals
    spending: Totals


class UncategorizedMonth(BaseModel):
    received: AmountOut
    spent: AmountOut


class YearUncategorized(Uncategorized):
    months: list[UncategorizedMonth]


class BudgetYear(BaseModel):
    """A budget year, month by month. It starts in the month Settings > General says."""

    year: int
    start: MonthOut
    end: MonthOut
    currency: str
    income: Totals
    spending: Totals
    months: list[YearMonth]
    groups: list[BudgetYearGroup]
    uncategorized: YearUncategorized
    other_currencies: list[str]


# ---- One category over time --------------------------------------------------------------


class HistoryMonth(BaseModel):
    month: MonthOut
    # The month's budget, for a category budgeted monthly.
    budgeted: AmountOut | None
    actual: AmountOut


class CategoryHistory(BaseModel):
    """A category's last twelve months, up to and including the one asked for."""

    category_id: uuid.UUID
    kind: CategoryKind
    months: list[HistoryMonth]


class BudgetConfiguration(BaseModel):
    """A category budget's editable settings for the month being viewed."""

    id: uuid.UUID
    category_id: uuid.UUID
    period: BudgetPeriod
    amount: AmountOut | None
    rollover: bool
    cycle_anchor: dt.date | None
    account_ids: list[uuid.UUID]
    linked_transaction_ids: list[uuid.UUID]
    linked_subscription_ids: list[uuid.UUID]
