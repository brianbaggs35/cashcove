"""Budgets: what counts toward each, and how each of its periods is going.

A budget has an amount for each period and things linked to it (see ``BudgetLink``). What came
in and went out is worked out from the transactions every time it's asked for, never stored,
so it's always up to date, whatever synced, was imported, undone, recategorized or sorted by an
automation since. Accounts in other currencies count too, converted into the household's at
each transaction's day's exchange rate.

A transaction counts toward a budget once, whichever of its links catches it, in this order:
the budget's link to the transaction itself, to an automation that sorts it, to its
subscription, to its category and to its account. Taking a transaction off a budget removes its
own link and, if something else still counts it, remembers that it's been taken off.
"""

import datetime as dt
import uuid
from bisect import bisect_right
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, NamedTuple

from fastapi import status
from sqlalchemy import (
    Select,
    Subquery,
    and_,
    delete,
    exists,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.dialects.postgresql import distinct_on, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import ApiError
from app.auth.service import load_preferences
from app.finance.automations import Looks, matching
from app.finance.exchange_rates import ExchangeRateClient, RateBook
from app.finance.periods import (
    default_start,
    next_start,
    period_end,
    period_start,
    previous_start,
    starts_back,
)
from app.finance.subscriptions import due_dates, expected_amount, payment_stats
from app.models import (
    Account,
    Automation,
    AutomationScope,
    Budget,
    BudgetAmount,
    BudgetExclusion,
    BudgetKind,
    BudgetLink,
    BudgetPeriod,
    Category,
    CategoryGroup,
    CategoryKind,
    RecurringKind,
    Subscription,
    Transaction,
)
from app.models.base import CENT, utcnow
from app.schemas.budget import (
    AutomationCount,
    BudgetCreate,
    BudgetHistory,
    BudgetLinkOut,
    BudgetOut,
    BudgetPeriodView,
    BudgetSource,
    BudgetSourceIn,
    BudgetTransaction,
    BudgetTransactionPage,
    BudgetUpdate,
    CategoryTotal,
    DayTotal,
    HistoryPeriod,
    PeriodSummary,
    UpcomingBill,
    Via,
)

ZERO = Decimal("0.00")
# The order a transaction's links are tried in, which is why it counts once.
EXPLICIT, AUTOMATION, SUBSCRIPTION, CATEGORY, ACCOUNT = 1, 2, 3, 4, 5
VIA: dict[int, Via] = {
    EXPLICIT: "transaction",
    AUTOMATION: "automation",
    SUBSCRIPTION: "subscription",
    CATEGORY: "category",
    ACCOUNT: "account",
}
# Budgets are listed by how often they repeat, then the order they were made in.
PERIOD_ORDER = {
    BudgetPeriod.WEEKLY: 0,
    BudgetPeriod.BIWEEKLY: 1,
    BudgetPeriod.MONTHLY: 2,
    BudgetPeriod.YEARLY: 3,
}


def find_budget(db: Session, budget_id: uuid.UUID) -> Budget:
    budget = db.scalar(
        select(Budget).where(Budget.id == budget_id).options(selectinload(Budget.amounts))
    )
    if budget is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "That budget doesn't exist anymore.")
    return budget


@dataclass(frozen=True)
class Household:
    """What budgets need to know about the household: its currency, which day its weeks start
    on and which month its budget year starts in."""

    currency: str
    # Counted as Python does: Monday is 0.
    week_starts_on: int
    first_month: int

    @classmethod
    def load(cls, db: Session) -> "Household":
        general = load_preferences(db).general
        return cls(
            currency=general.currency,
            week_starts_on=6 if general.week_starts_on == "sunday" else 0,
            first_month=general.fiscal_year_start_month,
        )

    def start_for(self, period: BudgetPeriod, today: dt.date) -> dt.date:
        return default_start(
            period, today, week_starts_on=self.week_starts_on, first_month=self.first_month
        )


def amount_at(budget: Budget, start: dt.date) -> Decimal:
    """What the budget has for the period that starts on `start`: the latest amount to start on
    or before it, or the earliest, for periods from before the budget."""
    amount = budget.amounts[0].amount
    for row in budget.amounts:
        if row.starts_on <= start:
            amount = row.amount
    return amount


# ---- What counts ------------------------------------------------------------------------


