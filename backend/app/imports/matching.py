"""Finding which of a file's rows an account already has, and naming and categorizing the rest
the way the household named and categorized the same ones before."""

import datetime as dt
import itertools
import re
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.finance.text import column_key, text_key
from app.finance.transactions import SORT_ORDERS
from app.imports.files import FileRow
from app.models import Account, Category, Transaction, TransactionSource
from app.schemas.imports import RowStatus

# A transaction entered by hand, or synced from the bank, can be dated a few days off the
# statement's date for the same one.
WINDOW = dt.timedelta(days=3)
# Looked up this many at a time, well inside the database's limit on query parameters.
LOOKUP_BATCH = 500
UNKNOWN_PAYEE = "Unknown payee"
# Between the parts of a category like "Travel-Airline"; each part is tidied afterwards.
_CATEGORY_PARTS = re.compile(r"[-:/>|]")
_NOT_WORDS = re.compile(r"[^0-9a-z&]+")

# Categories banks put in their exports (Chase, American Express, Capital One, Discover and
# others), under the starting category (app/finance/categories.py) each one means. Names
# match in lowercase, with "and" as "&". A category of the household's own with the bank's
# name comes first.
_BANK_CATEGORY_NAMES = {
    "Restaurants": ("food & drink", "dining", "restaurant", "fast food"),
    "Groceries": ("grocery", "supermarkets"),
    "Coffee": ("coffee shops",),
    "Gas & fuel": ("gas", "gasoline", "fuel", "gas stations", "gas automotive"),
    "Car maintenance": ("automotive", "auto"),
    "Travel": (
        "airline",
        "airfare",
        "lodging",
        "hotel",
        "car rental",
        "vehicle rental",
        "other travel",
    ),
    "Shopping": (
        "merchandise",
        "general merchandise",
        "department stores",
        "warehouse clubs",
        "general retail",
        "internet purchase",
    ),
    "Clothing": ("clothing stores",),
    "Electronics": ("computer supplies",),
    "Home maintenance": ("hardware supplies", "home", "home improvement"),
    "Pharmacy": ("pharmacies",),
    "Utilities": ("bills & utilities",),
    "Phone & internet": ("phone", "internet", "mobile phone", "phone cable", "communications"),
    "Medical": (
        "health & wellness",
        "health",
        "health care",
        "healthcare",
        "medical services",
        "health care services",
    ),
    "Fitness": ("gym",),
    "Personal care": ("personal",),
    "Gifts & donations": ("gifts", "donations", "charity"),
    "Bank fees": ("fees & adjustments", "fees", "fee", "fee interest charge"),
    "Taxes": ("tax",),
    "Credit card payments": ("payment", "payments", "payments & credits"),
    "Transfers": ("transfer",),
    "Other income": ("income",),
    "Paycheck": ("salary", "payroll"),
    "Interest & dividends": ("interest", "dividends"),
    "Rent & mortgage": ("rent", "mortgage"),
    "Cash & ATM": ("cash", "atm"),
    "Subscriptions": ("streaming",),
    "Parking & tolls": ("parking", "parking charges", "tolls", "tolls & fees"),
    "Public transit": ("public transportation", "transit", "rail services"),
    "Rideshare & taxis": ("taxi", "taxis & rideshare", "taxis & limousines", "rideshare"),
    "Pets": ("pet",),
}
BANK_CATEGORIES = {bank: ours for ours, names in _BANK_CATEGORY_NAMES.items() for bank in names}


def _category_key(text: str) -> str:
    words = f" {text.casefold()} ".replace(" and ", " & ")
    return " ".join(_NOT_WORDS.sub(" ", words).split())


@dataclass
class Reviewed:
    """A row of the file, and what importing it would do."""

    row: FileRow
    status: RowStatus
    payee: str | None = None
    category_id: uuid.UUID | None = None
    # The transaction already in the account that it repeats.
    match: Transaction | None = None


