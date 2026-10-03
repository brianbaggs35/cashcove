"""Budgets: what each category plans for a month or a budget year, what actually came in or
went out, and changing budgets from a month on.

Totals are worked out from the transactions every time they're asked for, never stored, so
they're always up to date, whatever synced, was imported, undone or recategorized since.
Accounts in other currencies count too, converted into the household's at each transaction's
day's exchange rate.
"""

import datetime as dt
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, NamedTuple

from fastapi import status
from sqlalchemy import (
    ColumnElement,
    Date,
    Select,
    SQLColumnExpression,
    case,
    cast,
    delete,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased, selectinload

from app.auth.deps import ApiError
from app.auth.service import load_preferences
from app.finance.categories import KIND_ORDER
from app.finance.exchange_rates import ExchangeRateClient, RateBook
from app.models import (
    Account,
    Budget,
    BudgetAmount,
    BudgetPeriod,
    Category,
    CategoryGroup,
    CategoryKind,
    Subscription,
    Transaction,
    budget_subscriptions,
    budget_transactions,
)
from app.models.base import CENT
from app.schemas.budget import (
    BudgetChange,
    BudgetConfiguration,
    BudgetGroup,
    BudgetLine,
    BudgetMonth,
    BudgetPlan,
    BudgetYear,
    BudgetYearGroup,
    BudgetYearLine,
    CategoryHistory,
    HistoryMonth,
    MonthCell,
    MonthTotals,
    Scope,
    Totals,
    Uncategorized,
    UncategorizedMonth,
    YearMonth,
    YearUncategorized,
)

MONTHS_IN_YEAR = 12
# How many months before the one being looked at an average covers, to suggest a budget.
AVERAGE_MONTHS = 3
HISTORY_MONTHS = 12
ZERO = Decimal("0.00")
BUDGETED_KINDS = (CategoryKind.INCOME, CategoryKind.EXPENSE)


# ---- Months ------------------------------------------------------------------------------


def add_months(month: dt.date, count: int) -> dt.date:
    """The first day of the month `count` months after `month` (before, when negative)."""
    index = month.year * MONTHS_IN_YEAR + month.month - 1 + count
    return dt.date(index // MONTHS_IN_YEAR, index % MONTHS_IN_YEAR + 1, 1)


def months_between(start: dt.date, end: dt.date) -> int:
    """How many months `end` is after `start`: 0 for the same month."""
    return (end.year - start.year) * MONTHS_IN_YEAR + end.month - start.month


def year_start(month: dt.date, first_month: int) -> dt.date:
    """The first month of the budget year `month` is in, for years starting in `first_month`."""
    year = month.year if month.month >= first_month else month.year - 1
    return dt.date(year, first_month, 1)


def _twelfth(total: Decimal) -> Decimal:
    """A month's share of a year's budget."""
    return (total / MONTHS_IN_YEAR).quantize(CENT, ROUND_HALF_UP)


def _cycles_in_month(month: dt.date, anchor: dt.date, days: int) -> int:
    """How many weekly or biweekly cycles start in this calendar month."""
    end = add_months(month, 1)
    offset = (month - anchor).days
    first_index = max(0, (offset + days - 1) // days)
    first = anchor + dt.timedelta(days=first_index * days)
    if first >= end:
        return 0
    distance = (end - first).days
    return (distance + days - 1) // days


def amount_at(amounts: Iterable[BudgetAmount], month: dt.date) -> Decimal | None:
    """What's budgeted in `month`: the latest amount to start on or before it."""
    started = [row for row in amounts if row.starts_on <= month]
    return max(started, key=lambda row: row.starts_on).amount if started else None


# ---- What came in and went out -------------------------------------------------------------


@dataclass
class Flow:
    """What a category's transactions came to in a month."""

    net: Decimal = ZERO
    # Money in and money out, both as positive amounts.
    received: Decimal = ZERO
    spent: Decimal = ZERO
    count: int = 0


_NONE = Flow()

FlowKey = tuple[uuid.UUID | None, dt.date]


class _FlowRow(NamedTuple):
    """What a category's transactions in one account came to in a month, or on a day."""

    category: uuid.UUID | None
    period: dt.date
    account_id: uuid.UUID
    currency: str
    net: Decimal
    received: Decimal
    spent: Decimal
    transactions: int


def _flow_statement(
    period: SQLColumnExpression[dt.date],
    currency: ColumnElement[bool],
    start: dt.date,
    end: dt.date,
    category_id: uuid.UUID | None,
) -> Select[*tuple[Any, ...]]:
    """What the transactions of accounts in `currency` came to in each `period` (a month or a
    day), by category and account. An explicitly linked transaction belongs to that budget's
    category."""
    received = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0))
    spent = func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0))
    transaction_links = budget_transactions.alias("budget_transaction_links")
    subscription_links = budget_subscriptions.alias("budget_subscription_links")
    transaction_budget = aliased(Budget)
    subscription_budget = aliased(Budget)
    effective_category = case(
        (transaction_links.c.transaction_id.is_not(None), transaction_budget.category_id),
        (subscription_links.c.subscription_id.is_not(None), subscription_budget.category_id),
        else_=Transaction.category_id,
    )
    statement = (
        select(
            effective_category,
            period,
            Transaction.account_id,
            Account.currency,
            func.sum(Transaction.amount),
            received,
            spent,
            func.count(),
        )
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(
            transaction_links,
            transaction_links.c.transaction_id == Transaction.id,
        )
        .outerjoin(transaction_budget, transaction_budget.id == transaction_links.c.budget_id)
        .outerjoin(
            subscription_links,
            subscription_links.c.subscription_id == Transaction.subscription_id,
        )
        .outerjoin(
            subscription_budget,
            subscription_budget.id == subscription_links.c.budget_id,
        )
        .where(currency, Transaction.date >= start, Transaction.date < end)
        .group_by(effective_category, period, Transaction.account_id, Account.currency)
    )
    if category_id is not None:
        statement = statement.where(effective_category == category_id)
    return statement