def _transfers() -> Select[*tuple[Any, ...]]:
    """The categories of money moving between the household's own accounts."""
    return (
        select(Category.id)
        .join(CategoryGroup, CategoryGroup.id == Category.group_id)
        .where(CategoryGroup.kind == CategoryKind.TRANSFER)
    )


def _counted(
    db: Session,
    budget: Budget,
    *,
    first: dt.date | None = None,
    last: dt.date | None = None,
    ids: Sequence[uuid.UUID] | None = None,
    removed: bool = False,
) -> Subquery:
    """The transactions that count toward a budget, each once: its ID, what it counts as
    (`kind`), the link that counts it (`link_id`) and which kind of link that is (`priority`).
    Limited to the days from `first` to `last` and to the transactions `ids`, when given.
    With `removed`, it's the ones someone took off that would otherwise count, instead."""
    limits = [
        *([Transaction.date >= first] if first is not None else []),
        *([Transaction.date <= last] if last is not None else []),
        *([Transaction.id.in_(ids)] if ids is not None else []),
    ]
    mine = BudgetLink.budget_id == budget.id
    kind = BudgetLink.kind
    hits: list[Select[*tuple[Any, ...]]] = [
        select(Transaction.id, kind, BudgetLink.id, literal(EXPLICIT))
        .join(BudgetLink, BudgetLink.transaction_id == Transaction.id)
        .where(mine, *limits)
    ]
    sorting = db.execute(
        select(BudgetLink, Automation)
        .join(Automation, Automation.id == BudgetLink.automation_id)
        .where(mine, Automation.active.is_(True))
    )
    for link, automation in sorting:
        where = [*matching(Looks.of(automation)), *limits]
        if automation.apply_to == AutomationScope.FUTURE:
            # The ones that arrived after it was made, which is what "future only" means.
            where.append(Transaction.created_at >= automation.created_at)
        hits.append(
            select(
                Transaction.id,
                literal(link.kind, kind.type),
                literal(link.id, BudgetLink.id.type),
                literal(AUTOMATION),
            ).where(*where)
        )
    hits.extend(
        [
            select(Transaction.id, kind, BudgetLink.id, literal(SUBSCRIPTION))
            .join(BudgetLink, BudgetLink.subscription_id == Transaction.subscription_id)
            .where(mine, Transaction.amount < 0, *limits),
            select(Transaction.id, kind, BudgetLink.id, literal(CATEGORY))
            .join(BudgetLink, BudgetLink.category_id == Transaction.category_id)
            .where(mine, *limits),
            select(Transaction.id, kind, BudgetLink.id, literal(ACCOUNT))
            .join(BudgetLink, BudgetLink.account_id == Transaction.account_id)
            .where(
                mine,
                or_(
                    and_(kind == BudgetKind.SPENDING, Transaction.amount < 0),
                    and_(kind == BudgetKind.INCOME, Transaction.amount > 0),
                ),
                # Moving money between accounts isn't income or spending.
                or_(
                    Transaction.category_id.is_(None),
                    Transaction.category_id.not_in(_transfers()),
                ),
                *limits,
            ),
        ]
    )
    union = union_all(*hits).subquery("hits")
    taken_off = exists().where(
        BudgetExclusion.budget_id == budget.id,
        BudgetExclusion.transaction_id == union.c[0],
    )
    return (
        select(
            union.c[0].label("transaction_id"),
            union.c[1].label("kind"),
            union.c[2].label("link_id"),
            union.c[3].label("priority"),
        )
        .where(taken_off if removed else ~taken_off)
        .ext(distinct_on(union.c[0]))
        .order_by(union.c[0], union.c[3], union.c[2])
        .subquery("counted")
    )


class _Row(NamedTuple):
    day: dt.date
    currency: str
    kind: BudgetKind
    category_id: uuid.UUID | None
    link_id: uuid.UUID
    priority: int
    amount: Decimal
    transactions: int


@dataclass(frozen=True)
class Flow:
    """What counted on one day: money in for income, money out for spending, in the
    household's currency."""

    day: dt.date
    kind: BudgetKind
    category_id: uuid.UUID | None
    link_id: uuid.UUID
    value: Decimal
    count: int


@dataclass
class Flows:
    """What counted over some days, and which currencies were converted to get it."""

    entries: list[Flow] = field(default_factory=list[Flow])
    converted: list[str] = field(default_factory=list[str])
    unavailable: list[str] = field(default_factory=list[str])

    def total(self, kind: BudgetKind) -> Decimal:
        return sum((flow.value for flow in self.entries if flow.kind == kind), ZERO)


