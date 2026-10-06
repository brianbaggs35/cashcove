"""The household's finances, written out for the AI to answer questions from.

It's built fresh for every question, from the transactions, budgets, subscriptions and bills,
and holds only what a question about spending needs: totals by month and by category, the
payees most was spent with, budgets, recurring payments, the latest transactions and the ones
that mention what was asked about. It has no account in it: not a number, a name, a bank or a
balance (see ``privacy``), and money moving between the household's own accounts is left out of
income and spending as everywhere else in Cashcove.
"""

import datetime as dt
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import NamedTuple

from sqlalchemy import ColumnElement, case, func, or_, select
from sqlalchemy.orm import Session

from app.ai.privacy import Protected, Text
from app.finance.budget import Household, list_budgets
from app.finance.categories import not_a_transfer
from app.finance.dashboard import Converter
from app.finance.exchange_rates import ExchangeRateClient
from app.finance.periods import shift_months
from app.finance.transactions import like_pattern
from app.models import Account, Category, Subscription, Transaction

# How much history there is, and how much of it is spelled out.
MONTHS = 12
CATEGORY_MONTHS = 6
PAYEE_DAYS = 90
RECENT_DAYS = 45
RECENT_ROWS = 120
MATCH_ROWS = 40
TOP_CATEGORIES = 15
TOP_PAYEES = 15
KEYWORDS = 5
ZERO = Decimal("0.00")
UNCATEGORIZED = "Uncategorized"

_WORD = re.compile(r"[A-Za-z][A-Za-z0-9'&.-]{2,}")
# Words in a question that say what's wanted rather than who it was with.
_STOP = frozenset({
    "about", "account", "accounts", "afford", "after", "all", "also", "amount", "amounts",
    "and", "any", "are", "average", "been", "before", "between", "bill", "bills", "biggest",
    "bought", "budget", "budgets", "but", "can", "category", "categories", "compare",
    "compared", "cost", "did", "does", "doing", "each", "earlier", "every", "for", "from",
    "going", "have", "hidden", "household", "how", "income", "largest", "last", "left", "many",
    "month", "months", "more", "most", "much", "money", "net", "not", "now", "over", "paid",
    "per", "pay", "payee", "payment", "payments", "received", "recent", "same", "saving",
    "savings", "should", "show", "spend", "spending", "spent", "still", "than", "that", "the",
    "their", "them", "then", "these", "this", "those", "time", "total", "transaction",
    "transactions", "under", "was", "week", "weeks", "were", "what", "when", "where", "which",
    "who", "why", "will", "with", "year", "years", "you", "your",
})  # fmt: skip


class _Flow(NamedTuple):
    day: dt.date
    category_id: uuid.UUID | None
    payee: str
    currency: str
    income: Decimal
    spent: Decimal
    # How many transactions it adds up.
    transactions: int


def _money(amount: Decimal) -> str:
    return f"{amount:,.2f}"


def keywords(question: str) -> list[str]:
    """The words of a question that could be a payee, each once, the first few."""
    found: dict[str, None] = {}
    for word in _WORD.findall(question):
        lowered = word.lower().strip(".'-&")
        if len(lowered) >= 3 and lowered not in _STOP:
            found.setdefault(lowered)
    return list(found)[:KEYWORDS]


def _flows(db: Session, convert: Converter, first: dt.date, last: dt.date) -> list[_Flow]:
    """What came in and what was spent each day, by category and payee, in the household's
    currency, leaving out money moving between its own accounts."""
    income = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0))
    spent = func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0))
    rows = db.execute(
        select(
            Transaction.date,
            Transaction.category_id,
            func.min(Transaction.payee),
            Account.currency,
            income,
            spent,
            func.count(),
        )
        .join(Account, Account.id == Transaction.account_id)
        .where(Transaction.date.between(first, last), not_a_transfer())
        .group_by(
            Transaction.date,
            Transaction.category_id,
            func.lower(func.trim(Transaction.payee)),
            Account.currency,
        )
    ).all()
    convert.prepare((row.date, row.currency) for row in rows)
    flows: list[_Flow] = []
    for day, category_id, payee, currency, came_in, went_out, count in rows:
        money_in, money_out = convert(day, currency, came_in), convert(day, currency, went_out)
        if money_in is not None and money_out is not None:
            flows.append(_Flow(day, category_id, payee, currency, money_in, money_out, count))
    return flows


