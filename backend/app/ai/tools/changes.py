"""The changes an AI can propose, and how each is checked, worded and made.

Each change has four parts, kept apart so that nothing the AI wrote reaches the household's
records except through the checks:

1. **What the AI writes** (``*Args``): names, codes and plain values, read leniently.
2. **A step** (``*Step``): the same change with the codes and names turned into the rows they stand
   for, strictly typed. This is what is kept in a proposal.
3. **Words for people** (``describe``): written by Cashcove from the step, never taken from the
   AI, so a proposal says what it will really do.
4. **Making it** (``run``): from the step alone, through the code the API itself uses.

Where several things in the household are alike, the way to group them is an automation: it finds
every transaction whose payee has some text, those already there and those that come later, and
gives them a category or links them to a subscription or a bill.
"""

import datetime as dt
import re
import uuid
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.tools.base import (
    Change,
    Context,
    Described,
    Money,
    Row,
    ToolError,
    change,
    echo,
    explain,
)
from app.auth.deps import ApiError
from app.finance.automations import (
    Looks,
    apply_to_existing,
    match_count,
    new_automation,
    overlaps,
)
from app.finance.budget import Household, amount_at, create_budget, find_budget
from app.finance.budget import add_source as add_budget_source
from app.finance.budget import change_budget as update_budget
from app.finance.categories import new_category, new_group
from app.finance.periods import period_start
from app.finance.subscriptions import (
    change_recurring,
    create_recurring,
    ensure_untracked,
    payee_is,
)
from app.finance.text import text_key
from app.finance.transactions import SORT_ORDERS, categorize
from app.models import (
    Account,
    AutomationDirection,
    AutomationMatch,
    AutomationScope,
    BudgetKind,
    BudgetPeriod,
    Category,
    CategoryGroup,
    CategoryKind,
    PaymentFrequency,
    RecurringKind,
    Subscription,
    Transaction,
)
from app.models.base import CENT
from app.schemas.automations import AutomationCreate
from app.schemas.budget import BudgetCreate, BudgetSourceIn, BudgetUpdate
from app.schemas.fields import MAX_AMOUNT, STRICT
from app.schemas.subscriptions import SubscriptionCreate, SubscriptionUpdate

AMOUNT_LABEL = "The amount"

# The most transactions one change takes, and how many are listed for people to check.
MAX_ROWS = 200
LISTED = 8
# How far from today a subscription's next payment can be: some overdue, none past a decade.
OVERDUE = dt.timedelta(days=366)
AHEAD = dt.timedelta(days=3660)
DEFAULT_EMOJI = "🏷️"
_EMOJI = re.compile(r"^\S{1,16}$")
MIN_TEXT = 3
Match = Literal["contains", "starts_with", "exact"]
Frequency = Literal["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"]
# How each way of matching is put in words.
MATCHES = {
    AutomationMatch.CONTAINS: "has",
    AutomationMatch.STARTS_WITH: "starts with",
    AutomationMatch.EXACT: "is exactly",
}