def _flows(
    db: Session,
    household: Household,
    client: ExchangeRateClient | None,
    budget: Budget,
    first: dt.date,
    last: dt.date,
) -> Flows:
    """What counted toward the budget on each day from `first` to `last`. Accounts in other
    currencies are converted a day at a time, at each day's rate; those without rates are left
    out."""
    counted = _counted(db, budget, first=first, last=last)
    rows = [
        _Row(day, currency, BudgetKind(kind), category_id, link_id, priority, amount, transactions)
        for day, currency, kind, category_id, link_id, priority, amount, transactions in db.execute(
            select(
                Transaction.date,
                Account.currency,
                counted.c.kind,
                Transaction.category_id,
                counted.c.link_id,
                counted.c.priority,
                func.sum(Transaction.amount),
                func.count(),
            )
            .join(counted, counted.c.transaction_id == Transaction.id)
            .join(Account, Account.id == Transaction.account_id)
            .group_by(
                Transaction.date,
                Account.currency,
                counted.c.kind,
                Transaction.category_id,
                counted.c.link_id,
                counted.c.priority,
            )
        )
    ]
    rates = RateBook(db, client, household.currency)
    abroad: dict[str, tuple[dt.date, dt.date]] = {}
    for row in rows:
        if row.currency != household.currency:
            early, late = abroad.get(row.currency, (row.day, row.day))
            abroad[row.currency] = (min(early, row.day), max(late, row.day))
    rates.prepare(abroad)
    result = Flows()
    for row in rows:
        value = row.amount if row.kind == BudgetKind.INCOME else -row.amount
        if row.currency != household.currency:
            converted = rates.convert(row.currency, row.day, value)
            if converted is None:
                continue
            value = converted
        result.entries.append(
            Flow(row.day, row.kind, row.category_id, row.link_id, value, row.transactions)
        )
    result.unavailable = sorted(rates.unavailable)
    result.converted = sorted(set(abroad) - rates.unavailable)
    return result


def _summary(
    db: Session,
    household: Household,
    client: ExchangeRateClient | None,
    budget: Budget,
    start: dt.date,
    last: dt.date,
) -> PeriodSummary:
    flows = _flows(db, household, client, budget, start, last)
    return PeriodSummary(
        start=start,
        end=last,
        amount=amount_at(budget, start),
        income=flows.total(BudgetKind.INCOME),
        spent=flows.total(BudgetKind.SPENDING),
    )


# ---- Budgets ------------------------------------------------------------------------------


def _out(
    db: Session,
    client: ExchangeRateClient | None,
    household: Household,
    budget: Budget,
    today: dt.date,
) -> BudgetOut:
    start = period_start(budget.period, budget.starts_on, today)
    current = _summary(
        db, household, client, budget, start, period_end(budget.period, budget.starts_on, start)
    )
    return BudgetOut(
        id=budget.id,
        name=budget.name,
        period=budget.period,
        starts_on=budget.starts_on,
        amount=current.amount,
        current=current,
        created_at=budget.created_at,
        updated_at=budget.updated_at,
    )


def budget_out(
    db: Session, client: ExchangeRateClient | None, budget: Budget, today: dt.date
) -> BudgetOut:
    return _out(db, client, Household.load(db), budget, today)


def list_budgets(db: Session, client: ExchangeRateClient | None, today: dt.date) -> list[BudgetOut]:
    """Every budget, with how the period it's in is going."""
    household = Household.load(db)
    budgets = sorted(
        db.scalars(select(Budget).options(selectinload(Budget.amounts))),
        key=lambda budget: (PERIOD_ORDER[budget.period], budget.created_at, budget.id),
    )
    return [_out(db, client, household, budget, today) for budget in budgets]


def create_budget(db: Session, body: BudgetCreate) -> Budget:
    household = Household.load(db)
    starts_on = body.starts_on or household.start_for(body.period, body.today or utcnow().date())
    budget = Budget(name=body.name, period=body.period, starts_on=starts_on)
    budget.amounts.append(BudgetAmount(starts_on=starts_on, amount=body.amount))
    db.add(budget)
    db.flush()
    return budget