def _flows(
    db: Session,
    rates: RateBook,
    start: dt.date,
    end: dt.date,
    category_id: uuid.UUID | None = None,
    account_scopes: dict[uuid.UUID, set[uuid.UUID]] | None = None,
) -> dict[FlowKey, Flow]:
    """What each budget category's transactions came to each month, respecting its account
    scope. Accounts in other currencies are converted into the household's (`rates.quote`)
    a day at a time, at each day's rate; those without rates are left out."""
    flows: dict[FlowKey, Flow] = {}

    def add(row: _FlowRow, month: dt.date, flow: Flow) -> None:
        scope = account_scopes.get(row.category) if account_scopes and row.category else None
        if scope and row.account_id not in scope:
            return
        total = flows.setdefault((row.category, month), Flow())
        total.net += flow.net
        total.received += flow.received
        total.spent += flow.spent
        total.count += flow.count

    month = cast(func.date_trunc("month", Transaction.date), Date)
    at_home = Account.currency == rates.quote
    for row in map(
        _FlowRow._make, db.execute(_flow_statement(month, at_home, start, end, category_id))
    ):
        add(row, row.period, Flow(row.net, row.received, row.spent, row.transactions))

    abroad = list(
        map(
            _FlowRow._make,
            db.execute(_flow_statement(Transaction.date, ~at_home, start, end, category_id)),
        )
    )
    days: dict[str, tuple[dt.date, dt.date]] = {}
    for row in abroad:
        first, last = days.get(row.currency, (row.period, row.period))
        days[row.currency] = (min(first, row.period), max(last, row.period))
    rates.prepare(days)
    for row in abroad:
        received = rates.convert(row.currency, row.period, row.received)
        spent = rates.convert(row.currency, row.period, row.spent)
        if received is not None and spent is not None:
            add(
                row,
                row.period.replace(day=1),
                Flow(received - spent, received, spent, row.transactions),
            )
    return flows


def _net(
    flows: dict[FlowKey, Flow], category_id: uuid.UUID, start: dt.date, months: int
) -> Decimal:
    """What a category's transactions came to over `months` months from `start`."""
    return sum(
        (flows.get((category_id, add_months(start, index)), _NONE).net for index in range(months)),
        ZERO,
    )


def _foreign_currencies(db: Session, currency: str, start: dt.date, end: dt.date) -> list[str]:
    """The currencies of other accounts with transactions from `start` until `end`."""
    return list(
        db.scalars(
            select(Account.currency)
            .join(Transaction, Transaction.account_id == Account.id)
            .where(Account.currency != currency, Transaction.date >= start, Transaction.date < end)
            .distinct()
            .order_by(Account.currency)
        )
    )


# ---- The household's budgets -------------------------------------------------------------


def _counted(kind: CategoryKind, net: Decimal) -> Decimal:
    """What transactions that came to `net` count as: what went out, for spending, or what
    came in, for income. (Adding zero keeps -0.00 from showing up.)"""
    return (-net if kind == CategoryKind.EXPENSE else net) + ZERO


