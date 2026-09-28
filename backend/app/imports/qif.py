"""Reading QIF files, Quicken's older plain-text format.

Each line starts with a letter saying what it holds (D for the date, T for the amount, P for
the payee), and a line with ``^`` ends each transaction. ``!Type:`` lines start a list of an
account's transactions, and ``!Account`` blocks name the account that follows.
"""

from dataclasses import dataclass, field

from app.imports.files import FileProblem, FileRow, Statement
from app.imports.ofx import INVESTMENTS, NO_TRANSACTIONS
from app.imports.values import (
    clean_text,
    date_orders,
    guess_decimal_mark,
    locale_date_order,
    parse_amount,
    parse_date,
)
from app.models import AccountType
from app.schemas.imports import DateOrder, DecimalMark, ImportOptions

_ACCOUNT_TYPES = {
    "bank": AccountType.CHECKING,
    "cash": AccountType.CASH,
    "ccard": AccountType.CREDIT_CARD,
    "oth a": AccountType.OTHER,
    "oth l": AccountType.LOAN,
}
_INVESTMENT_TYPES = frozenset({"invst", "port"})


@dataclass
class _Record:
    """A transaction's lines, by their letter."""

    line: int
    fields: dict[str, str] = field(default_factory=dict[str, str])


@dataclass
class _Section:
    type: str
    name: str | None
    records: list[_Record] = field(default_factory=list[_Record])


def _sections(text: str) -> tuple[list[_Section], bool]:
    """The file's lists of transactions, and whether it has investment ones, which are left
    out. Other lists, like categories and memorized transactions, are left out too."""
    sections: list[_Section] = []
    current: _Section | None = None
    record: dict[str, str] = {}
    account: dict[str, str] | None = None
    investments = False
    count = 0
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("!"):
            header = line[1:].lower()
            if header == "account":
                account = {}
            elif header.startswith("type:"):
                kind = header[5:].strip()
                investments = investments or kind in _INVESTMENT_TYPES
                name = (account or {}).get("N")
                current = _Section(kind, name) if kind in _ACCOUNT_TYPES else None
                if current is not None:
                    sections.append(current)
                account = None
            record = {}
        elif line.startswith("^"):
            if account is not None:
                # The end of an account's details; its transactions follow.
                continue
            if current is not None and record:
                count += 1
                current.records.append(_Record(count, record))
            record = {}
        elif line:
            target = account if account is not None else record
            # A split's lines repeat letters; the transaction's own come first.
            target.setdefault(line[0], line[1:].strip())
    return sections, investments


def _category(text: str) -> str | None:
    """Quicken's category, without its class; transfers name an account in brackets."""
    category = text.split("/")[0].strip()
    if not category or category.startswith("["):
        return None
    return category[:60]


def _row(record: _Record, options: ImportOptions) -> FileRow:
    fields = record.fields
    payee, memo = fields.get("P", ""), fields.get("M", "")
    if options.payee_field == "memo" and memo:
        payee, memo = memo, payee
    if not payee:
        payee, memo = memo, ""
    number = fields.get("N", "")
    check = f"Check {number}" if number.isdigit() else ""
    notes = " · ".join(part for part in (clean_text(memo), check) if part)
    row = FileRow(
        line=record.line,
        description=clean_text(payee)[:255],
        memo=notes[:1000] or None,
        category=_category(fields.get("L", "")),
    )
    text = fields.get("T") or fields.get("U", "")
    written = fields.get("D", "")
    row.date = parse_date(written, options.date_order) if written else None
    amount = parse_amount(text, options.decimal_mark)
    if row.date is None:
        row.problem = "It has no date." if not written else f"“{written[:40]}” isn't a date."
    elif amount is None:
        row.problem = "It has no amount." if not text else f"“{text[:40]}” isn't an amount."
    elif amount == 0:
        row.problem = "Its amount is zero."
    else:
        row.amount = -amount if options.flip else amount
    return row


def _detect(sections: list[_Section], locale: str) -> ImportOptions:
    records = [record for section in sections for record in section.records]
    dates = [record.fields.get("D", "") for record in records]
    amounts = [record.fields.get("T") or record.fields.get("U", "") for record in records]
    orders = date_orders(dates)
    preferred = locale_date_order(locale)
    order: DateOrder = preferred if preferred in orders or not orders else orders[0]
    mark: DecimalMark = guess_decimal_mark(amounts)
    return ImportOptions(date_order=order, decimal_mark=mark)


def read_qif(
    text: str, options: ImportOptions | None, locale: str
) -> tuple[list[Statement], ImportOptions]:
    """Each account's transactions in the file, and how they were read."""
    sections, investments = _sections(text)
    sections = [section for section in sections if section.records]
    if not sections:
        raise FileProblem(INVESTMENTS if investments else NO_TRANSACTIONS)
    options = options or _detect(sections, locale)
    statements = [
        Statement(
            rows=[_row(record, options) for record in section.records],
            name=section.name[:80] if section.name else None,
            type=_ACCOUNT_TYPES[section.type],
        )
        for section in sections
    ]
    return statements, options