class _Existing:
    """The account's transactions from around the file's days, and any with the file's IDs.
    Each one can be matched by one row of the file, so a file with two identical coffees
    matches two in the account."""

    def __init__(self, db: Session, account: Account | None, rows: list[FileRow]) -> None:
        self.rows: list[Transaction] = []
        self.by_id: dict[str, Transaction] = {}
        self.used: set[uuid.UUID] = set()
        self.by_content: defaultdict[tuple[dt.date, Decimal, str], list[Transaction]] = defaultdict(
            list
        )
        self.by_amount: defaultdict[Decimal, list[Transaction]] = defaultdict(list)
        # Rows that can be read all have a date.
        days = [row.date for row in rows if row.date]
        if account is None or not days:
            return
        self.rows = list(
            db.scalars(
                select(Transaction)
                .where(
                    Transaction.account_id == account.id,
                    Transaction.date.between(min(days) - WINDOW, max(days) + WINDOW),
                )
                .order_by(*SORT_ORDERS["date"])
            )
        )
        for row in self.rows:
            for description in {_described(row), text_key(row.payee)}:
                self.by_content[(row.date, row.amount, description)].append(row)
            self.by_amount[row.amount].append(row)
        # An account has each ID once, however long ago it came in.
        ids = sorted({row.external_id for row in rows if row.external_id})
        for batch in itertools.batched(ids, LOOKUP_BATCH, strict=False):
            for transaction in db.scalars(
                select(Transaction).where(
                    Transaction.account_id == account.id, Transaction.external_id.in_(batch)
                )
            ):
                self.by_id[transaction.external_id or ""] = transaction

    def take(self, transaction: Transaction | None) -> Transaction | None:
        if transaction is None or transaction.id in self.used:
            return None
        self.used.add(transaction.id)
        return transaction

    def same_id(self, row: FileRow) -> Transaction | None:
        """The one with the row's ID. When the account has that ID on a different amount, or
        weeks apart, it isn't an ID the bank gave only this transaction, like a reference
        people type, so the row goes without it."""
        found = self.by_id.get(row.external_id or "")
        if found is None:
            return None
        apart = abs(found.date - (row.date or dt.date.min))
        if found.amount == row.amount and apart <= WINDOW:
            return self.take(found)
        row.external_id = None
        return None

    def same(self, row: FileRow) -> Transaction | None:
        candidates = self.by_content.get(_content(row), [])
        return self.take(next((item for item in candidates if item.id not in self.used), None))

    def near(self, row: FileRow, payee: str) -> Transaction | None:
        """One with the same amount a few days either side, most likely one entered by hand.
        File imports normally need the same day, except when the payee matches too."""
        day = row.date or dt.date.min
        payee_key = text_key(payee)

        def distance(item: Transaction) -> int:
            return abs((item.date - day).days)

        def same_payee(item: Transaction) -> bool:
            return payee_key in {_described(item), text_key(item.payee)}

        candidates = [
            item
            for item in self.by_amount.get(row.amount or Decimal(0), [])
            if item.id not in self.used
            and distance(item)
            <= (WINDOW.days if item.source != TransactionSource.FILE or same_payee(item) else 0)
        ]
        candidates.sort(
            key=lambda item: (
                not same_payee(item),
                distance(item),
                item.source == TransactionSource.FILE,
            )
        )
        return self.take(next(iter(candidates), None))


def _described(transaction: Transaction) -> str:
    return text_key(transaction.original_description or transaction.payee)


def _content(row: FileRow) -> tuple[dt.date, Decimal, str]:
    return (row.date or dt.date.min, row.amount or Decimal(0), text_key(row.description))