@dataclass
class Household:
    """What every budget view needs: the household's currency and budget year, its income and
    spending categories, their budgets, and when its transactions start."""

    currency: str
    first_month: int
    # Income first, then spending, each by name.
    groups: list[CategoryGroup]
    budgets: dict[uuid.UUID, Budget]
    account_scopes: dict[uuid.UUID, set[uuid.UUID]]
    # The month of its earliest transaction, if it has any.
    earliest: dt.date | None

    @classmethod
    def load(cls, db: Session) -> "Household":
        preferences = load_preferences(db)
        general = preferences.general
        groups = sorted(
            db.scalars(
                select(CategoryGroup)
                .where(CategoryGroup.kind.in_(BUDGETED_KINDS))
                .options(selectinload(CategoryGroup.categories))
            ),
            key=lambda group: (KIND_ORDER[group.kind], group.name.casefold()),
        )
        budgets = list(
            db.scalars(
                select(Budget)
                .options(selectinload(Budget.amounts), selectinload(Budget.accounts))
                .order_by(Budget.category_id)
            )
        )
        earliest = db.scalar(select(func.min(Transaction.date)))
        return cls(
            currency=general.currency,
            first_month=general.fiscal_year_start_month,
            groups=groups,
            budgets={budget.category_id: budget for budget in budgets},
            account_scopes={
                budget.category_id: {account.id for account in budget.accounts}
                for budget in budgets
                if budget.accounts
            },
            earliest=earliest and earliest.replace(day=1),
        )

    def categories(self, group: CategoryGroup) -> list[Category]:
        return sorted(group.categories, key=lambda category: category.name.casefold())

    def average(
        self, flows: dict[FlowKey, Flow], category: Category, kind: CategoryKind, month: dt.date
    ) -> Decimal:
        """What the category came to in a month, on average, over the months before `month`
        that the household has transactions for, up to three."""
        start = add_months(month, -AVERAGE_MONTHS)
        if self.earliest is not None:
            start = max(start, self.earliest)
        months = months_between(start, month)
        if self.earliest is None or months <= 0:
            return ZERO
        total = _counted(kind, _net(flows, category.id, start, months))
        return max(ZERO, (total / months).quantize(CENT, ROUND_HALF_UP))


def _carried(budget: Budget, since: dt.date, month: dt.date, flows: dict[FlowKey, Flow]) -> Decimal:
    """What a monthly spending budget that rolls over carries into `month`: what was left of
    each month since rollover started, less what went over."""
    total = ZERO
    current = since
    while current < month:
        spent = -flows.get((budget.category_id, current), _NONE).net
        total += (amount_at(budget.amounts, current) or ZERO) - spent
        current = add_months(current, 1)
    return total


def _rollover_since(budget: Budget | None, kind: CategoryKind) -> dt.date | None:
    """When a budget started rolling over, for a monthly spending budget that does."""
    if budget is None or budget.period != BudgetPeriod.MONTHLY or kind != CategoryKind.EXPENSE:
        return None
    return budget.rollover_since


def monthly_budgeted(budget: Budget | None, month: dt.date) -> Decimal:
    if budget is None:
        return ZERO
    amount = amount_at(budget.amounts, month)
    if amount is None:
        return ZERO
    if budget.period == BudgetPeriod.YEARLY:
        return _twelfth(amount)
    if budget.period in (BudgetPeriod.WEEKLY, BudgetPeriod.BIWEEKLY):
        if budget.cycle_anchor is None:
            raise RuntimeError("A weekly or biweekly budget must have a cycle anchor.")
        days = 7 if budget.period == BudgetPeriod.WEEKLY else 14
        return amount * _cycles_in_month(month, budget.cycle_anchor, days)
    return amount


# ---- A month -------------------------------------------------------------------------------


def _month_line(
    household: Household,
    category: Category,
    kind: CategoryKind,
    month: dt.date,
    flows: dict[FlowKey, Flow],
) -> BudgetLine:
    budget = household.budgets.get(category.id)
    flow = flows.get((category.id, month), _NONE)
    since = _rollover_since(budget, kind)
    amount: Decimal | None = None
    year_to_date: Decimal | None = None
    carried = ZERO
    if budget is not None and budget.period == BudgetPeriod.YEARLY:
        start = year_start(month, household.first_month)
        amount = amount_at(budget.amounts, add_months(start, MONTHS_IN_YEAR - 1))
        year_to_date = _counted(
            kind, _net(flows, category.id, start, months_between(start, month) + 1)
        )
    elif budget is not None:
        amount = amount_at(budget.amounts, month)
        if since is not None:
            carried = _carried(budget, since, month, flows)
    return BudgetLine(
        category_id=category.id,
        name=category.name,
        emoji=category.emoji,
        period=budget.period if budget else None,
        amount=amount,
        budgeted=monthly_budgeted(budget, month),
        rollover=since is not None,
        carried=carried,
        actual=_counted(kind, flow.net),
        year_to_date=year_to_date,
        average=household.average(flows, category, kind, month),
        count=flow.count,
    )


