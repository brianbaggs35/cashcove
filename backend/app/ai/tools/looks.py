"""The look-ups: what an AI can ask to see, and gets back as text.

Every answer is built from fields an AI may see, the same short list the chat is built from:
dates, amounts, payees (scrubbed), categories, and the names of subscriptions, bills and budgets.
An account is only ever a code. A transaction's raw description, its notes and its IDs are never
read at all.

A search can't be used to find out what was hidden. Looking for a word in the payees runs against
the real payees only to find candidates, and a row counts as found only if the word is in the
payee *as the AI is shown it*; otherwise asking for "9988" would say which payee has those digits
in it, though they are shown as "#".
"""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ColumnElement, func, or_, select

from app.ai.privacy import Text
from app.ai.tools.base import NO_CATEGORY, Context, Look, Money, Row, look
from app.ai.vault import Entity, Subject
from app.finance.budget import budget_links, find_budget, list_budgets
from app.finance.subscriptions import payment_stats
from app.finance.text import text_key
from app.finance.transactions import SORT_ORDERS, like_pattern
from app.models import Account, Category, RecurringKind, Subscription, Transaction

# How many transactions are shown, and how many of the newest are checked to find them.
SHOWN = 25
CANDIDATES = 200
MAX_RECURRING = 100
NOTHING = "(no category)"
UNKNOWN = "(unknown)"