class Namer:
    """Payees and categories for new transactions, from what the household chose before.

    A transaction with the same description as one before gets that one's payee and category,
    so renaming "WHOLEFDS MKT #10234" to "Whole Foods" once names every later one. Otherwise
    the file's own category decides, and then the category the payee had last.
    """

    def __init__(self, db: Session, rows: Iterable[FileRow]) -> None:
        self.db = db
        descriptions = {text_key(row.description) for row in rows if row.description}
        self.by_description: dict[str, tuple[str, uuid.UUID | None]] = {}
        for batch in itertools.batched(sorted(descriptions), LOOKUP_BATCH, strict=False):
            for description, payee, category_id in db.execute(
                select(Transaction.original_description, Transaction.payee, Transaction.category_id)
                .where(column_key(Transaction.original_description).in_(batch))
                .order_by(*SORT_ORDERS["-date"])
            ):
                self.by_description.setdefault(text_key(description or ""), (payee, category_id))
        self.categories = {
            _category_key(name): category_id
            for category_id, name in db.execute(select(Category.id, Category.name))
        }
        payees = {text_key(payee) for payee, _ in self.by_description.values()} | descriptions
        self.by_payee: dict[str, uuid.UUID | None] = {}
        for batch in itertools.batched(sorted(payees), LOOKUP_BATCH, strict=False):
            for payee, category_id in db.execute(
                select(Transaction.payee, Transaction.category_id)
                .where(
                    column_key(Transaction.payee).in_(batch), Transaction.category_id.is_not(None)
                )
                .order_by(*SORT_ORDERS["-date"])
            ):
                self.by_payee.setdefault(text_key(payee), category_id)

    def file_category(self, text: str | None) -> uuid.UUID | None:
        """The household's category for the file's: by its name, the name of one part of it
        ("Travel-Airline"), or a name banks use for one of the starting categories."""
        if not text:
            return None
        whole = _category_key(text)
        parts = [_category_key(part) for part in reversed(_CATEGORY_PARTS.split(text))]
        for key in dict.fromkeys([whole, *parts]):
            found = self.categories.get(key)
            if found is None and key in BANK_CATEGORIES:
                found = self.categories.get(_category_key(BANK_CATEGORIES[key]))
            if found is not None:
                return found
        return None

    def name(self, row: FileRow) -> tuple[str, uuid.UUID | None]:
        known = self.by_description.get(text_key(row.description))
        if known is not None and known[1] is not None:
            return known
        payee = known[0] if known else (row.description or row.memo or UNKNOWN_PAYEE)[:160]
        category = self.file_category(row.category) or self.by_payee.get(text_key(payee))
        return payee, category


def _same_ids(rows: list[FileRow]) -> set[int]:
    """Lines that repeat an earlier line with the same ID. Rows that only share an ID with
    another, but differ, lose it instead, since the bank didn't give them one of their own."""
    seen: dict[str, FileRow] = {}
    repeats: set[int] = set()
    for row in rows:
        if row.external_id is None:
            continue
        earlier = seen.setdefault(row.external_id, row)
        if earlier is row:
            continue
        if _content(earlier) == _content(row):
            repeats.add(row.line)
        else:
            row.external_id = None
    return repeats


def _matched(
    existing: _Existing, rows: list[FileRow], namer: Namer
) -> tuple[dict[int, Transaction], dict[int, Transaction]]:
    """By line, transactions identified by bank ID and ones the account might already have."""
    matches: dict[int, Transaction] = {}
    for row in rows:
        if (found := existing.same_id(row)) is not None:
            matches[row.line] = found
    possible: dict[int, Transaction] = {}
    for row in rows:
        if row.line not in matches and (found := existing.same(row)) is not None:
            possible[row.line] = found
    for row in rows:
        if (
            row.line not in matches
            and row.line not in possible
            and (found := existing.near(row, namer.name(row)[0])) is not None
        ):
            possible[row.line] = found
    return matches, possible


def review(db: Session, rows: list[FileRow], account: Account | None) -> list[Reviewed]:
    """Each row's fate: new, already in the account, possibly already in it, or unreadable."""
    readable = [row for row in rows if row.problem is None]
    repeats = _same_ids(readable)
    fresh = [row for row in readable if row.line not in repeats]
    namer = Namer(db, fresh)
    matches, possible = _matched(_Existing(db, account, readable), fresh, namer)
    results: list[Reviewed] = []
    for row in rows:
        if row.problem is not None:
            results.append(Reviewed(row, "invalid"))
        elif row.line in repeats:
            row.problem = "It's in the file twice."
            results.append(Reviewed(row, "duplicate"))
        elif row.line in matches:
            results.append(Reviewed(row, "duplicate", match=matches[row.line]))
        else:
            payee, category_id = namer.name(row)
            status: RowStatus = "possible_duplicate" if row.line in possible else "new"
            results.append(Reviewed(row, status, payee, category_id, possible.get(row.line)))
    return results