def _month_totals(
    groups: Sequence[BudgetGroup],
    kind: CategoryKind,
    extra: Decimal,
    flows: dict[FlowKey, Flow],
    month: dt.date,
) -> MonthTotals:
    """What a kind's budgets add up to in a month, and what came in or went out."""
    lines = [line for group in groups if group.kind == kind for line in group.categories]
    recurring = sum((line.budgeted for line in lines if line.period != BudgetPeriod.YEARLY), ZERO)
    yearly = sum(
        (line.amount or ZERO for line in lines if line.period == BudgetPeriod.YEARLY), ZERO
    )
    return MonthTotals(
        budgeted=recurring + _twelfth(yearly),
        carried=sum((line.carried for line in lines), ZERO),
        actual=sum(
            (_counted(kind, flows.get((line.category_id, month), _NONE).net) for line in lines),
            extra,
        ),
    )


def _currency_notes(
    db: Session, rates: RateBook, start: dt.date, end: dt.date
) -> tuple[list[str], list[str]]:
    """The other currencies with transactions from `start` until `end`, split into those that
    were converted and those that couldn't be, which are left out."""
    abroad = _foreign_currencies(db, rates.quote, start, end)
    return (
        [currency for currency in abroad if currency not in rates.unavailable],
        [currency for currency in abroad if currency in rates.unavailable],
    )


def budget_month(db: Session, month: dt.date, client: ExchangeRateClient | None) -> BudgetMonth:
    household = Household.load(db)
    rates = RateBook(db, client, household.currency)
    start = year_start(month, household.first_month)
    rollovers = [
        budget.rollover_since
        for budget in household.budgets.values()
        if budget.rollover_since is not None and budget.rollover_since < month
    ]
    after = add_months(month, 1)
    flow_start = min(start, add_months(month, -AVERAGE_MONTHS), *rollovers)
    flows = _flows(db, rates, flow_start, after, account_scopes=household.account_scopes)
    all_flows = _flows(db, rates, flow_start, after) if household.account_scopes else flows
    groups = [
        BudgetGroup(
            id=group.id,
            name=group.name,
            kind=group.kind,
            categories=[
                _month_line(household, category, group.kind, month, flows)
                for category in household.categories(group)
            ],
        )
        for group in household.groups
    ]
    loose = flows.get((None, month), _NONE)
    converted, unconverted = _currency_notes(db, rates, month, after)
    return BudgetMonth(
        month=month,
        currency=household.currency,
        year=start.year,
        year_start=start,
        year_end=add_months(start, MONTHS_IN_YEAR - 1),
        income=_month_totals(groups, CategoryKind.INCOME, loose.received, all_flows, month),
        spending=_month_totals(groups, CategoryKind.EXPENSE, loose.spent, all_flows, month),
        groups=groups,
        uncategorized=Uncategorized(received=loose.received, spent=loose.spent, count=loose.count),
        converted_currencies=converted,
        unconverted_currencies=unconverted,
    )


# ---- A year --------------------------------------------------------------------------------


def _year_line(
    category: Category,
    kind: CategoryKind,
    budget: Budget | None,
    months: Sequence[dt.date],
    flows: dict[FlowKey, Flow],
) -> BudgetYearLine:
    cells = [
        MonthCell(
            budgeted=(
                monthly_budgeted(budget, month)
                if budget is not None and amount_at(budget.amounts, month) is not None
                else None
            ),
            actual=_counted(kind, flows.get((category.id, month), _NONE).net),
        )
        for month in months
    ]
    amount: Decimal | None = None
    if budget is not None and budget.period == BudgetPeriod.YEARLY:
        amount = amount_at(budget.amounts, months[-1])
    elif budgeted := [cell.budgeted for cell in cells if cell.budgeted is not None]:
        amount = sum(budgeted, ZERO)
    return BudgetYearLine(
        category_id=category.id,
        name=category.name,
        emoji=category.emoji,
        period=budget.period if budget else None,
        amount=amount,
        actual=sum((cell.actual for cell in cells), ZERO),
        months=cells,
    )