class _Args(BaseModel):
    """What the AI writes is read leniently: anything it adds that isn't asked for is ignored."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


def _money(amount: Decimal, currency: str) -> str:
    return f"{amount:,.2f} {currency}"


def _account_code(ctx: Context, account_id: uuid.UUID, name: str) -> str:
    return ctx.vault.code_for(Entity(Subject.ACCOUNT, name, account_id))


# ---- Transactions ----------------------------------------------------------------------------


class FindArgs(_Args):
    text: str | None = None
    category: str | None = None
    direction: Literal["in", "out"] | None = None
    start: dt.date | None = Field(default=None, alias="from")
    end: dt.date | None = Field(default=None, alias="to")
    low: Money | None = Field(default=None, alias="min")
    high: Money | None = Field(default=None, alias="max")
    linked: bool | None = None
    limit: int = SHOWN


def _conditions(ctx: Context, args: FindArgs) -> list[ColumnElement[bool]]:
    where: list[ColumnElement[bool]] = []
    if args.text is not None:
        text = ctx.searched(args.text, "The text to look for", longest=60)
        where.append(Transaction.payee.ilike(like_pattern(text), escape="\\"))
    if args.category is not None:
        if text_key(args.category) in NO_CATEGORY:
            where.append(Transaction.category_id.is_(None))
        else:
            name = ctx.category(args.category)
            where.append(
                Transaction.category_id.in_(
                    select(Category.id).where(func.lower(Category.name) == text_key(name))
                )
            )
    if args.direction == "in":
        where.append(Transaction.amount > 0)
    elif args.direction == "out":
        where.append(Transaction.amount < 0)
    if args.start is not None:
        where.append(Transaction.date >= args.start)
    if args.end is not None:
        where.append(Transaction.date <= args.end)
    if args.low is not None:
        where.append(or_(Transaction.amount >= abs(args.low), Transaction.amount <= -abs(args.low)))
    if args.high is not None:
        where.append(Transaction.amount.between(-abs(args.high), abs(args.high)))
    if args.linked is not None:
        where.append(
            Transaction.subscription_id.is_not(None)
            if args.linked
            else Transaction.subscription_id.is_(None)
        )
    return where


class _Found(NamedTuple):
    id: uuid.UUID
    date: dt.date
    payee: str
    amount: Decimal
    account_id: uuid.UUID
    account: str
    currency: str
    category: str | None
    link: str | None


def find_transactions(ctx: Context, args: FindArgs) -> str:
    candidates = [
        _Found(*row)
        for row in ctx.db.execute(
            select(
                Transaction.id,
                Transaction.date,
                Transaction.payee,
                Transaction.amount,
                Transaction.account_id,
                Account.name.label("account"),
                Account.currency,
                Category.name.label("category"),
                Subscription.name.label("link"),
            )
            .join(Account, Account.id == Transaction.account_id)
            .outerjoin(Category, Category.id == Transaction.category_id)
            .outerjoin(Subscription, Subscription.id == Transaction.subscription_id)
            .where(*_conditions(ctx, args))
            .order_by(*SORT_ORDERS["-date"])
            .limit(CANDIDATES)
        )
    ]
    wanted = text_key(args.text) if args.text is not None else ""
    shown = [(row, ctx.shown(row.payee) or UNKNOWN) for row in candidates]
    found = [(row, payee) for row, payee in shown if wanted in text_key(payee)]
    if not found:
        return "No transactions match."
    lines = [
        " | ".join(
            [
                ctx.codes.issue(Row.TRANSACTION, row.id),
                str(row.date),
                payee,
                ctx.shown(row.category, Text.LABEL) if row.category else NOTHING,
                f"{row.amount:+,.2f} {row.currency}",
                _account_code(ctx, row.account_id, row.account),
                f"linked to {ctx.shown(row.link, Text.LABEL)}" if row.link else "not linked",
            ]
        )
        for row, payee in found[: min(max(args.limit, 1), SHOWN)]
    ]
    head = f"{len(found)} transactions match"
    if len(found) > len(lines):
        head += f", the newest {len(lines)} are shown"
    if len(candidates) == CANDIDATES:
        head += f" (only the newest {CANDIDATES} were checked: narrow it down with dates)"
    return "\n".join([f"{head}. Code | Date | Payee | Category | Amount | Account | Link", *lines])


# ---- Subscriptions and bills -----------------------------------------------------------------


class RecurringArgs(_Args):
    kind: Literal["subscription", "bill"] | None = None
    text: str | None = None


def list_recurring(ctx: Context, args: RecurringArgs) -> str:
    query = (
        select(Subscription, Account.name, Category.name)
        .join(Account, Account.id == Subscription.account_id)
        .outerjoin(Category, Category.id == Subscription.category_id)
        .order_by(Subscription.active.desc(), Subscription.next_due_date, Subscription.name)
        .limit(MAX_RECURRING)
    )
    if args.kind is not None:
        query = query.where(Subscription.kind == RecurringKind(args.kind))
    rows = ctx.db.execute(query).all()
    wanted = (
        text_key(ctx.searched(args.text, "The text to look for", longest=60))
        if args.text is not None
        else ""
    )
    rows = [row for row in rows if wanted in text_key(ctx.shown(row[0].name, Text.LABEL))]
    if not rows:
        return "No subscriptions or bills match."
    stats = payment_stats(ctx.db, [row[0].id for row in rows])
    lines: list[str] = []
    for item, account_name, category_name in rows:
        count = stats[item.id].count if item.id in stats else 0
        lines.append(
            " | ".join(
                [
                    ctx.codes.issue(Row.RECURRING, item.id),
                    str(item.kind),
                    ctx.shown(item.name, Text.LABEL),
                    f"{'about ' if item.amount_varies else ''}{_money(item.amount, ctx.currency)} "
                    f"{item.frequency}",
                    f"next {item.next_due_date}",
                    ctx.shown(category_name, Text.LABEL) if category_name else NOTHING,
                    "active" if item.active else "paused",
                    f"{count} payments",
                    f"payee {ctx.shown(item.payee)}",
                    _account_code(ctx, item.account_id, account_name),
                ]
            )
        )
    return "\n".join(
        [
            "Code | Kind | Name | Amount | Next due | Category | State | "
            "Payments | Payee | Account",
            *lines,
        ]
    )


# ---- Budgets ---------------------------------------------------------------------------------


class NoArgs(_Args):
    pass


def list_budgets_look(ctx: Context, args: NoArgs) -> str:
    budgets = list_budgets(ctx.db, ctx.rates, ctx.today)
    if not budgets:
        return "There are no budgets."
    lines: list[str] = []
    for budget in budgets:
        counted: list[str] = []
        for source in budget_links(ctx.db, find_budget(ctx.db, budget.id)):
            what = (
                _account_code(ctx, source.target_id, source.name)
                if source.type == "account"
                else ctx.shown(source.name, Text.LABEL)
            )
            counted.append(f"{source.type} {what} ({source.kind})")
        current = budget.current
        lines.append(
            " | ".join(
                [
                    ctx.codes.issue(Row.BUDGET, budget.id),
                    ctx.shown(budget.name, Text.LABEL),
                    str(budget.period),
                    f"{_money(budget.amount, ctx.currency)} each period",
                    f"this period {current.start} to {current.end}: "
                    f"spent {_money(current.spent, ctx.currency)}, "
                    f"income {_money(current.income, ctx.currency)}",
                    "counts "
                    + ("; ".join(counted) if counted else "nothing but single transactions"),
                ]
            )
        )
    return "\n".join(["Code | Name | Period | Amount | How this period is going | Counts", *lines])


LOOKS: tuple[Look, ...] = (
    look(
        "find_transactions",
        "find_transactions {text?, category?, direction?, from?, to?, min?, max?, linked?, limit?}",
        "Finds transactions, newest first, each with a code to use in changes. `text` is looked "
        'for in payees; `category` is a name from the list or "none"; `direction` is in or out; '
        "`from` and `to` are dates; `linked` says whether a subscription or bill has it.",
        FindArgs,
        find_transactions,
    ),
    look(
        "list_recurring",
        "list_recurring {kind?, text?}",
        "Lists the subscriptions and bills, each with a code, what it costs and when it is due.",
        RecurringArgs,
        list_recurring,
    ),
    look(
        "list_budgets",
        "list_budgets {}",
        "Lists the budgets, each with a code, how the current period is going and what counts.",
        NoArgs,
        list_budgets_look,
    ),
)
