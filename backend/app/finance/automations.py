"""Sorting transactions with the household's automations and its subscriptions' own payees.

Automations only ever add: they give a category and link a subscription, and never take one
away or change what someone chose by hand (``Transaction.category_chosen``). They sort a
transaction when it arrives, whether Plaid synced it, a statement file brought it or it was
added by hand, when the bank changes it, and the ones already there when an automation that
covers the past is saved.

An automation looks for text in a transaction's payee and in what the bank called it, which
differ from one source to the next: Plaid names "Amazon" what a statement file calls
"AMZN Mktp US*2K4TT3Y81". It can also look at how much the transaction was for, since one
payee can bill several subscriptions, and a utility bill is a different amount every month.

Everything an automation is made of is plain data (see ``Automation``), and ``overlaps`` and
``match_count`` say what one would do before it exists, so rules can be proposed by anything
that can fill in that data, and checked first.
"""

import re
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import ColumnElement, and_, func, not_, or_, select, update
from sqlalchemy.orm import Session

from app.finance.subscriptions import advance_due_date, normalized_payee
from app.finance.text import column_key, text_key
from app.finance.transactions import like_pattern
from app.models import (
    Automation,
    AutomationDirection,
    AutomationMatch,
    Subscription,
    Transaction,
)
from app.models.base import Money


@dataclass(frozen=True)
class Looks:
    """What an automation looks for in a transaction: any of its texts in the payee or in what
    the bank called it, in the account if one is named, for as much as it's bounded to, and
    for the way the money went if it says."""

    payees: Sequence[str]
    match: AutomationMatch = AutomationMatch.EXACT
    account_id: uuid.UUID | None = None
    # How much it was for, whichever way the money went; either end can be open.
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    # Only money coming in, or only money going out, or either.
    direction: AutomationDirection = AutomationDirection.ANY

    @classmethod
    def of(cls, automation: Automation) -> "Looks":
        return cls(
            automation.payees,
            automation.match,
            automation.account_id,
            automation.min_amount,
            automation.max_amount,
            automation.direction,
        )

    @property
    def keys(self) -> list[str]:
        return payee_keys(self.payees)


def _by_key(payees: Iterable[str]) -> dict[str, str]:
    """Each one once, by what it's compared by, written the first way it was."""
    first: dict[str, str] = {}
    for payee in payees:
        first.setdefault(text_key(payee), payee)
    return first


def distinct_payees(payees: Iterable[str]) -> list[str]:
    """What an automation looks for, without repeats, in the order given."""
    return list(_by_key(payees).values())


def payee_keys(payees: Iterable[str]) -> list[str]:
    """What the payees are compared by, each once, in the order given."""
    return list(_by_key(payees))


def matching(looks: Looks, keys: Sequence[str] | None = None) -> list[ColumnElement[bool]]:
    """What a transaction has to be to belong to an automation that looks like this: its payee
    or what the bank called it is, starts with or contains one of the texts (or of `keys`, the
    texts compared by), in the account and amounts it names."""
    wanted = looks.keys if keys is None else keys
    # A transaction with no description has no text there to find: "" is never one of the
    # texts, and keeps the comparison from being null, which would also make its opposite null.
    columns = (
        column_key(Transaction.payee),
        func.coalesce(column_key(Transaction.original_description), ""),
    )
    if looks.match == AutomationMatch.EXACT:
        texts = [column.in_(wanted) for column in columns]
    else:
        prefix = looks.match == AutomationMatch.STARTS_WITH
        texts = [
            column.like(like_pattern(key, prefix_only=prefix), escape="\\")
            for column in columns
            for key in wanted
        ]
    where: list[ColumnElement[bool]] = [or_(*texts)]
    if looks.account_id is not None:
        where.append(Transaction.account_id == looks.account_id)
    if looks.direction == AutomationDirection.IN:
        where.append(Transaction.amount > 0)
    elif looks.direction == AutomationDirection.OUT:
        where.append(Transaction.amount < 0)
    # Typed as money, so what it's compared with is counted in cents too.
    amount = func.abs(Transaction.amount, type_=Money())
    if looks.min_amount is not None:
        where.append(amount >= looks.min_amount)
    if looks.max_amount is not None:
        where.append(amount <= looks.max_amount)
    return where


def match_count(db: Session, looks: Looks) -> int:
    """How many transactions the household has that an automation looking like this sorts."""
    return db.scalar(select(func.count()).select_from(Transaction).where(*matching(looks))) or 0