def _year_line_budgeted(line: BudgetYearLine) -> Decimal:
    if line.period == BudgetPeriod.YEARLY:
        return line.amount or ZERO
    return sum((cell.budgeted or ZERO for cell in line.months), ZERO)


def _year_totals(
    groups: Sequence[BudgetYearGroup], kind: CategoryKind, index: int | None = None
) -> tuple[Decimal, Decimal]:
    """What the year's (or one of its months') budgets and actual amounts of a kind add up
    to. A month counts a twelfth of each yearly budget."""
    lines = [line for group in groups if group.kind == kind for line in group.categories]
    if index is None:
        budgeted = sum((_year_line_budgeted(line) for line in lines), ZERO)
        actual = sum((line.actual for line in lines), ZERO)
    else:
        cells = [line.months[index] for line in lines]
        budgeted = sum((cell.budgeted or ZERO for cell in cells), ZERO)
        actual = sum((cell.actual for cell in cells), ZERO)
    return budgeted, actual


def budget_year(db: Session, year: int, client: ExchangeRateClient | None) -> BudgetYear:
    household = Household.load(db)
    rates = RateBook(db, client, household.currency)
    start = dt.date(year, household.first_month, 1)
    months = [add_months(start, index) for index in range(MONTHS_IN_YEAR)]
    after = add_months(start, MONTHS_IN_YEAR)
    flows = _flows(db, rates, start, after, account_scopes=household.account_scopes)
    all_flows = _flows(db, rates, start, after) if household.account_scopes else flows
    groups = [
        BudgetYearGroup(
            id=group.id,
            name=group.name,
            kind=group.kind,
            categories=[
                _year_line(
                    category,
                    group.kind,
                    household.budgets.get(category.id),
                    months,
                    flows,
                )
                for category in household.categories(group)
            ],
        )
        for group in household.groups
    ]
    loose = [flows.get((None, month), _NONE) for month in months]
    received = sum((flow.received for flow in loose), ZERO)
    spent = sum((flow.spent for flow in loose), ZERO)

    def totals(kind: CategoryKind, index: int | None = None) -> Totals:
        budgeted, _ = _year_totals(groups, kind, index)
        category_ids = [
            line.category_id for group in groups if group.kind == kind for line in group.categories
        ]
        selected_months = months if index is None else [months[index]]
        actual = sum(
            (
                _counted(kind, all_flows.get((category_id, month), _NONE).net)
                for month in selected_months
                for category_id in category_ids
            ),
            ZERO,
        )
        extra = loose[index] if index is not None else Flow(received=received, spent=spent)
        return Totals(
            budgeted=budgeted,
            actual=actual + (extra.received if kind == CategoryKind.INCOME else extra.spent),
        )

    converted, unconverted = _currency_notes(db, rates, start, after)
    return BudgetYear(
        year=year,
        start=start,
        end=months[-1],
        currency=household.currency,
        income=totals(CategoryKind.INCOME),
        spending=totals(CategoryKind.EXPENSE),
        months=[
            YearMonth(
                month=month,
                income=totals(CategoryKind.INCOME, index),
                spending=totals(CategoryKind.EXPENSE, index),
            )
            for index, month in enumerate(months)
        ],
        groups=groups,
        uncategorized=YearUncategorized(
            received=received,
            spent=spent,
            count=sum(flow.count for flow in loose),
            months=[UncategorizedMonth(received=flow.received, spent=flow.spent) for flow in loose],
        ),
        converted_currencies=converted,
        unconverted_currencies=unconverted,
    )


# ---- One category --------------------------------------------------------------------------


def _budgetable(category: Category | None) -> Category:
    """A category that can have a budget: income or spending, not transfers."""
    if category is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That category doesn't exist anymore."
        )
    if category.group.kind == CategoryKind.TRANSFER:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "transfer_category",
            f"{category.name} is for money moving between your own accounts, which isn't budgeted.",
        )
    return category