class _Args(BaseModel):
    """What the AI writes is read leniently: anything it adds that isn't asked for is ignored."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class _Step(BaseModel):
    """What is kept is strict: nothing else, and nothing of another type."""

    model_config = STRICT


def _money(amount: Decimal, currency: str) -> str:
    return f"{amount:,.2f} {currency}"


def _count(number: int, noun: str) -> str:
    return f"{number} {noun}{'' if number == 1 else 's'}"


def _amount(value: Decimal, what: str) -> Decimal:
    """An amount of money the AI gave: more than nothing, in cents."""
    try:
        amount = value.quantize(CENT, ROUND_HALF_UP)
    except InvalidOperation:
        amount = Decimal(0)
    if not 0 < amount <= MAX_AMOUNT:
        raise ToolError(f"{what} has to be more than 0 and a sensible amount of money.")
    return amount


def _category_id(db: Session, name: str) -> uuid.UUID:
    """The category with this name, at the moment a change is made: it may have been added by an
    earlier change in the same proposal, or removed since it was proposed."""
    found = db.scalar(select(Category.id).where(func.lower(Category.name) == text_key(name)))
    if found is None:
        raise ToolError(f"The category {name} doesn't exist.")
    return found


def _currency(db: Session) -> str:
    return Household.load(db).currency


def _listed(rows: list[str], total: int) -> list[str]:
    """The first few lines, and how many more there are."""
    if total > len(rows):
        return [*rows, f"and {total - len(rows)} more"]
    return rows


# ---- Giving transactions a category ----------------------------------------------------------


class CategorizeArgs(_Args):
    transactions: list[str] = Field(min_length=1, max_length=MAX_ROWS)
    category: str


class CategorizeStep(_Step):
    transaction_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_ROWS)
    category: str | None


def _resolve_categorize(ctx: Context, args: CategorizeArgs) -> CategorizeStep:
    ids = dict.fromkeys(ctx.codes.resolve(Row.TRANSACTION, code) for code in args.transactions)
    return CategorizeStep(transaction_ids=list(ids), category=ctx.optional_category(args.category))


def _describe_categorize(db: Session, step: CategorizeStep) -> Described:
    rows = db.execute(
        select(Transaction.date, Transaction.payee, Transaction.amount, Account.currency)
        .join(Account, Account.id == Transaction.account_id)
        .where(Transaction.id.in_(step.transaction_ids))
        .order_by(*SORT_ORDERS["-date"])
    ).all()
    many = _count(len(rows), "transaction")
    if step.category:
        title, summary = f"Put {many} in {step.category}", f"{many} will be put in {step.category}."
    else:
        title, summary = f"Take the category off {many}", f"{many} will have no category."
    lines = [
        f"{row.date} · {row.payee} · {row.amount:+,.2f} {row.currency}" for row in rows[:LISTED]
    ]
    note = "Automations leave a category you choose as it is from then on."
    return Described(title, summary, [*_listed(lines, len(rows)), note])


def _run_categorize(db: Session, step: CategorizeStep) -> str:
    category_id = _category_id(db, step.category) if step.category else None
    done = _count(categorize(db, step.transaction_ids, category_id), "transaction")
    return f"Put {done} in {step.category}." if step.category else f"Took the category off {done}."


# ---- Adding a category -----------------------------------------------------------------------


class CategoryArgs(_Args):
    name: str
    group: str
    emoji: str | None = None
    group_kind: Literal["expense", "income", "transfer"] | None = None


class CategoryStep(_Step):
    name: str
    group: str
    new_group_kind: CategoryKind | None
    emoji: str


def _group_names(db: Session) -> dict[str, str]:
    return {text_key(name): name for name in db.scalars(select(CategoryGroup.name))}


def _resolve_category(ctx: Context, args: CategoryArgs) -> CategoryStep:
    name = ctx.written(args.name, "The category's name", longest=60)
    taken = ctx.categories.get(text_key(name)) or ctx.new_categories.get(text_key(name))
    if taken:
        raise ToolError(f"There is already a category called {taken}.")
    groups = _group_names(ctx.db)
    group = ctx.written(args.group, "The group's name", longest=60)
    existing = groups.get(text_key(group))
    if existing is None and args.group_kind is None:
        raise ToolError(
            f"There is no group called {group}. Choose one of: {', '.join(groups.values())}; "
            "or give group_kind (expense, income or transfer) to make a new group."
        )
    emoji = (args.emoji or "").strip()
    emoji = emoji if _EMOJI.fullmatch(emoji) else DEFAULT_EMOJI
    ctx.new_categories[text_key(name)] = name
    return CategoryStep(
        name=name,
        group=existing or group,
        new_group_kind=None if existing else CategoryKind(args.group_kind or "expense"),
        emoji=emoji,
    )


def _describe_category(db: Session, step: CategoryStep) -> Described:
    if step.new_group_kind is None:
        where = f"the group {step.group}"
    else:
        where = f"a new {step.new_group_kind} group called {step.group}"
    title = f"Add the category {step.name}"
    return Described(title, f"{step.emoji} {step.name} will be added to {where}.", [])


def _run_category(db: Session, step: CategoryStep) -> str:
    group = db.scalar(
        select(CategoryGroup).where(func.lower(CategoryGroup.name) == text_key(step.group))
    )
    if group is None:
        if step.new_group_kind is None:
            raise ToolError(f"The group {step.group} doesn't exist.")
        group = new_group(db, step.group, step.new_group_kind)
    new_category(db, group, step.name, step.emoji)
    return f"Added the category {step.name} to {step.group}."


# ---- Grouping identical transactions with an automation --------------------------------------


class AutomationArgs(_Args):
    text: str
    match: Match = "contains"
    direction: Literal["out", "in", "any"] = "any"
    category: str | None = None
    link_to: str | None = None
    name: str | None = None
    apply_to: Literal["all", "future"] = "all"


class AutomationStep(_Step):
    name: str
    text: str
    match: AutomationMatch
    direction: AutomationDirection
    category: str | None
    subscription_id: uuid.UUID | None
    apply_to: AutomationScope


def _resolve_automation(ctx: Context, args: AutomationArgs) -> AutomationStep:
    text = ctx.searched(args.text, "The text to look for", longest=60, shortest=MIN_TEXT)
    category = ctx.optional_category(args.category)
    linked = ctx.codes.resolve(Row.RECURRING, args.link_to) if args.link_to else None
    if category is None and linked is None:
        raise ToolError(
            "Say which category it should give, or which subscription or bill (link_to) it should "
            "link payments to."
        )
    direction = AutomationDirection(args.direction)
    if linked is not None and direction == AutomationDirection.IN:
        raise ToolError("A subscription or bill is linked to payments, which is money going out.")
    name = args.name or text.title()
    return AutomationStep(
        name=ctx.written(name, "The automation's name", longest=120),
        text=text,
        match=AutomationMatch(args.match),
        direction=direction,
        category=category,
        subscription_id=linked,
        apply_to=AutomationScope(args.apply_to),
    )


def _looks(step: AutomationStep) -> Looks:
    return Looks([step.text], step.match, None, None, None, step.direction)


def _describe_automation(db: Session, step: AutomationStep) -> Described:
    linked = db.scalar(select(Subscription.name).where(Subscription.id == step.subscription_id))
    does = [f"the category {step.category}"] if step.category else []
    if linked:
        does.append(f"a link to {linked}")
    when = (
        "the ones already there and every one that comes later"
        if step.apply_to == AutomationScope.ALL
        else "the ones that come from now on"
    )
    summary = (
        f"Every transaction whose payee {MATCHES[step.match]} “{step.text}” gets "
        f"{' and '.join(does)}: {when}."
    )
    matching = match_count(db, _looks(step))
    details = [f"{_count(matching, 'transaction')} match now."]
    for other in overlaps(
        db, _looks(step), category=step.category is not None, subscription=linked is not None
    ):
        details.append(
            f"{other.automation.name} already sorts {other.count} of these, and goes first."
        )
    return Described(f"Sort payments that match “{step.text}”", summary, details)


def _add_automation(db: Session, step: AutomationStep) -> int:
    """Adds the automation, which sorts what is already there when it covers the past. Returns
    how many transactions that changed."""
    category_id = _category_id(db, step.category) if step.category else None
    automation = new_automation(
        db,
        AutomationCreate(
            name=step.name,
            payees=[step.text],
            match=step.match,
            direction=step.direction,
            category_id=category_id,
            subscription_id=step.subscription_id,
            apply_to=step.apply_to,
        ),
    )
    return apply_to_existing(db, automation) if step.apply_to == AutomationScope.ALL else 0


def _run_automation(db: Session, step: AutomationStep) -> str:
    sorted_now = _add_automation(db, step)
    return f"Added the automation {step.name}, which sorted {_count(sorted_now, 'transaction')}."


# ---- Adding a subscription or a bill ---------------------------------------------------------


class RecurringArgs(_Args):
    kind: Literal["subscription", "bill"] = "subscription"
    name: str
    amount: Money
    frequency: Frequency
    next_due: dt.date
    amount_varies: bool = False
    category: str | None = None
    payee: str | None = None
    from_transaction: str | None = None
    account: str | None = None
    link_all: bool = True
    match_text: str | None = None
    match: Match = "contains"
    notes: str | None = None


class RecurringStep(_Step):
    kind: RecurringKind
    name: str
    amount: Decimal
    amount_varies: bool
    frequency: PaymentFrequency
    next_due: dt.date
    account_id: uuid.UUID
    payee: str
    category: str | None
    notes: str | None
    link_text: str | None
    link_match: AutomationMatch


def _account_and_payee(ctx: Context, args: RecurringArgs) -> tuple[uuid.UUID, str]:
    """Which account its payments come from and what they are called: a payment's own, or the
    account the AI named by its code and the payee it wrote. Which account is never the AI's to
    know, only to pass on."""
    if args.from_transaction:
        payment = ctx.db.get(Transaction, ctx.codes.resolve(Row.TRANSACTION, args.from_transaction))
        if payment is None or payment.amount >= 0:
            raise ToolError("from_transaction has to be a payment, which is money going out.")
        return payment.account_id, payment.payee
    payee = ctx.searched(args.payee or args.name, "The payee", longest=160)
    if args.account:
        who = ctx.vault.entity_of(args.account)
        if who is None or who.account_id is None:
            raise ToolError(f"{echo(args.account)} isn't one of the account codes listed.")
        return who.account_id, payee
    open_accounts = list(ctx.db.scalars(select(Account.id).where(Account.closed_at.is_(None))))
    if len(open_accounts) == 1:
        return open_accounts[0], payee
    raise ToolError(
        "Which account is it paid from? Ask the person, choosing from the accounts listed, and "
        "give its code as account; or give from_transaction."
    )


def _resolve_recurring(ctx: Context, args: RecurringArgs) -> RecurringStep:
    name = ctx.written(args.name, "The name", longest=120)
    when = args.next_due
    if not ctx.today - OVERDUE <= when <= ctx.today + AHEAD:
        raise ToolError(f"The next payment date {when} is too far from today.")
    account_id, payee = _account_and_payee(ctx, args)
    try:
        ensure_untracked(ctx.db, account_id, payee)
    except ApiError as error:
        raise ToolError(explain(error)) from error
    link_text = None
    if args.link_all:
        link_text = ctx.searched(
            args.match_text or name,
            "The text to find its payments by",
            longest=60,
            shortest=MIN_TEXT,
        )
    notes = ctx.written(args.notes, "The notes", longest=1000) if args.notes else None
    return RecurringStep(
        kind=RecurringKind(args.kind),
        name=name,
        amount=_amount(args.amount, AMOUNT_LABEL),
        amount_varies=args.amount_varies,
        frequency=PaymentFrequency(args.frequency),
        next_due=when,
        account_id=account_id,
        payee=payee,
        category=ctx.optional_category(args.category),
        notes=notes,
        link_text=link_text,
        link_match=AutomationMatch(args.match),
    )


def _describe_recurring(db: Session, step: RecurringStep) -> Described:
    account = db.scalar(select(Account.name).where(Account.id == step.account_id))
    already = (
        db.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(
                Transaction.account_id == step.account_id,
                Transaction.amount < 0,
                payee_is(step.payee),
            )
        )
        or 0
    )
    cost = _money(step.amount, _currency(db))
    details = [
        f"Category: {step.category or 'none'}.",
        f"Paid from {account}.",
        f"Tracks payments to “{step.payee}” from that account: {already} already there.",
    ]
    if step.link_text:
        looks = Looks([step.link_text], step.link_match, None, None, None, AutomationDirection.OUT)
        details.append(
            f"Also an automation that finds every payment whose payee {MATCHES[step.link_match]} "
            f"“{step.link_text}”, in any account, and links it here: "
            f"{_count(match_count(db, looks), 'payment')} now, and every one that comes later."
        )
    title = f"Add the {step.kind} {step.name}"
    summary = f"{step.name}: {'about ' if step.amount_varies else ''}{cost} {step.frequency}, "
    return Described(title, f"{summary}next due {step.next_due}.", details)


def _run_recurring(db: Session, step: RecurringStep) -> str:
    category_id = _category_id(db, step.category) if step.category else None
    subscription = create_recurring(
        db,
        step.kind,
        SubscriptionCreate(
            name=step.name,
            amount=step.amount,
            amount_varies=step.amount_varies,
            frequency=step.frequency,
            account_id=step.account_id,
            next_due_date=step.next_due,
            category_id=category_id,
            notes=step.notes,
            payee=step.payee,
        ),
    )
    said = f"Added the {step.kind} {step.name}."
    if step.link_text is None:
        return said
    _add_automation(
        db,
        AutomationStep(
            name=f"{step.name} payments"[:120],
            text=step.link_text,
            match=step.link_match,
            direction=AutomationDirection.OUT,
            category=step.category,
            subscription_id=subscription.id,
            apply_to=AutomationScope.ALL,
        ),
    )
    # Some were linked by the subscription's own payee, and the rest by the automation.
    linked = db.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.subscription_id == subscription.id)
    )
    return f"{said} {_count(linked or 0, 'payment')} linked to it, and the ones to come will be."


# ---- Changing a subscription or a bill -------------------------------------------------------


class UpdateRecurringArgs(_Args):
    item: str
    name: str | None = None
    amount: Money | None = None
    frequency: Frequency | None = None
    next_due: dt.date | None = None
    category: str | None = None
    active: bool | None = None


class UpdateRecurringStep(_Step):
    subscription_id: uuid.UUID
    name: str | None
    amount: Decimal | None
    frequency: PaymentFrequency | None
    next_due: dt.date | None
    # Whether the category is being changed, since changing it to none is a change too.
    set_category: bool
    category: str | None
    active: bool | None


def _resolve_update_recurring(ctx: Context, args: UpdateRecurringArgs) -> UpdateRecurringStep:
    subscription_id = ctx.codes.resolve(Row.RECURRING, args.item)
    if args.next_due and not ctx.today - OVERDUE <= args.next_due <= ctx.today + AHEAD:
        raise ToolError(f"The next payment date {args.next_due} is too far from today.")
    step = UpdateRecurringStep(
        subscription_id=subscription_id,
        name=ctx.written(args.name, "The name", longest=120) if args.name else None,
        amount=_amount(args.amount, AMOUNT_LABEL) if args.amount is not None else None,
        frequency=PaymentFrequency(args.frequency) if args.frequency else None,
        next_due=args.next_due,
        set_category="category" in args.model_fields_set,
        category=ctx.optional_category(args.category),
        active=args.active,
    )
    changes = step.model_dump(exclude={"subscription_id", "set_category"}, exclude_none=True)
    if not changes and not step.set_category:
        raise ToolError(
            "Say what to change: name, amount, frequency, next_due, category or active."
        )
    return step


def _recurring(db: Session, subscription_id: uuid.UUID) -> Subscription:
    found = db.get(Subscription, subscription_id)
    if found is None:
        raise ToolError("That subscription or bill doesn't exist (any more).")
    return found


def _describe_update_recurring(db: Session, step: UpdateRecurringStep) -> Described:
    item = _recurring(db, step.subscription_id)
    currency = _currency(db)
    lines: list[str] = []
    if step.name:
        lines.append(f"Name: {item.name} → {step.name}.")
    if step.amount is not None:
        lines.append(f"Amount: {_money(item.amount, currency)} → {_money(step.amount, currency)}.")
    if step.frequency:
        lines.append(f"How often: {item.frequency} → {step.frequency}.")
    if step.next_due:
        lines.append(f"Next due: {item.next_due_date} → {step.next_due}.")
    if step.set_category:
        lines.append(f"Category: {step.category or 'none'}; its linked payments get it too.")
    if step.active is not None:
        lines.append("Payments will be tracked again." if step.active else "Tracking is paused.")
    return Described(f"Change the {item.kind} {item.name}", "These will change:", lines)


def _run_update_recurring(db: Session, step: UpdateRecurringStep) -> str:
    item = _recurring(db, step.subscription_id)
    was = f"{item.kind} {item.name}"
    fields = step.model_dump(
        exclude={"subscription_id", "set_category", "category", "next_due"}, exclude_none=True
    )
    if step.next_due:
        fields["next_due_date"] = step.next_due
    if step.set_category:
        fields["category_id"] = _category_id(db, step.category) if step.category else None
    change_recurring(db, item.kind, item.id, SubscriptionUpdate(**fields))
    return f"Changed the {was}."


# ---- Budgets ---------------------------------------------------------------------------------


class NewBudgetArgs(_Args):
    name: str
    period: Literal["weekly", "biweekly", "monthly", "yearly"]
    amount: Money


class NewBudgetStep(_Step):
    name: str
    period: BudgetPeriod
    amount: Decimal
    today: dt.date


def _resolve_new_budget(ctx: Context, args: NewBudgetArgs) -> NewBudgetStep:
    return NewBudgetStep(
        name=ctx.written(args.name, "The budget's name", longest=120),
        period=BudgetPeriod(args.period),
        amount=_amount(args.amount, AMOUNT_LABEL),
        today=ctx.today,
    )


def _describe_new_budget(db: Session, step: NewBudgetStep) -> Described:
    cost = _money(step.amount, _currency(db))
    return Described(
        f"Add the budget {step.name}",
        f"{cost} {step.period}.",
        ["It counts nothing yet: add what counts toward it afterwards."],
    )


def _run_new_budget(db: Session, step: NewBudgetStep) -> str:
    create_budget(
        db,
        BudgetCreate(name=step.name, period=step.period, amount=step.amount, today=step.today),
    )
    return f"Added the budget {step.name}."


class ChangeBudgetArgs(_Args):
    budget: str
    amount: Money | None = None
    name: str | None = None
    period: Literal["weekly", "biweekly", "monthly", "yearly"] | None = None


class ChangeBudgetStep(_Step):
    budget_id: uuid.UUID
    amount: Decimal | None
    name: str | None
    period: BudgetPeriod | None
    today: dt.date


def _resolve_change_budget(ctx: Context, args: ChangeBudgetArgs) -> ChangeBudgetStep:
    budget_id = ctx.codes.resolve(Row.BUDGET, args.budget)
    if args.amount is None and not args.name and not args.period:
        raise ToolError("Say what to change: amount, name or period.")
    return ChangeBudgetStep(
        budget_id=budget_id,
        amount=_amount(args.amount, AMOUNT_LABEL) if args.amount is not None else None,
        name=ctx.written(args.name, "The budget's name", longest=120) if args.name else None,
        period=BudgetPeriod(args.period) if args.period else None,
        today=ctx.today,
    )


def _describe_change_budget(db: Session, step: ChangeBudgetStep) -> Described:
    budget = find_budget(db, step.budget_id)
    currency = _currency(db)
    now = amount_at(budget, period_start(budget.period, budget.starts_on, step.today))
    lines: list[str] = []
    if step.amount is not None:
        lines.append(
            f"Amount: {_money(now, currency)} → {_money(step.amount, currency)}, from the period "
            "you are in now. Periods that are over keep what they had."
        )
    if step.name:
        lines.append(f"Name: {budget.name} → {step.name}.")
    if step.period and step.period != budget.period:
        lines.append(f"How often: {budget.period} → {step.period}. Its amounts start over.")
    return Described(f"Change the budget {budget.name}", "These will change:", lines)


def _run_change_budget(db: Session, step: ChangeBudgetStep) -> str:
    budget = find_budget(db, step.budget_id)
    was = budget.name
    update_budget(
        db,
        budget,
        BudgetUpdate(name=step.name, period=step.period, amount=step.amount, today=step.today),
    )
    return f"Changed the budget {was}."


class BudgetSourceArgs(_Args):
    budget: str
    category: str | None = None
    recurring: str | None = None
    kind: Literal["spending", "income"] = "spending"


class BudgetSourceStep(_Step):
    budget_id: uuid.UUID
    category: str | None
    subscription_id: uuid.UUID | None
    kind: BudgetKind


def _resolve_budget_source(ctx: Context, args: BudgetSourceArgs) -> BudgetSourceStep:
    budget_id = ctx.codes.resolve(Row.BUDGET, args.budget)
    if (args.category is None) == (args.recurring is None):
        raise ToolError("Give either a category or a recurring (a subscription or bill), not both.")
    kind = BudgetKind(args.kind)
    if args.recurring and kind != BudgetKind.SPENDING:
        raise ToolError("The payments of a subscription or bill count as spending.")
    return BudgetSourceStep(
        budget_id=budget_id,
        category=ctx.category(args.category) if args.category else None,
        subscription_id=ctx.codes.resolve(Row.RECURRING, args.recurring)
        if args.recurring
        else None,
        kind=kind,
    )


def _describe_budget_source(db: Session, step: BudgetSourceStep) -> Described:
    budget = find_budget(db, step.budget_id)
    item = db.scalar(select(Subscription.name).where(Subscription.id == step.subscription_id))
    what = f"the category {step.category}" if step.category else f"the payments of {item}"
    return Described(
        f"Count {what} toward {budget.name}",
        f"{what[0].upper()}{what[1:]} will count toward the budget {budget.name} as {step.kind}.",
        [],
    )


def _run_budget_source(db: Session, step: BudgetSourceStep) -> str:
    budget = find_budget(db, step.budget_id)
    add_budget_source(
        db,
        budget,
        BudgetSourceIn(
            kind=step.kind,
            category_id=_category_id(db, step.category) if step.category else None,
            subscription_id=step.subscription_id,
        ),
    )
    return f"Counted it toward the budget {budget.name}."


CHANGES: tuple[Change, ...] = (
    change(
        "categorize_transactions",
        "categorize_transactions {transactions: [codes], category}",
        'Gives transactions a category from the list, or "none" to take it off. To sort every '
        "payment with the same payee, now and later, use create_automation instead.",
        args=CategorizeArgs,
        step=CategorizeStep,
        resolve=_resolve_categorize,
        describe=_describe_categorize,
        run=_run_categorize,
    ),
    change(
        "create_automation",
        "create_automation {text, match?, direction?, category?, link_to?, name?, apply_to?}",
        "Groups identical transactions: a rule for every transaction whose payee has the text "
        "(match: contains, starts_with or exact), the ones already there and those that come "
        "later (apply_to: all, or future for only new ones). It gives them a category and/or "
        "links their payments to a subscription or bill (link_to: its code).",
        args=AutomationArgs,
        step=AutomationStep,
        resolve=_resolve_automation,
        describe=_describe_automation,
        run=_run_automation,
    ),
    change(
        "create_recurring",
        "create_recurring {kind?, name, amount, frequency, next_due, category?, account?, "
        "from_transaction?, payee?, link_all?, match_text?, match?, amount_varies?, notes?}",
        "Adds a subscription or a bill (kind). frequency is weekly, biweekly, monthly, quarterly, "
        "semiannual or annual. Say which account its payments come from with account (a code "
        "from the Accounts list) or take the account and payee from a payment with "
        "from_transaction. With link_all (the default) it also adds an automation that finds "
        "every payment whose payee has match_text (default: the name), past and future, and "
        "links it. Ask the person for what you don't know.",
        args=RecurringArgs,
        step=RecurringStep,
        resolve=_resolve_recurring,
        describe=_describe_recurring,
        run=_run_recurring,
    ),
    change(
        "update_recurring",
        "update_recurring {item: code, name?, amount?, frequency?, next_due?, category?, active?}",
        "Changes a subscription or bill, such as its price or when it is next due, or pauses it "
        "(active: false).",
        args=UpdateRecurringArgs,
        step=UpdateRecurringStep,
        resolve=_resolve_update_recurring,
        describe=_describe_update_recurring,
        run=_run_update_recurring,
    ),
    change(
        "create_category",
        "create_category {name, group, emoji?, group_kind?}",
        "Adds a category to a group from the list, or to a new group if you give group_kind "
        "(expense, income or transfer). Later changes in the same proposal may use it.",
        args=CategoryArgs,
        step=CategoryStep,
        resolve=_resolve_category,
        describe=_describe_category,
        run=_run_category,
    ),
    change(
        "create_budget",
        "create_budget {name, period, amount}",
        "Adds a budget for a period (weekly, biweekly, monthly or yearly).",
        args=NewBudgetArgs,
        step=NewBudgetStep,
        resolve=_resolve_new_budget,
        describe=_describe_new_budget,
        run=_run_new_budget,
    ),
    change(
        "change_budget",
        "change_budget {budget: code, amount?, name?, period?}",
        "Changes a budget's amount (from the period the person is in), name or period.",
        args=ChangeBudgetArgs,
        step=ChangeBudgetStep,
        resolve=_resolve_change_budget,
        describe=_describe_change_budget,
        run=_run_change_budget,
    ),
    change(
        "add_budget_source",
        "add_budget_source {budget: code, category? | recurring: code, kind?}",
        "Counts a category, or the payments of a subscription or bill, toward a budget.",
        args=BudgetSourceArgs,
        step=BudgetSourceStep,
        resolve=_resolve_budget_source,
        describe=_describe_budget_source,
        run=_run_budget_source,
    ),
)
