import datetime as dt

import pytest

from app.finance.periods import (
    MAX_PERIODS,
    default_start,
    next_start,
    period_end,
    period_start,
    previous_start,
    shift_months,
    starts_back,
)
from app.models import BudgetPeriod

WEEKLY, BIWEEKLY, MONTHLY, YEARLY = (
    BudgetPeriod.WEEKLY,
    BudgetPeriod.BIWEEKLY,
    BudgetPeriod.MONTHLY,
    BudgetPeriod.YEARLY,
)


def day(text: str) -> dt.date:
    return dt.date.fromisoformat(text)


@pytest.mark.parametrize(
    ("anchor", "months", "expected"),
    [
        ("2026-01-15", 1, "2026-02-15"),
        ("2026-01-15", 12, "2027-01-15"),
        ("2026-01-15", -13, "2024-12-15"),
        # A month too short for the day has its last day.
        ("2026-01-31", 1, "2026-02-28"),
        ("2028-01-31", 1, "2028-02-29"),
        ("2026-03-31", -1, "2026-02-28"),
        ("2028-02-29", 12, "2029-02-28"),
        ("2028-02-29", 48, "2032-02-29"),
        # It's always counted from the anchor, so the day comes back after a short month.
        ("2026-01-31", 2, "2026-03-31"),
    ],
)
def test_months_are_added_on_the_same_day_or_the_last_of_a_shorter_month(
    anchor: str, months: int, expected: str
) -> None:
    assert shift_months(day(anchor), months) == day(expected)


@pytest.mark.parametrize(
    ("period", "anchor", "on", "start", "end"),
    [
        (WEEKLY, "2026-09-14", "2026-09-14", "2026-09-14", "2026-09-20"),
        (WEEKLY, "2026-09-14", "2026-09-20", "2026-09-14", "2026-09-20"),
        (WEEKLY, "2026-09-14", "2026-09-21", "2026-09-21", "2026-09-27"),
        # Periods go back before the anchor too.
        (WEEKLY, "2026-09-14", "2026-09-13", "2026-09-07", "2026-09-13"),
        (BIWEEKLY, "2026-09-04", "2026-09-17", "2026-09-04", "2026-09-17"),
        (BIWEEKLY, "2026-09-04", "2026-09-18", "2026-09-18", "2026-10-01"),
        (BIWEEKLY, "2026-09-04", "2026-09-03", "2026-08-21", "2026-09-03"),
        (MONTHLY, "2026-09-01", "2026-09-30", "2026-09-01", "2026-09-30"),
        (MONTHLY, "2026-09-01", "2026-10-01", "2026-10-01", "2026-10-31"),
        (MONTHLY, "2026-09-01", "2026-02-10", "2026-02-01", "2026-02-28"),
        (MONTHLY, "2028-01-01", "2028-02-29", "2028-02-01", "2028-02-29"),
        # Months can start part of the way through, like the day someone is paid.
        (MONTHLY, "2026-09-15", "2026-10-14", "2026-09-15", "2026-10-14"),
        (MONTHLY, "2026-09-15", "2026-10-15", "2026-10-15", "2026-11-14"),
        (MONTHLY, "2026-09-15", "2026-09-10", "2026-08-15", "2026-09-14"),
        # Starting on the 31st, the shorter months start on their last day.
        (MONTHLY, "2026-01-31", "2026-02-27", "2026-01-31", "2026-02-27"),
        (MONTHLY, "2026-01-31", "2026-02-28", "2026-02-28", "2026-03-30"),
        (MONTHLY, "2026-01-31", "2026-03-31", "2026-03-31", "2026-04-29"),
        (YEARLY, "2026-01-01", "2026-12-31", "2026-01-01", "2026-12-31"),
        (YEARLY, "2026-04-01", "2026-03-31", "2025-04-01", "2026-03-31"),
        (YEARLY, "2026-04-01", "2027-04-01", "2027-04-01", "2028-03-31"),
        (YEARLY, "2026-04-01", "2020-06-15", "2020-04-01", "2021-03-31"),
        (YEARLY, "2028-02-29", "2029-02-27", "2028-02-29", "2029-02-27"),
        (YEARLY, "2028-02-29", "2029-02-28", "2029-02-28", "2030-02-27"),
    ],
)
def test_every_day_is_in_the_period_that_starts_on_or_before_it(
    period: BudgetPeriod, anchor: str, on: str, start: str, end: str
) -> None:
    assert period_start(period, day(anchor), day(on)) == day(start)
    assert period_end(period, day(anchor), day(start)) == day(end)


@pytest.mark.parametrize("period", list(BudgetPeriod))
@pytest.mark.parametrize("anchor", ["2026-09-14", "2026-01-31", "2028-02-29", "2026-04-01"])
def test_periods_follow_one_another_without_gaps(period: BudgetPeriod, anchor: str) -> None:
    anchored = day(anchor)
    for offset in range(-800, 800, 3):
        on = anchored + dt.timedelta(days=offset)
        start = period_start(period, anchored, on)
        end = period_end(period, anchored, start)
        following = next_start(period, anchored, start)

        assert start <= on <= end
        assert following == end + dt.timedelta(days=1)
        assert period_start(period, anchored, start) == start
        assert period_start(period, anchored, end) == start
        assert period_start(period, anchored, following) == following
        assert previous_start(period, anchored, following) == start


def test_looking_back_gives_each_period_the_earliest_first() -> None:
    anchor = day("2026-09-01")

    assert starts_back(MONTHLY, anchor, day("2026-09-01"), 3) == [
        day("2026-07-01"),
        day("2026-08-01"),
        day("2026-09-01"),
    ]
    assert starts_back(WEEKLY, day("2026-09-14"), day("2026-09-21"), 1) == [day("2026-09-21")]
    assert starts_back(WEEKLY, day("2026-09-14"), day("2026-09-21"), 0) == [day("2026-09-21")]


def test_looking_back_stops_at_the_most_periods_whatever_is_asked() -> None:
    starts = starts_back(WEEKLY, day("2026-09-14"), day("2026-09-21"), 10**9)

    assert len(starts) == MAX_PERIODS
    assert starts[-1] == day("2026-09-21")
    assert starts[0] == day("2026-09-21") - dt.timedelta(weeks=MAX_PERIODS - 1)


@pytest.mark.parametrize(
    ("period", "today", "week_starts_on", "first_month", "expected"),
    [
        # Weeks start on the household's first day of the week: Sunday is 6, Monday is 0.
        (WEEKLY, "2026-09-23", 6, 1, "2026-09-20"),
        (WEEKLY, "2026-09-23", 0, 1, "2026-09-21"),
        (WEEKLY, "2026-09-20", 6, 1, "2026-09-20"),
        (BIWEEKLY, "2026-09-26", 0, 1, "2026-09-21"),
        (MONTHLY, "2026-09-23", 6, 1, "2026-09-01"),
        # Years start in the month the household's budget year does.
        (YEARLY, "2026-09-23", 6, 1, "2026-01-01"),
        (YEARLY, "2026-09-23", 6, 4, "2026-04-01"),
        (YEARLY, "2026-09-23", 6, 10, "2025-10-01"),
        (YEARLY, "2026-10-01", 6, 10, "2026-10-01"),
    ],
)
def test_periods_start_where_the_household_would_expect_them_to(
    period: BudgetPeriod, today: str, week_starts_on: int, first_month: int, expected: str
) -> None:
    assert default_start(
        period, day(today), week_starts_on=week_starts_on, first_month=first_month
    ) == day(expected)