def _comparison(keys: Iterable[str], match: AutomationMatch) -> Callable[[str], bool]:
    """Whether a text, already as compared, is one of the keys, or starts with or has one."""
    if match == AutomationMatch.EXACT:
        return frozenset(keys).__contains__
    start = "^" if match == AutomationMatch.STARTS_WITH else ""
    pattern = re.compile(f"{start}(?:{'|'.join(map(re.escape, keys))})")
    return lambda text: pattern.search(text) is not None


def _tracking(subscription: Subscription | None) -> Subscription | None:
    """The subscription, unless it's gone or its payments aren't being tracked now."""
    return subscription if subscription is not None and subscription.active else None


@dataclass(frozen=True)
class _Rule:
    compare: Callable[[str], bool]
    direction: AutomationDirection
    account_id: uuid.UUID | None
    min_amount: Decimal | None
    max_amount: Decimal | None
    category_id: uuid.UUID | None
    # None when it has none, or the subscription's tracking is paused.
    subscription: Subscription | None

    def covers(self, transaction: Transaction) -> bool:
        if self.account_id not in (None, transaction.account_id):
            return False
        if (self.direction == AutomationDirection.IN and transaction.amount <= 0) or (
            self.direction == AutomationDirection.OUT and transaction.amount >= 0
        ):
            return False
        amount = abs(transaction.amount)
        if (self.min_amount is not None and amount < self.min_amount) or (
            self.max_amount is not None and amount > self.max_amount
        ):
            return False
        described = transaction.original_description
        return self.compare(text_key(transaction.payee)) or (
            described is not None and self.compare(text_key(described))
        )


@dataclass(frozen=True)
class Sorting:
    """What the rules give a transaction."""

    category_id: uuid.UUID | None
    # None when it has none, or the subscription's tracking is paused.
    subscription: Subscription | None


class RuleBook:
    """Everything that sorts a new transaction, loaded once for a request, a sync or an import.

    The oldest automation wins when several give a transaction a category or subscription.
    Automations come before a subscription's own account and payee, which fill in what they
    leave. Only payments (money out) are linked to subscriptions.
    """

    def __init__(
        self, automations: Sequence[Automation], subscriptions: Sequence[Subscription]
    ) -> None:
        by_id: dict[uuid.UUID | None, Subscription] = {item.id: item for item in subscriptions}
        self._rules = [
            _Rule(
                compare=_comparison(payee_keys(automation.payees), automation.match),
                direction=automation.direction,
                account_id=automation.account_id,
                min_amount=automation.min_amount,
                max_amount=automation.max_amount,
                category_id=automation.category_id,
                subscription=_tracking(by_id.get(automation.subscription_id)),
            )
            for automation in automations
        ]
        self._own = {
            (item.account_id, normalized_payee(item.payee)): item
            for item in subscriptions
            if item.active
        }

    @classmethod
    def load(cls, db: Session) -> "RuleBook":
        automations = db.scalars(
            select(Automation)
            .where(Automation.active.is_(True))
            .order_by(Automation.created_at, Automation.id)
        )
        return cls(list(automations), list(db.scalars(select(Subscription))))

    def sorting(self, transaction: Transaction) -> "Sorting":
        """What the rules give a transaction, without giving it: the category (a subscription's
        own, when no automation gives one) and the subscription or bill."""
        category_id, subscription = self._pick(transaction)
        if subscription is not None:
            category_id = category_id or subscription.category_id
        return Sorting(category_id, subscription)

    def _pick(self, transaction: Transaction) -> tuple[uuid.UUID | None, Subscription | None]:
        """The category and subscription the rules give a transaction: where several give one,
        the oldest rule wins."""
        payment = transaction.amount < 0
        category_id: uuid.UUID | None = None
        subscription: Subscription | None = None
        for rule in self._rules:
            if rule.covers(transaction):
                category_id = category_id or rule.category_id
                if payment:
                    subscription = subscription or rule.subscription
        if subscription is None and payment:
            own = (transaction.account_id, normalized_payee(transaction.payee))
            subscription = self._own.get(own)
        return category_id, subscription

    def sort(self, transaction: Transaction, *, keep_category: bool = False) -> bool:
        """Gives a transaction the category and subscription its rules say. `keep_category`
        leaves the category alone, for when someone chose it just now; one chosen earlier is
        left alone too. Returns whether it changed anything."""
        sorting = self.sorting(transaction)
        changed = False
        subscription = sorting.subscription
        if subscription is not None and transaction.subscription_id != subscription.id:
            transaction.subscription_id = subscription.id
            advance_due_date(subscription, transaction.date)
            changed = True
        category_id = sorting.category_id
        if (
            category_id is not None
            and not (keep_category or transaction.category_chosen)
            and transaction.category_id != category_id
        ):
            transaction.category_id = category_id
            changed = True
        return changed