def change_budget(db: Session, budget: Budget, body: BudgetUpdate) -> None:
    """Changes a budget's name, how often it repeats, the day periods start on and its amount.
    A new amount applies from the period the person is in; changing how often it repeats
    starts the amounts over."""
    household = Household.load(db)
    today = body.today or utcnow().date()
    if body.name is not None:
        budget.name = body.name
    amount = (
        body.amount
        if body.amount is not None
        else amount_at(budget, period_start(budget.period, budget.starts_on, today))
    )
    if body.period is not None and body.period != budget.period:
        budget.period = body.period
        budget.starts_on = body.starts_on or household.start_for(body.period, today)
        _start_amounts_over(db, budget, amount)
        return
    if body.starts_on is not None:
        budget.starts_on = body.starts_on
    if body.amount is not None:
        start = period_start(budget.period, budget.starts_on, today)
        row = next((item for item in budget.amounts if item.starts_on == start), None)
        if row is None:
            budget.amounts.append(BudgetAmount(starts_on=start, amount=amount))
        else:
            row.amount = amount


def _start_amounts_over(db: Session, budget: Budget, amount: Decimal) -> None:
    """Gives the budget the one amount, from its first day, whatever it had before."""
    keep, *others = budget.amounts
    for row in others:
        budget.amounts.remove(row)
    db.flush()
    keep.starts_on = budget.starts_on
    keep.amount = amount


def delete_budget(db: Session, budget: Budget) -> None:
    db.delete(budget)


# ---- A period of a budget -------------------------------------------------------------------


def _sources(
    db: Session, budget: Budget, totals: dict[uuid.UUID, tuple[Decimal, int]]
) -> list[BudgetSource]:
    """The budget's sources, income first, with what each counted."""
    return [
        BudgetSource(
            **link.model_dump(),
            amount=totals.get(link.id, (ZERO, 0))[0],
            count=totals.get(link.id, (ZERO, 0))[1],
        )
        for link in budget_links(db, budget)
    ]


def budget_links(db: Session, budget: Budget) -> list[BudgetLinkOut]:
    """What counts toward a budget besides single transactions: its sources, income first."""
    rows = db.execute(
        select(
            BudgetLink,
            Account.name,
            Category.name,
            Subscription.name,
            Subscription.kind,
            Subscription.active,
            Automation.name,
            Automation.active,
        )
        .outerjoin(Account, Account.id == BudgetLink.account_id)
        .outerjoin(Category, Category.id == BudgetLink.category_id)
        .outerjoin(Subscription, Subscription.id == BudgetLink.subscription_id)
        .outerjoin(Automation, Automation.id == BudgetLink.automation_id)
        .where(BudgetLink.budget_id == budget.id, BudgetLink.transaction_id.is_(None))
        .order_by(BudgetLink.created_at, BudgetLink.id)
    )
    links: list[BudgetLinkOut] = []
    for (
        link,
        account,
        category,
        subscription,
        kind,
        subscription_active,
        automation,
        active,
    ) in rows:
        # Each link is to exactly one thing, which the database makes sure of. A bill is linked
        # the way a subscription is, and told apart by its kind.
        target = {
            "account": (link.account_id, account, True),
            "category": (link.category_id, category, True),
            "subscription": (link.subscription_id, subscription, subscription_active),
            "automation": (link.automation_id, automation, active),
        }
        source = next(name for name, (thing, _, _) in target.items() if thing is not None)
        links.append(
            BudgetLinkOut.model_validate(
                {
                    "id": link.id,
                    "kind": link.kind,
                    "type": "bill" if kind == RecurringKind.BILL else source,
                    "target_id": target[source][0],
                    "name": target[source][1],
                    "active": target[source][2],
                }
            )
        )
    return sorted(links, key=lambda item: item.kind != BudgetKind.INCOME)


