"""The periods a budget repeats in: weeks, two weeks, months or years, counted from the day the
budget says they start.

A budget's periods follow one another without gaps, so every day is in exactly one of them, and
they go back before the budget was made, so what was spent before can be looked at too. Months
and years count from the day of the month the budget starts on, which is clamped in shorter
months: a budget that starts on the 31st has periods that start on Jan 31, Feb 28, Mar 31 and so
on.
"""

import calendar
import datetime as dt

from app.models.budget import BudgetPeriod

MONTHS_IN_YEAR = 12
ONE_DAY = dt.timedelta(days=1)

_DAYS = {BudgetPeriod.WEEKLY: 7, BudgetPeriod.BIWEEKLY: 14}
_MONTHS = {BudgetPeriod.MONTHLY: 1, BudgetPeriod.YEARLY: MONTHS_IN_YEAR}


def shift_months(anchor: dt.date, months: int) -> dt.date:
    """The day `months` months after `anchor` (before it, when negative), on the same day of the
    month, or the last day of a month that's too short to have it."""
    index = anchor.year * MONTHS_IN_YEAR + anchor.month - 1 + months
    year, month = divmod(index, MONTHS_IN_YEAR)
    month += 1
    return dt.date(year, month, min(anchor.day, calendar.monthrange(year, month)[1]))


def _months_between(start: dt.date, end: dt.date) -> int:
    return (end.year - start.year) * MONTHS_IN_YEAR + end.month - start.month


def period_start(period: BudgetPeriod, anchor: dt.date, day: dt.date) -> dt.date:
    """The first day of the period that `day` is in, for periods counted from `anchor`."""
    if period in _DAYS:
        length = _DAYS[period]
        return anchor + dt.timedelta(days=(day - anchor).days // length * length)
    step = _MONTHS[period]
    index = _months_between(anchor, day) // step * step
    start = shift_months(anchor, index)
    # Close to the end of a month, the day can come before the one the month's period starts on.
    return start if start <= day else shift_months(anchor, index - step)


def next_start(period: BudgetPeriod, anchor: dt.date, start: dt.date) -> dt.date:
    """The first day of the period after the one that starts on `start`."""
    if period in _DAYS:
        return start + dt.timedelta(days=_DAYS[period])
    step = _MONTHS[period]
    return shift_months(anchor, (_months_between(anchor, start) // step + 1) * step)


def previous_start(period: BudgetPeriod, anchor: dt.date, start: dt.date) -> dt.date:
    """The first day of the period before the one that starts on `start`."""
    return period_start(period, anchor, start - ONE_DAY)


def period_end(period: BudgetPeriod, anchor: dt.date, start: dt.date) -> dt.date:
    """The last day of the period that starts on `start`."""
    return next_start(period, anchor, start) - ONE_DAY


def starts_back(period: BudgetPeriod, anchor: dt.date, start: dt.date, count: int) -> list[dt.date]:
    """The first days of `count` periods ending with the one that starts on `start`, the
    earliest first."""
    starts = [start]
    while len(starts) < count:
        starts.append(previous_start(period, anchor, starts[-1]))
    return starts[::-1]


def default_start(
    period: BudgetPeriod, today: dt.date, *, week_starts_on: int, first_month: int
) -> dt.date:
    """Where periods start unless a budget says otherwise: weeks on the household's first day
    of the week (`week_starts_on`, 0 for Monday as Python counts), months on the 1st, and years
    in the month the household's budget year starts in."""
    if period in _DAYS:
        return today - dt.timedelta(days=(today.weekday() - week_starts_on) % 7)
    if period == BudgetPeriod.MONTHLY:
        return today.replace(day=1)
    year = today.year if today.month >= first_month else today.year - 1
    return dt.date(year, first_month, 1)