def _wins(db: Session, automation: Automation) -> list[Automation]:
    """The active automations that win over this one where both give a transaction the same
    kind of thing: the ones made before it."""
    return list(
        db.scalars(
            select(Automation)
            .where(
                Automation.active.is_(True),
                or_(
                    Automation.created_at < automation.created_at,
                    and_(
                        Automation.created_at == automation.created_at,
                        Automation.id < automation.id,
                    ),
                ),
            )
            .order_by(Automation.created_at, Automation.id)
        )
    )


def _claimed(automations: Iterable[Automation]) -> list[ColumnElement[bool]]:
    """What a transaction mustn't be to be sorted by an automation these win over."""
    claims = [and_(*matching(Looks.of(other))) for other in automations]
    return [not_(or_(*claims))] if claims else []


def _give_category(
    db: Session,
    where: Sequence[ColumnElement[bool]],
    older: Sequence[Automation],
    category_id: uuid.UUID,
    *extra: ColumnElement[bool],
) -> list[uuid.UUID]:
    """Gives the transactions `where` finds a category, except where an older automation gives
    one and where someone chose theirs. Returns the ones it changed."""
    taken = _claimed(other for other in older if other.category_id is not None)
    return list(
        db.scalars(
            update(Transaction)
            .where(
                *where,
                *extra,
                *taken,
                Transaction.category_chosen.is_(False),
                Transaction.category_id.is_distinct_from(category_id),
            )
            .values(category_id=category_id)
            .returning(Transaction.id)
        )
    )


def _link_subscription(
    db: Session,
    automation: Automation,
    subscription: Subscription,
    where: Sequence[ColumnElement[bool]],
    older: Sequence[Automation],
) -> set[uuid.UUID]:
    """Links the payments `where` finds to the subscription, except where an older automation
    links one that is being tracked, and brings its next due date up to date. Returns the
    transactions it changed."""
    payments = Transaction.amount < 0
    tracked = {item.id for item in db.scalars(select(Subscription).where(Subscription.active))}
    taken = _claimed(other for other in older if other.subscription_id in tracked)
    changed = set(
        db.scalars(
            update(Transaction)
            .where(
                *where,
                payments,
                *taken,
                Transaction.subscription_id.is_distinct_from(subscription.id),
            )
            .values(subscription_id=subscription.id)
            .returning(Transaction.id)
        )
    )
    if automation.category_id is None and subscription.category_id is not None:
        changed.update(_give_category(db, where, older, subscription.category_id, payments))
    latest = db.scalar(
        select(func.max(Transaction.date)).where(
            *where, payments, Transaction.subscription_id == subscription.id
        )
    )
    if latest is not None:
        advance_due_date(subscription, latest)
    return changed


def apply_to_existing(
    db: Session, automation: Automation, keys: Sequence[str] | None = None
) -> int:
    """Sorts every transaction the automation covers, whenever it arrived, or only those of
    some of its texts (by `keys`), except where an older automation gives the same thing.
    Returns how many it changed."""
    where = matching(Looks.of(automation), keys)
    older = _wins(db, automation)
    changed: set[uuid.UUID] = set()
    if automation.category_id is not None:
        changed.update(_give_category(db, where, older, automation.category_id))
    subscription = (
        _tracking(db.get(Subscription, automation.subscription_id))
        if automation.subscription_id is not None
        else None
    )
    if subscription is not None:
        changed.update(_link_subscription(db, automation, subscription, where, older))
    return len(changed)


@dataclass(frozen=True)
class Overlap:
    """Another automation that gives some of the same transactions the same kind of thing."""

    automation: Automation
    # How many of the household's transactions both of them sort.
    count: int


def overlaps(
    db: Session,
    looks: Looks,
    *,
    category: bool,
    subscription: bool,
    except_id: uuid.UUID | None = None,
) -> list[Overlap]:
    """The other active automations that would also give a category (when this gives one), or
    link a subscription (when it does), to transactions this one sorts. The older one wins
    where they do, so people are told before they pile up."""
    here = matching(looks)
    query = select(Automation).where(Automation.active.is_(True))
    if except_id is not None:
        query = query.where(Automation.id != except_id)
    found: list[Overlap] = []
    for other in db.scalars(query.order_by(Automation.created_at, Automation.id)):
        if not (
            (category and other.category_id is not None)
            or (subscription and other.subscription_id is not None)
        ):
            continue
        both = matching(Looks.of(other))
        count = db.scalar(select(func.count()).select_from(Transaction).where(*here, *both)) or 0
        if count:
            found.append(Overlap(automation=other, count=count))
    return found