def category_history(
    db: Session, category_id: uuid.UUID, month: dt.date, client: ExchangeRateClient | None
) -> CategoryHistory:
    category = _budgetable(db.get(Category, category_id))
    kind = category.group.kind
    general = load_preferences(db).general
    start = add_months(month, 1 - HISTORY_MONTHS)
    budget = db.scalar(
        select(Budget)
        .where(Budget.category_id == category.id)
        .options(selectinload(Budget.amounts), selectinload(Budget.accounts))
    )
    account_scopes = (
        {category.id: {account.id for account in budget.accounts}}
        if budget is not None and budget.accounts
        else None
    )
    flows = _flows(
        db,
        RateBook(db, client, general.currency),
        start,
        add_months(month, 1),
        category.id,
        account_scopes,
    )
    has_monthly_budget = budget is not None and budget.period != BudgetPeriod.YEARLY
    months = [add_months(start, index) for index in range(HISTORY_MONTHS)]
    return CategoryHistory(
        category_id=category.id,
        kind=kind,
        months=[
            HistoryMonth(
                month=current,
                budgeted=(
                    monthly_budgeted(budget, current)
                    if has_monthly_budget
                    and budget is not None
                    and amount_at(budget.amounts, current) is not None
                    else None
                ),
                actual=_counted(kind, flows.get((category.id, current), _NONE).net),
            )
            for current in months
        ],
    )


def budget_configurations(db: Session, month: dt.date) -> list[BudgetConfiguration]:
    budgets = list(
        db.scalars(
            select(Budget)
            .options(selectinload(Budget.amounts), selectinload(Budget.accounts))
            .order_by(Budget.category_id)
        )
    )
    linked: dict[uuid.UUID, list[uuid.UUID]] = {}
    for budget_id, transaction_id in db.execute(
        select(budget_transactions.c.budget_id, budget_transactions.c.transaction_id)
        .join(Transaction, Transaction.id == budget_transactions.c.transaction_id)
        .where(
            Transaction.date >= month,
            Transaction.date < add_months(month, 1),
        )
        .order_by(Transaction.date, Transaction.id)
    ):
        linked.setdefault(budget_id, []).append(transaction_id)
    linked_subscriptions: dict[uuid.UUID, list[uuid.UUID]] = {}
    for budget_id, subscription_id in db.execute(
        select(budget_subscriptions.c.budget_id, budget_subscriptions.c.subscription_id)
        .join(Subscription, Subscription.id == budget_subscriptions.c.subscription_id)
        .order_by(Subscription.name, Subscription.id)
    ):
        linked_subscriptions.setdefault(budget_id, []).append(subscription_id)
    return [
        BudgetConfiguration(
            id=budget.id,
            category_id=budget.category_id,
            period=budget.period,
            amount=amount_at(budget.amounts, month),
            rollover=budget.rollover_since is not None,
            cycle_anchor=budget.cycle_anchor,
            account_ids=[account.id for account in budget.accounts],
            linked_transaction_ids=linked.get(budget.id, []),
            linked_subscription_ids=linked_subscriptions.get(budget.id, []),
        )
        for budget in budgets
    ]


def link_budget_transaction(db: Session, category_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
    category = _budgetable(db.get(Category, category_id))
    budget = db.scalar(
        select(Budget)
        .where(Budget.category_id == category.id)
        .with_for_update()
        .options(selectinload(Budget.accounts))
    )
    if budget is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "budget_not_found",
            "Set a budget for this category before linking transactions.",
        )
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "transaction_not_found",
            "That transaction doesn't exist anymore.",
        )
    if budget.accounts and transaction.account_id not in {item.id for item in budget.accounts}:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "budget_account",
            "Link a transaction from one of this budget's selected accounts.",
        )
    if (category.group.kind == CategoryKind.INCOME and transaction.amount <= 0) or (
        category.group.kind == CategoryKind.EXPENSE and transaction.amount >= 0
    ):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "budget_transaction_direction",
            "Link incoming transactions to income budgets and outgoing transactions to spending "
            "budgets.",
        )
    existing = db.scalar(
        select(budget_transactions.c.budget_id).where(
            budget_transactions.c.transaction_id == transaction_id
        )
    )
    if existing is not None:
        if existing == budget.id:
            return
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "transaction_already_linked",
            "That transaction is already linked to another budget.",
        )
    db.execute(
        insert(budget_transactions)
        .values(transaction_id=transaction_id, budget_id=budget.id)
        .on_conflict_do_nothing(index_elements=["transaction_id"])
    )
    existing = db.scalar(
        select(budget_transactions.c.budget_id).where(
            budget_transactions.c.transaction_id == transaction_id
        )
    )
    if existing != budget.id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "transaction_already_linked",
            "That transaction is already linked to another budget.",
        )