def _upcoming(
    db: Session,
    household: Household,
    client: ExchangeRateClient | None,
    budget: Budget,
    first: dt.date,
    last: dt.date,
) -> list[UpcomingBill]:
    """The payments of the budget's subscriptions and bills that fall due in the days from
    `first` to `last`, which haven't been paid, since paying one moves its next due date on."""
    subscriptions = list(
        db.scalars(
            select(Subscription)
            .join(BudgetLink, BudgetLink.subscription_id == Subscription.id)
            .where(BudgetLink.budget_id == budget.id, Subscription.active.is_(True))
        )
    )
    stats = payment_stats(db, [item.id for item in subscriptions]) if subscriptions else {}
    currencies: dict[uuid.UUID, str] = dict(
        db.execute(
            select(Account.id, Account.currency).where(
                Account.id.in_([item.account_id for item in subscriptions])
            )
        ).all()
    )
    rates = RateBook(db, client, household.currency)
    rates.prepare(
        {
            currency: (first, last)
            for currency in set(currencies.values())
            if currency != household.currency
        }
    )
    bills: list[UpcomingBill] = []
    for subscription in subscriptions:
        amount = expected_amount(subscription, stats.get(subscription.id))
        currency = currencies.get(subscription.account_id, household.currency)
        if currency != household.currency:
            converted = rates.convert(currency, first, amount)
            if converted is None:
                continue
            amount = converted
        bills.extend(
            UpcomingBill(
                subscription_id=subscription.id,
                name=subscription.name,
                kind=subscription.kind,
                due_on=day,
                amount=amount,
            )
            for day in due_dates(subscription, first, last)
        )
    return sorted(bills, key=lambda bill: (bill.due_on, bill.name.casefold()))


def _days(flows: Flows) -> list[DayTotal]:
    income: defaultdict[dt.date, Decimal] = defaultdict(lambda: ZERO)
    spent: defaultdict[dt.date, Decimal] = defaultdict(lambda: ZERO)
    for flow in flows.entries:
        (income if flow.kind == BudgetKind.INCOME else spent)[flow.day] += flow.value
    return [
        DayTotal(day=day, income=income[day], spent=spent[day]) for day in sorted({*income, *spent})
    ]


def _categories(flows: Flows) -> list[CategoryTotal]:
    amounts: defaultdict[uuid.UUID | None, Decimal] = defaultdict(lambda: ZERO)
    counts: defaultdict[uuid.UUID | None, int] = defaultdict(int)
    for flow in flows.entries:
        if flow.kind == BudgetKind.SPENDING:
            amounts[flow.category_id] += flow.value
            counts[flow.category_id] += flow.count
    return sorted(
        (
            CategoryTotal(category_id=category, amount=amount, count=counts[category])
            for category, amount in amounts.items()
            if amount > 0
        ),
        key=lambda total: -total.amount,
    )


def _per_link(flows: Flows) -> dict[uuid.UUID, tuple[Decimal, int]]:
    totals: dict[uuid.UUID, tuple[Decimal, int]] = {}
    for flow in flows.entries:
        amount, count = totals.get(flow.link_id, (ZERO, 0))
        totals[flow.link_id] = (amount + flow.value, count + flow.count)
    return totals


def _rounded(amount: Decimal) -> Decimal:
    return amount.quantize(CENT, ROUND_HALF_UP)


def _floor(db: Session, budget: Budget) -> dt.date:
    """The start of the earliest period worth looking at: the one with the first transaction
    or the one the budget was made for, whichever is earlier."""
    earliest = db.scalar(select(func.min(Transaction.date)))
    day = budget.starts_on if earliest is None else min(earliest, budget.starts_on)
    return period_start(budget.period, budget.starts_on, day)


def period_view(
    db: Session,
    client: ExchangeRateClient | None,
    budget: Budget,
    on: dt.date,
    today: dt.date,
) -> BudgetPeriodView:
    """How a budget is going in the period that `on` is in, or how it went."""
    household = Household.load(db)
    period, anchor = budget.period, budget.starts_on
    start = period_start(period, anchor, on)
    end = period_end(period, anchor, start)
    flows = _flows(db, household, client, budget, start, end)
    income, spent = flows.total(BudgetKind.INCOME), flows.total(BudgetKind.SPENDING)
    amount = amount_at(budget, start)
    now = period_start(period, anchor, today)
    current = start == now
    length = (end - start).days + 1
    # None before the period starts, all of it once it's over.
    gone = max(0, min((today - start).days + 1, length))
    pace = current and gone > 0
    removed = db.scalar(
        select(func.count()).select_from(_counted(db, budget, first=start, last=end, removed=True))
    )
    return BudgetPeriodView(
        budget=_out(db, client, household, budget, today),
        start=start,
        end=end,
        previous=previous_start(period, anchor, start) if start > _floor(db, budget) else None,
        next=next_start(period, anchor, start) if start < now else None,
        current=current,
        days=length,
        days_gone=gone,
        amount=amount,
        income=income,
        spent=spent,
        left=amount - spent,
        saved=income - spent,
        expected=_rounded(amount * gone / length) if pace else None,
        projected=_rounded(max(spent, ZERO) * length / gone) if pace else None,
        transactions=sum(flow.count for flow in flows.entries),
        removed=removed or 0,
        daily=_days(flows),
        categories=_categories(flows),
        sources=_sources(db, budget, _per_link(flows)),
        upcoming=_upcoming(db, household, client, budget, today, end) if current else [],
        converted=flows.converted,
        unavailable=flows.unavailable,
    )


