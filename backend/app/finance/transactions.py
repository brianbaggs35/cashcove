"""Finding transactions: filters, search and sort orders for the Transactions tab."""

import re
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, UnaryExpression, func, or_, select

from app.models import Category, Transaction
from app.schemas.transactions import Sort, TransactionQuery

# Amounts people search for, like "42", "42.5", "$1,234.56" or "-18.20".
_AMOUNT = re.compile(r"[-+]?\s*[$€£¥]?\s*(\d{1,3}(?:,\d{3}){1,3}|\d{1,12})(?:\.(\d{1,2}))?")


def like_pattern(text: str, *, prefix_only: bool = False) -> str:
    """A LIKE pattern matching the text anywhere (or at the start), with wildcards escaped."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%" if prefix_only else f"%{escaped}%"


def searched_amount(text: str) -> Decimal | None:
    """The amount someone typed into the search box, if that's what it is."""
    match = _AMOUNT.fullmatch(text.strip())
    if match is None:
        return None
    whole, cents = match.groups()
    return Decimal(f"{whole.replace(',', '')}.{cents or '0'}")


def _search(text: str) -> ColumnElement[bool]:
    pattern = like_pattern(text)
    matches: list[ColumnElement[bool]] = [
        Transaction.payee.ilike(pattern, escape="\\"),
        Transaction.original_description.ilike(pattern, escape="\\"),
        Transaction.notes.ilike(pattern, escape="\\"),
        Transaction.category_id.in_(
            select(Category.id).where(Category.name.ilike(pattern, escape="\\"))
        ),
    ]
    amount = searched_amount(text)
    if amount is not None:
        # Whichever way the money went.
        matches.append(Transaction.amount.in_([amount, -amount]))
    return or_(*matches)


def conditions(query: TransactionQuery) -> list[ColumnElement[bool]]:
    """What a transaction has to match to be listed."""
    where: list[ColumnElement[bool]] = []
    if query.account_id:
        where.append(Transaction.account_id.in_(query.account_id))
    if query.category_id and query.uncategorized:
        where.append(
            or_(Transaction.category_id.in_(query.category_id), Transaction.category_id.is_(None))
        )
    elif query.category_id:
        where.append(Transaction.category_id.in_(query.category_id))
    elif query.uncategorized:
        where.append(Transaction.category_id.is_(None))
    if query.start is not None:
        where.append(Transaction.date >= query.start)
    if query.end is not None:
        where.append(Transaction.date <= query.end)
    if query.direction == "in":
        where.append(Transaction.amount > 0)
    elif query.direction == "out":
        where.append(Transaction.amount < 0)
    if query.status is not None:
        where.append(Transaction.pending.is_(query.status == "pending"))
    if query.source:
        where.append(Transaction.source.in_(query.source))
    if query.min_amount is not None:
        where.append(
            or_(Transaction.amount >= query.min_amount, Transaction.amount <= -query.min_amount)
        )
    if query.max_amount is not None:
        where.append(Transaction.amount.between(-query.max_amount, query.max_amount))
    if query.q:
        where.append(_search(query.q))
    return where


_NEWEST_FIRST = (Transaction.date.desc(), Transaction.created_at.desc(), Transaction.id.desc())
_OLDEST_FIRST = (Transaction.date.asc(), Transaction.created_at.asc(), Transaction.id.asc())

# Ties are broken newest first, so the order is stable from page to page.
SORT_ORDERS: dict[Sort, tuple[UnaryExpression[Any], ...]] = {
    "-date": _NEWEST_FIRST,
    "date": _OLDEST_FIRST,
    "-amount": (Transaction.amount.desc(), *_NEWEST_FIRST),
    "amount": (Transaction.amount.asc(), *_NEWEST_FIRST),
    "-payee": (func.lower(Transaction.payee).desc(), *_NEWEST_FIRST),
    "payee": (func.lower(Transaction.payee).asc(), *_NEWEST_FIRST),
}
