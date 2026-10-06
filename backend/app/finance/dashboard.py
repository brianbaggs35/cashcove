"""The dashboard: how the household is doing this month and over the last few.

Everything is worked out from the transactions each time it's asked for, never stored, so it's
always up to date with whatever synced, was imported or was sorted by an automation since. What
counts is every transaction of every account except money moving between the household's own
accounts (a category in a transfer group): money in is income and money out is spending.
Accounts in other currencies are converted into the household's at each transaction's day's
exchange rate, as budgets do.
"""

import calendar
import datetime as dt
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.finance.budget import Household
from app.finance.categories import not_a_transfer
from app.finance.exchange_rates import ExchangeRateClient, RateBook
from app.finance.periods import shift_months
from app.models import Account, Transaction
from app.schemas.budget import CategoryTotal, DayTotal
from app.schemas.dashboard import DashboardOut, FlowToDate, MonthFlow, PayeeTotal

# How many months the history has, the one the person is in included.
MONTHS = 6
# How many payees are listed.
TOP_PAYEES = 5
ZERO = Decimal("0.00")


def _month_end(start: dt.date) -> dt.date:
    return start.replace(day=calendar.monthrange(start.year, start.month)[1])


class Converter:
    """Amounts in the household's currency, whatever currency their account is in."""

    def __init__(self, db: Session, client: ExchangeRateClient | None, currency: str) -> None:
        self.currency = currency
        self.rates = RateBook(db, client, currency)
        self.abroad: dict[str, tuple[dt.date, dt.date]] = {}

    def prepare(self, days: Iterable[tuple[dt.date, str]]) -> None:
        """Gets the rates for the days of each foreign currency ready."""
        for day, currency in days:
            if currency != self.currency:
                early, late = self.abroad.get(currency, (day, day))
                self.abroad[currency] = (min(early, day), max(late, day))
        self.rates.prepare(self.abroad)

    def __call__(self, day: dt.date, currency: str, amount: Decimal) -> Decimal | None:
        """The amount in the household's currency, or None without a rate for its day."""
        if currency == self.currency:
            return amount
        return self.rates.convert(currency, day, amount)

    @property
    def unavailable(self) -> list[str]:
        return sorted(self.rates.unavailable)

    @property
    def converted(self) -> list[str]:
        return sorted(set(self.abroad) - self.rates.unavailable)


def _by_day(
    db: Session, convert: Converter, first: dt.date, last: dt.date
) -> dict[dt.date, tuple[Decimal, Decimal]]:
    """What came in and what was spent on each day from `first` to `last`, as (income, spent)."""
    income = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0))
    spent = func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0))
    rows = db.execute(
        select(Transaction.date, Account.currency, income, spent)
        .join(Account, Account.id == Transaction.account_id)
        .where(Transaction.date.between(first, last), not_a_transfer())
        .group_by(Transaction.date, Account.currency)
    ).all()
    convert.prepare((day, currency) for day, currency, _, _ in rows)
    days: defaultdict[dt.date, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    for day, currency, came_in, went_out in rows:
        for index, amount in enumerate((came_in, went_out)):
            converted = convert(day, currency, amount)
            if converted is not None:
                days[day][index] += converted
    return {day: (income_, spent_) for day, (income_, spent_) in days.items()}


def _sum(
    days: dict[dt.date, tuple[Decimal, Decimal]], first: dt.date, last: dt.date
) -> tuple[Decimal, Decimal]:
    inside = [totals for day, totals in days.items() if first <= day <= last]
    return (
        sum((income for income, _ in inside), ZERO),
        sum((spent for _, spent in inside), ZERO),
    )


def _month(days: dict[dt.date, tuple[Decimal, Decimal]], start: dt.date) -> MonthFlow:
    end = _month_end(start)
    income, spent = _sum(days, start, end)
    return MonthFlow(start=start, end=end, income=income, spent=spent)


@dataclass
class _Total:
    """What was spent in one place, and how many transactions it was across."""

    amount: Decimal = ZERO
    count: int = 0
    # The way a payee was written, which is the first alphabetically when it's been written
    # several ways.
    name: str = ""

    def add(self, amount: Decimal, count: int, name: str) -> None:
        self.amount += amount
        self.count += count
        self.name = min(self.name or name, name)


def _spending(
    db: Session, convert: Converter, first: dt.date, last: dt.date
) -> tuple[list[CategoryTotal], list[PayeeTotal]]:
    """What was spent from `first` to `last` by category, and with each payee, the biggest
    first. Payees are the same ignoring letter case and surrounding spaces."""
    key = func.lower(func.trim(Transaction.payee))
    rows = db.execute(
        select(
            Transaction.category_id,
            key,
            func.min(Transaction.payee),
            Transaction.date,
            Account.currency,
            func.sum(-Transaction.amount),
            func.count(),
        )
        .join(Account, Account.id == Transaction.account_id)
        .where(Transaction.date.between(first, last), Transaction.amount < 0, not_a_transfer())
        .group_by(Transaction.category_id, key, Transaction.date, Account.currency)
    ).all()
    by_category: defaultdict[uuid.UUID | None, _Total] = defaultdict(_Total)
    by_payee: defaultdict[str, _Total] = defaultdict(_Total)
    for category_id, payee_key, payee, day, currency, amount, count in rows:
        converted = convert(day, currency, amount)
        if converted is not None:
            by_category[category_id].add(converted, count, payee)
            by_payee[payee_key].add(converted, count, payee)
    categories = [
        CategoryTotal(category_id=category_id, amount=total.amount, count=total.count)
        for category_id, total in by_category.items()
    ]
    categories.sort(key=lambda item: (-item.amount, str(item.category_id)))
    payees = [
        PayeeTotal(payee=total.name, amount=total.amount, count=total.count)
        for total in by_payee.values()
    ]
    payees.sort(key=lambda item: (-item.amount, item.payee.casefold()))
    return categories, payees[:TOP_PAYEES]


def dashboard(db: Session, client: ExchangeRateClient | None, today: dt.date) -> DashboardOut:
    """How the household is doing in the month `today` is in, and over the months before it."""
    convert = Converter(db, client, Household.load(db).currency)
    starts = [shift_months(today.replace(day=1), -back) for back in range(MONTHS - 1, -1, -1)]
    days = _by_day(db, convert, starts[0], _month_end(starts[-1]))
    months = [_month(days, start) for start in starts]
    this, last_month = months[-1], months[-2]

    days_gone = (min(today, this.end) - this.start).days + 1
    through = min(last_month.start + dt.timedelta(days=days_gone - 1), last_month.end)
    income, spent = _sum(days, last_month.start, through)
    categories, payees = _spending(db, convert, this.start, this.end)
    return DashboardOut(
        month=this,
        days=(this.end - this.start).days + 1,
        days_gone=days_gone,
        previous=FlowToDate(income=income, spent=spent),
        months=months,
        daily=[
            DayTotal(day=day, income=income_, spent=spent_)
            for day, (income_, spent_) in sorted(days.items())
            if this.start <= day <= this.end
        ],
        categories=categories,
        payees=payees,
        uncategorized=db.scalar(
            select(func.count()).select_from(Transaction).where(Transaction.category_id.is_(None))
        )
        or 0,
        converted=convert.converted,
        unavailable=convert.unavailable,
    )