def _monthly(flows: list[_Flow], months: list[dt.date]) -> list[str]:
    totals: defaultdict[dt.date, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    for flow in flows:
        totals[flow.day.replace(day=1)][0] += flow.income
        totals[flow.day.replace(day=1)][1] += flow.spent
    lines = ["Month | Income | Spent | Left over"]
    for start in months:
        income, spent = totals[start]
        lines.append(
            f"{start:%Y-%m} | {_money(income)} | {_money(spent)} | {_money(income - spent)}"
        )
    return lines


def _by_category(
    flows: list[_Flow], names: dict[uuid.UUID | None, str], months: list[dt.date]
) -> list[str]:
    recent = set(months[-CATEGORY_MONTHS:])
    spent: defaultdict[uuid.UUID | None, defaultdict[dt.date, Decimal]] = defaultdict(
        lambda: defaultdict(Decimal)
    )
    for flow in flows:
        if flow.day.replace(day=1) in recent and flow.spent:
            spent[flow.category_id][flow.day.replace(day=1)] += flow.spent
    ranked = sorted(spent.items(), key=lambda item: (-sum(item[1].values()), str(item[0])))
    lines: list[str] = []
    for category_id, by_month in ranked[:TOP_CATEGORIES]:
        detail = "; ".join(f"{start:%Y-%m} {_money(by_month[start])}" for start in sorted(by_month))
        lines.append(f"{names.get(category_id, UNCATEGORIZED)}: {detail}")
    return lines


@dataclass
class _PayeeTotal:
    amount: Decimal = ZERO
    count: int = 0


def _payees(flows: list[_Flow], protected: Protected, since: dt.date) -> list[str]:
    totals: defaultdict[str, _PayeeTotal] = defaultdict(_PayeeTotal)
    for flow in flows:
        if flow.day >= since and flow.spent:
            total = totals[protected.scrub(flow.payee) or "(unknown)"]
            total.amount += flow.spent
            total.count += flow.transactions
    ranked = sorted(totals.items(), key=lambda item: (-item[1].amount, item[0].casefold()))
    return [
        f"{name}: {_money(total.amount)} over {total.count} transactions"
        for name, total in ranked[:TOP_PAYEES]
    ]


def _budgets(
    db: Session, rates: ExchangeRateClient | None, today: dt.date, protected: Protected
) -> list[str]:
    return [
        f"{protected.scrub(budget.name, Text.LABEL)} ({budget.period}): "
        f"{_money(budget.amount)} each period; this one, {budget.current.start} to "
        f"{budget.current.end}, has {_money(budget.current.spent)} spent and "
        f"{_money(budget.current.income)} income counted"
        for budget in list_budgets(db, rates, today)
    ]


def _recurring(db: Session, protected: Protected) -> list[str]:
    rows = db.scalars(
        select(Subscription)
        .where(Subscription.active.is_(True))
        .order_by(Subscription.next_due_date, Subscription.name)
    )
    return [
        f"{item.kind} {protected.scrub(item.name, Text.LABEL)}: "
        f"{'about ' if item.amount_varies else ''}{_money(item.amount)} {item.frequency}, "
        f"next due {item.next_due_date}"
        for item in rows
    ]


def _transaction_lines(
    db: Session,
    protected: Protected,
    names: dict[uuid.UUID | None, str],
    where: ColumnElement[bool],
    limit: int,
) -> list[str]:
    rows = db.execute(
        select(
            Transaction.date,
            Transaction.payee,
            Transaction.category_id,
            Transaction.amount,
            Account.currency,
        )
        .join(Account, Account.id == Transaction.account_id)
        .where(where)
        .order_by(Transaction.date.desc(), Transaction.created_at.desc(), Transaction.id)
        .limit(limit)
    )
    return [
        f"{day} | {protected.scrub(payee) or '(unknown)'} | "
        f"{protected.scrub(names.get(category_id, UNCATEGORIZED), Text.LABEL)} | "
        f"{amount:+,.2f} {currency}"
        for day, payee, category_id, amount, currency in rows
    ]


def _section(title: str, lines: list[str], empty: str) -> str:
    return f"## {title}\n" + ("\n".join(lines) if lines else empty)


def build(
    db: Session,
    rates: ExchangeRateClient | None,
    today: dt.date,
    question: str,
    protected: Protected,
) -> str:
    """Everything the AI is given to answer from, as text."""
    household = Household.load(db)
    convert = Converter(db, rates, household.currency)
    months = [shift_months(today.replace(day=1), -back) for back in range(MONTHS - 1, -1, -1)]
    flows = _flows(db, convert, months[0], today)
    names: dict[uuid.UUID | None, str] = {
        category.id: category.name for category in db.scalars(select(Category))
    }
    recent = Transaction.date.between(today - dt.timedelta(days=RECENT_DAYS), today)
    words = keywords(question)
    matches = (
        _transaction_lines(
            db,
            protected,
            names,
            or_(*(Transaction.payee.ilike(like_pattern(word), escape="\\") for word in words)),
            MATCH_ROWS,
        )
        if words
        else []
    )
    sections = [
        f"All amounts are in {household.currency} unless a line says otherwise. Today is {today}; "
        "the latest month is only partly over.",
        _section("Income and spending by month", _monthly(flows, months), "Nothing yet."),
        _section(
            f"Spending by category, latest {CATEGORY_MONTHS} months",
            _by_category(flows, names, months),
            "Nothing spent.",
        ),
        _section(
            f"Payees most was spent with, last {PAYEE_DAYS} days",
            _payees(flows, protected, today - dt.timedelta(days=PAYEE_DAYS - 1)),
            "None.",
        ),
        _section("Budgets", _budgets(db, rates, today, protected), "No budgets."),
        _section("Subscriptions and bills", _recurring(db, protected), "None are tracked."),
        _section(
            f"Latest transactions, newest first (last {RECENT_DAYS} days, up to {RECENT_ROWS}). "
            "Date | Payee | Category | Amount (+ in, - out)",
            _transaction_lines(db, protected, names, recent, RECENT_ROWS),
            "None.",
        ),
    ]
    if words:
        sections.append(
            _section(
                "Transactions whose payee matches the question, newest first. "
                "Date | Payee | Category | Amount",
                matches,
                "No transaction's payee matches the question.",
            )
        )
    unavailable = sorted(convert.unavailable)
    if unavailable:
        sections.append(
            "Left out of the totals, with no exchange rate to the household's currency: "
            + ", ".join(unavailable)
        )
    return "\n\n".join(sections)
