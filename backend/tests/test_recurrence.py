import datetime as dt
from decimal import Decimal

import pytest

from app.finance.subscriptions import advance_due_date, due_dates
from app.models import PaymentFrequency, Subscription


def due(frequency: PaymentFrequency, day: dt.date) -> Subscription:
    return Subscription(
        name="Streamflix",
        payee="Streamflix",
        amount=Decimal("14.99"),
        frequency=frequency,
        next_due_date=day,
    )


@pytest.mark.parametrize(
    ("frequency", "due_on", "paid_on", "next_due"),
    [
        # A payment on the day, or a little before it, settles the day.
        (PaymentFrequency.MONTHLY, "2026-10-15", "2026-10-15", "2026-11-15"),
        (PaymentFrequency.MONTHLY, "2026-10-15", "2026-10-14", "2026-11-15"),
        (PaymentFrequency.MONTHLY, "2026-10-15", "2026-10-01", "2026-11-15"),
        # Late ones too, however late, by as many cycles as it takes.
        (PaymentFrequency.MONTHLY, "2026-10-15", "2026-10-17", "2026-11-15"),
        (PaymentFrequency.MONTHLY, "2026-01-15", "2026-04-18", "2026-05-15"),
        # The last cycle's payment, or older history, changes nothing.
        (PaymentFrequency.MONTHLY, "2026-10-15", "2026-09-29", "2026-10-15"),
        (PaymentFrequency.MONTHLY, "2026-10-15", "2025-01-15", "2026-10-15"),
        # Each frequency steps by its own cycle.
        (PaymentFrequency.WEEKLY, "2026-10-05", "2026-10-05", "2026-10-12"),
        (PaymentFrequency.WEEKLY, "2026-10-05", "2026-10-01", "2026-10-05"),
        (PaymentFrequency.BIWEEKLY, "2026-10-05", "2026-10-02", "2026-10-19"),
        (PaymentFrequency.BIWEEKLY, "2026-10-05", "2026-09-27", "2026-10-05"),
        (PaymentFrequency.QUARTERLY, "2026-10-15", "2026-10-16", "2027-01-15"),
        (PaymentFrequency.SEMIANNUAL, "2026-10-15", "2026-10-16", "2027-04-15"),
        (PaymentFrequency.ANNUAL, "2026-10-15", "2026-10-16", "2027-10-15"),
        (PaymentFrequency.ANNUAL, "2026-10-15", "2026-04-10", "2026-10-15"),
        # Months count from the due day, so a short month doesn't move it for good.
        (PaymentFrequency.MONTHLY, "2026-01-31", "2026-01-31", "2026-02-28"),
        (PaymentFrequency.MONTHLY, "2026-01-31", "2026-03-02", "2026-03-31"),
        (PaymentFrequency.MONTHLY, "2028-01-31", "2028-01-31", "2028-02-29"),
        (PaymentFrequency.ANNUAL, "2028-02-29", "2028-03-01", "2029-02-28"),
        (PaymentFrequency.MONTHLY, "2026-12-15", "2026-12-15", "2027-01-15"),
    ],
)
def test_a_payment_settles_the_due_date_it_is_for(
    frequency: PaymentFrequency, due_on: str, paid_on: str, next_due: str
) -> None:
    subscription = due(frequency, dt.date.fromisoformat(due_on))

    advance_due_date(subscription, dt.date.fromisoformat(paid_on))

    assert subscription.next_due_date == dt.date.fromisoformat(next_due)


@pytest.mark.parametrize(
    ("frequency", "due_on", "first", "last", "expected"),
    [
        (PaymentFrequency.WEEKLY, "2026-09-22", "2026-09-20", "2026-09-30", ["09-22", "09-29"]),
        (
            PaymentFrequency.BIWEEKLY,
            "2026-09-22",
            "2026-09-20",
            "2026-10-31",
            ["09-22", "10-06", "10-20"],
        ),
        (
            PaymentFrequency.MONTHLY,
            "2026-09-25",
            "2026-09-20",
            "2026-12-31",
            ["09-25", "10-25", "11-25", "12-25"],
        ),
        (
            PaymentFrequency.QUARTERLY,
            "2026-09-15",
            "2026-09-01",
            "2027-06-30",
            ["09-15", "12-15", "2027-03-15", "2027-06-15"],
        ),
        (
            PaymentFrequency.SEMIANNUAL,
            "2026-09-15",
            "2026-09-01",
            "2027-09-30",
            ["09-15", "2027-03-15", "2027-09-15"],
        ),
        (
            PaymentFrequency.ANNUAL,
            "2026-09-15",
            "2026-01-01",
            "2028-12-31",
            ["09-15", "2027-09-15", "2028-09-15"],
        ),
        # Only the days asked about, from the next due date on.
        (PaymentFrequency.MONTHLY, "2026-12-25", "2026-09-01", "2026-09-30", []),
        (PaymentFrequency.MONTHLY, "2026-09-25", "2026-10-01", "2026-10-31", ["10-25"]),
        # A payment that has been due for years doesn't mean counting every one since.
        (PaymentFrequency.WEEKLY, "2020-01-06", "2026-09-20", "2026-10-01", ["09-21", "09-28"]),
        (PaymentFrequency.MONTHLY, "2020-01-31", "2026-09-01", "2026-10-31", ["09-30", "10-31"]),
    ],
)
def test_the_days_a_subscription_falls_due_are_counted_on_from_its_next_one(
    frequency: PaymentFrequency, due_on: str, first: str, last: str, expected: list[str]
) -> None:
    subscription = due(frequency, dt.date.fromisoformat(due_on))

    days = due_dates(subscription, dt.date.fromisoformat(first), dt.date.fromisoformat(last))

    assert [str(day) for day in days] == [
        value if len(value) > 5 else f"2026-{value}" for value in expected
    ]