def unlink_budget_transaction(
    db: Session, category_id: uuid.UUID, transaction_id: uuid.UUID
) -> None:
    category = _budgetable(db.get(Category, category_id))
    budget_id = db.scalar(select(Budget.id).where(Budget.category_id == category.id))
    if budget_id is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "budget_not_found",
            "That budget doesn't exist anymore.",
        )
    db.execute(
        delete(budget_transactions).where(
            budget_transactions.c.budget_id == budget_id,
            budget_transactions.c.transaction_id == transaction_id,
        )
    )


def link_budget_subscription(
    db: Session, category_id: uuid.UUID, subscription_id: uuid.UUID
) -> None:
    category = _budgetable(db.get(Category, category_id))
    if category.group.kind != CategoryKind.EXPENSE:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "subscription_not_expense",
            "Subscriptions can only be linked to a spending budget.",
        )
    budget = db.scalar(
        select(Budget)
        .where(Budget.category_id == category.id)
        .with_for_update()
        .options(selectinload(Budget.accounts))
    )
    if budget is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "budget_not_found",
            "Set a budget for this category before linking subscriptions.",
        )
    subscription = db.get(Subscription, subscription_id)
    if subscription is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "subscription_not_found",
            "That subscription doesn't exist anymore.",
        )
    if budget.accounts and subscription.account_id not in {item.id for item in budget.accounts}:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "budget_account",
            "Link a subscription from one of this budget's selected accounts.",
        )
    existing = db.scalar(
        select(budget_subscriptions.c.budget_id).where(
            budget_subscriptions.c.subscription_id == subscription_id
        )
    )
    if existing is not None:
        if existing == budget.id:
            return
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "subscription_already_linked",
            "That subscription is already linked to another budget.",
        )
    db.execute(
        insert(budget_subscriptions)
        .values(subscription_id=subscription_id, budget_id=budget.id)
        .on_conflict_do_nothing(index_elements=["subscription_id"])
    )
    existing = db.scalar(
        select(budget_subscriptions.c.budget_id).where(
            budget_subscriptions.c.subscription_id == subscription_id
        )
    )
    if existing != budget.id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "subscription_already_linked",
            "That subscription is already linked to another budget.",
        )


def unlink_budget_subscription(
    db: Session, category_id: uuid.UUID, subscription_id: uuid.UUID
) -> None:
    category = _budgetable(db.get(Category, category_id))
    budget_id = db.scalar(select(Budget.id).where(Budget.category_id == category.id))
    if budget_id is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "budget_not_found",
            "That budget doesn't exist anymore.",
        )
    db.execute(
        delete(budget_subscriptions).where(
            budget_subscriptions.c.budget_id == budget_id,
            budget_subscriptions.c.subscription_id == subscription_id,
        )
    )


# ---- Changing budgets ----------------------------------------------------------------------


def _locked_budgets(
    db: Session, category_ids: Sequence[uuid.UUID], *, create: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Budget]:
    """The categories' budgets, locked against other changes until the commit. Categories in
    `create` get a monthly budget if they have none."""
    new = [
        {"id": uuid.uuid4(), "category_id": category_id, "period": BudgetPeriod.MONTHLY}
        for category_id in create
    ]
    if new:
        # Two admins budgeting the same category at once both end up with the one budget.
        db.execute(
            insert(Budget).values(new).on_conflict_do_nothing(index_elements=["category_id"])
        )
    budgets = db.scalars(
        select(Budget)
        .where(Budget.category_id.in_(category_ids))
        # Locked in the same order every time, so two requests can't each wait on the other.
        .order_by(Budget.category_id)
        .with_for_update()
        .options(selectinload(Budget.amounts), selectinload(Budget.accounts))
        .execution_options(populate_existing=True)
    )
    return {budget.category_id: budget for budget in budgets}


def _period(budget: Budget, month: dt.date, first_month: int) -> tuple[dt.date, dt.date]:
    """The month, or budget year, that `month` is in for the budget, and the one after it."""
    if budget.period == BudgetPeriod.YEARLY:
        start = year_start(month, first_month)
        return start, add_months(start, MONTHS_IN_YEAR)
    return month, add_months(month, 1)