def history(
    db: Session,
    client: ExchangeRateClient | None,
    budget: Budget,
    on: dt.date,
    today: dt.date,
    count: int,
) -> BudgetHistory:
    """What the budget came to in each of its `count` latest periods up to the one `on` is in."""
    household = Household.load(db)
    period, anchor = budget.period, budget.starts_on
    starts = starts_back(period, anchor, period_start(period, anchor, on), count)
    last = period_end(period, anchor, starts[-1])
    flows = _flows(db, household, client, budget, starts[0], last)
    totals = {start: [ZERO, ZERO] for start in starts}
    for flow in flows.entries:
        # Each day is in the latest period that started on or before it.
        start = starts[bisect_right(starts, flow.day) - 1]
        totals[start][0 if flow.kind == BudgetKind.INCOME else 1] += flow.value
    now = period_start(period, anchor, today)
    return BudgetHistory(
        periods=[
            HistoryPeriod(
                start=start,
                end=period_end(period, anchor, start),
                amount=amount_at(budget, start),
                income=totals[start][0],
                spent=totals[start][1],
                current=start == now,
            )
            for start in starts
        ],
        converted=flows.converted,
        unavailable=flows.unavailable,
    )


def transactions_page(
    db: Session,
    budget: Budget,
    on: dt.date,
    *,
    kind: BudgetKind | None,
    removed: bool,
    page: int,
    page_size: int,
) -> BudgetTransactionPage:
    """The transactions that count toward the budget in the period `on` is in, newest first,
    or the ones taken off that would count."""
    start = period_start(budget.period, budget.starts_on, on)
    counted = _counted(
        db,
        budget,
        first=start,
        last=period_end(budget.period, budget.starts_on, start),
        removed=removed,
    )
    where = [counted.c.kind == kind] if kind is not None else []
    total = db.scalar(select(func.count()).select_from(counted).where(*where)) or 0
    rows = db.execute(
        select(Transaction, counted.c.kind, counted.c.link_id, counted.c.priority)
        .join(counted, counted.c.transaction_id == Transaction.id)
        .where(*where)
        .order_by(Transaction.date.desc(), Transaction.created_at.desc(), Transaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return BudgetTransactionPage(
        items=[
            BudgetTransaction(
                id=transaction.id,
                date=transaction.date,
                payee=transaction.payee,
                amount=transaction.amount,
                account_id=transaction.account_id,
                category_id=transaction.category_id,
                kind=BudgetKind(counted_as),
                via=VIA[priority],
                source_id=None if priority == EXPLICIT else link_id,
            )
            for transaction, counted_as, link_id, priority in rows
        ],
        total=total,
    )


# ---- Linking ------------------------------------------------------------------------------


def _existing(db: Session, ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    return set(db.scalars(select(Transaction.id).where(Transaction.id.in_(ids))))


def link_transactions(
    db: Session, budget: Budget, ids: Sequence[uuid.UUID], kind: BudgetKind
) -> int:
    """Counts transactions toward a budget as income or as spending, and puts back ones that
    were taken off. Ones it counts that way already don't need a link of their own."""
    wanted = set(ids)
    if _existing(db, ids) != wanted:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "unknown_transaction", "Some of those transactions are gone."
        )
    db.execute(
        delete(BudgetExclusion).where(
            BudgetExclusion.budget_id == budget.id, BudgetExclusion.transaction_id.in_(wanted)
        )
    )
    counted = _counted(db, budget, ids=list(wanted))
    counting = {
        transaction_id: BudgetKind(counted_as)
        for transaction_id, counted_as in db.execute(
            select(counted.c.transaction_id, counted.c.kind)
        )
    }
    linked = {
        link.transaction_id: link
        for link in db.scalars(
            select(BudgetLink).where(
                BudgetLink.budget_id == budget.id, BudgetLink.transaction_id.in_(wanted)
            )
        )
    }
    for transaction_id in wanted:
        link = linked.get(transaction_id)
        if link is not None:
            link.kind = kind
        elif counting.get(transaction_id) != kind:
            db.add(BudgetLink(budget_id=budget.id, kind=kind, transaction_id=transaction_id))
    db.flush()
    return len(wanted)


def unlink_transaction(db: Session, budget: Budget, transaction_id: uuid.UUID) -> None:
    """Takes a transaction off a budget: its own link goes, and if the budget still counts it,
    because of an account, a category, a subscription or an automation, that's remembered."""
    if transaction_id not in _existing(db, [transaction_id]):
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "unknown_transaction", "That transaction is gone."
        )
    db.execute(
        delete(BudgetLink).where(
            BudgetLink.budget_id == budget.id, BudgetLink.transaction_id == transaction_id
        )
    )
    counted = _counted(db, budget, ids=[transaction_id])
    if db.scalar(select(func.count()).select_from(counted)):
        db.execute(
            insert(BudgetExclusion)
            .values(budget_id=budget.id, transaction_id=transaction_id)
            .on_conflict_do_nothing()
        )


def _exists(
    db: Session,
    model: type[Account | Category | Subscription | Automation],
    item_id: uuid.UUID | None,
    code: str,
    what: str,
) -> None:
    if item_id is not None and db.get(model, item_id) is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            code,
            f"That {what} doesn't exist anymore. Choose another one.",
        )


