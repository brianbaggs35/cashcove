"""Response models for the dashboard."""

import datetime as dt

from pydantic import BaseModel

from app.schemas.budget import CategoryTotal, DayTotal
from app.schemas.fields import AmountOut


class MonthFlow(BaseModel):
    """What came in and what went out in one calendar month."""

    start: dt.date
    end: dt.date
    income: AmountOut
    spent: AmountOut


class FlowToDate(BaseModel):
    """What came in and what went out over some days of a month."""

    income: AmountOut
    spent: AmountOut


class PayeeTotal(BaseModel):
    """What was spent with one payee."""

    payee: str
    amount: AmountOut
    count: int


class DashboardOut(BaseModel):
    """How the household is doing this month and over the last few, across every account.

    Money moving between the household's own accounts is neither income nor spending, and
    accounts in other currencies are counted in the household's at each day's exchange rate.
    """

    # The month the person is in, as far as it has gone: what came in and what was spent.
    month: MonthFlow
    # How many days it has, and how many have gone, today's included.
    days: int
    days_gone: int
    # The month before, over the same number of days, so the two can be compared fairly.
    previous: FlowToDate
    # The latest months, the earliest first, ending with the one the person is in.
    months: list[MonthFlow]
    # This month, a day at a time: only the days something came in or went out.
    daily: list[DayTotal]
    # What was spent this month by category (none for transactions with no category), the
    # biggest first, and the payees it was spent with the most.
    categories: list[CategoryTotal]
    payees: list[PayeeTotal]
    # How many transactions, ever, have no category yet.
    uncategorized: int
    # Currencies other than the household's that were converted, and ones that couldn't be,
    # for lack of an exchange rate, so their transactions aren't in the totals.
    converted: list[str]
    unavailable: list[str]