def _set_budget_accounts(db: Session, budget: Budget, account_ids: Sequence[uuid.UUID]) -> None:
    accounts = list(db.scalars(select(Account).where(Account.id.in_(account_ids))))
    if len(accounts) != len(set(account_ids)):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_account",
            "Choose accounts that still exist.",
        )
    if account_ids:
        linked_account = db.scalar(
            select(Transaction.account_id)
            .join(
                budget_transactions,
                budget_transactions.c.transaction_id == Transaction.id,
            )
            .where(
                budget_transactions.c.budget_id == budget.id,
                Transaction.account_id.not_in(account_ids),
            )
            .limit(1)
        )
        if linked_account is not None:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "linked_transaction_outside_accounts",
                "Unlink transactions from other accounts before changing this account scope.",
            )
        linked_subscription_account = db.scalar(
            select(Subscription.account_id)
            .join(
                budget_subscriptions,
                budget_subscriptions.c.subscription_id == Subscription.id,
            )
            .where(
                budget_subscriptions.c.budget_id == budget.id,
                Subscription.account_id.not_in(account_ids),
            )
            .limit(1)
        )
        if linked_subscription_account is not None:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "linked_subscription_outside_accounts",
                "Unlink subscriptions from other accounts before changing this account scope.",
            )
    budget.accounts = accounts


def _set_amount(
    db: Session,
    budget: Budget,
    month: dt.date,
    first_month: int,
    amount: Decimal | None,
    scope: Scope,
) -> None:
    """Budgets `amount` from the month (or budget year) that `month` is in on, replacing what
    was planned after it, or only for that month, leaving the ones after it as they were.
    A budget left with nothing budgeted in any month is deleted."""
    start, following = _period(budget, month, first_month)
    rows = {row.starts_on: row for row in budget.amounts}
    if scope == "only" and following not in rows:
        budget.amounts.append(
            BudgetAmount(starts_on=following, amount=amount_at(budget.amounts, following))
        )
    if scope == "onward":
        for row in [row for row in budget.amounts if row.starts_on > start]:
            budget.amounts.remove(row)
    if start in rows:
        rows[start].amount = amount
    else:
        budget.amounts.append(BudgetAmount(starts_on=start, amount=amount))
    # Amounts that change nothing go: the same as the one before, or none before any.
    previous: Decimal | None = None
    for row in sorted(budget.amounts, key=lambda row: row.starts_on):
        if row.amount == previous:
            budget.amounts.remove(row)
        else:
            previous = row.amount
    if not budget.amounts:
        db.delete(budget)


def change_budget(db: Session, category_id: uuid.UUID, change: BudgetChange) -> None:
    category = _budgetable(db.get(Category, category_id))
    kind = category.group.kind
    if change.rollover and kind != CategoryKind.EXPENSE:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "rollover_income",
            "Only spending rolls over to the next month.",
        )
    creating = [category.id] if change.amount is not None else []
    budget = _locked_budgets(db, [category.id], create=creating).get(category.id)
    if budget is None:
        # Nothing to stop budgeting.
        return
    first_month = load_preferences(db).general.fiscal_year_start_month
    _set_budget_period(db, budget, change)
    if change.account_ids is not None:
        _set_budget_accounts(db, budget, change.account_ids)
    _set_amount(db, budget, change.month, first_month, change.amount, change.scope)
    if change.amount is not None:
        start, _ = _period(budget, change.month, first_month)
        budget.rollover_since = (budget.rollover_since or start) if change.rollover else None


def _set_budget_period(db: Session, budget: Budget, change: BudgetChange) -> None:
    if change.amount is None:
        return
    recurring = change.period in (BudgetPeriod.WEEKLY, BudgetPeriod.BIWEEKLY)
    if budget.period != change.period:
        budget.amounts.clear()
        budget.rollover_since = None
        budget.period = change.period
        budget.cycle_anchor = (change.cycle_anchor or change.month) if recurring else None
        db.flush()
    elif recurring and change.cycle_anchor is not None:
        budget.cycle_anchor = change.cycle_anchor


def delete_budget(db: Session, category_id: uuid.UUID) -> None:
    budget = db.scalar(select(Budget).where(Budget.category_id == category_id).with_for_update())
    if budget is not None:
        db.delete(budget)


def plan_budget(db: Session, month: dt.date, plan: BudgetPlan) -> None:
    """Budgets several categories for the month. Categories with a yearly budget are budgeted
    for the budget year the month is in."""
    ids = [item.category_id for item in plan.amounts]
    categories = {
        category.id: category
        for category in db.scalars(
            select(Category).where(Category.id.in_(ids)).options(selectinload(Category.group))
        )
    }
    for category_id in ids:
        _budgetable(categories.get(category_id))
    budgets = _locked_budgets(
        db, ids, create=[item.category_id for item in plan.amounts if item.amount is not None]
    )
    first_month = load_preferences(db).general.fiscal_year_start_month
    amounts = {item.category_id: item.amount for item in plan.amounts}
    for category_id, budget in budgets.items():
        _set_amount(db, budget, month, first_month, amounts[category_id], plan.scope)