def add_source(db: Session, budget: Budget, body: BudgetSourceIn) -> BudgetLinkOut:
    """Counts an account, a category, a subscription or bill, or an automation toward a budget."""
    _exists(db, Account, body.account_id, "unknown_account", "account")
    _exists(db, Category, body.category_id, "unknown_category", "category")
    _exists(db, Subscription, body.subscription_id, "unknown_subscription", "subscription or bill")
    _exists(db, Automation, body.automation_id, "unknown_automation", "automation")
    link = BudgetLink(
        budget_id=budget.id,
        kind=body.kind,
        account_id=body.account_id,
        category_id=body.category_id,
        subscription_id=body.subscription_id,
        automation_id=body.automation_id,
    )
    db.add(link)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "already_counted",
            "That already counts toward this budget.",
        ) from error
    return next(item for item in budget_links(db, budget) if item.id == link.id)


def remove_source(db: Session, budget: Budget, link_id: uuid.UUID) -> None:
    link = db.scalar(
        select(BudgetLink).where(
            BudgetLink.id == link_id,
            BudgetLink.budget_id == budget.id,
            BudgetLink.transaction_id.is_(None),
        )
    )
    if link is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That doesn't count toward this budget."
        )
    db.delete(link)


# ---- Automations ------------------------------------------------------------------------


def automation_counts(
    db: Session, automation_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID | None, list[AutomationCount]]:
    """The budgets each automation counts what it sorts toward."""
    counts: defaultdict[uuid.UUID | None, list[AutomationCount]] = defaultdict(list)
    for automation_id, budget_id, kind in db.execute(
        select(BudgetLink.automation_id, BudgetLink.budget_id, BudgetLink.kind)
        .where(BudgetLink.automation_id.in_(automation_ids))
        .order_by(BudgetLink.created_at, BudgetLink.id)
    ):
        counts[automation_id].append(AutomationCount(budget_id=budget_id, kind=kind))
    return dict(counts)


def set_automation_counts(
    db: Session, automation: Automation, counts: Sequence[AutomationCount]
) -> None:
    """Has an automation count what it sorts toward exactly these budgets."""
    wanted = {item.budget_id: item.kind for item in counts}
    if len(wanted) != len(counts):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "duplicate_budget",
            "Count toward each budget once.",
        )
    if wanted and set(db.scalars(select(Budget.id).where(Budget.id.in_(wanted)))) != set(wanted):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_budget",
            "One of those budgets doesn't exist anymore. Choose another one.",
        )
    existing = {
        link.budget_id: link
        for link in db.scalars(select(BudgetLink).where(BudgetLink.automation_id == automation.id))
    }
    for budget_id, link in existing.items():
        if budget_id not in wanted:
            db.delete(link)
        else:
            link.kind = wanted[budget_id]
    for budget_id, kind in wanted.items():
        if budget_id not in existing:
            db.add(BudgetLink(budget_id=budget_id, kind=kind, automation_id=automation.id))
    db.flush()
