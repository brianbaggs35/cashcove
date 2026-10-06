"""What a statement file holds, whichever format it's in, and telling the formats apart."""

import codecs
import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal

from app.models import AccountType, FileFormat

EXCEL = (
    "This looks like an Excel workbook. Open it in Excel or Numbers and save it as a CSV "
    "file, or download a CSV, OFX or QFX file from your bank instead."
)
_BINARY = {
    b"PK\x03\x04": EXCEL,
    b"\xd0\xcf\x11\xe0": EXCEL,
    b"%PDF": (
        "A PDF statement is read on the AI tab, which needs AI to be set up in Settings > AI. "
        "Or download a CSV, OFX, QFX or QIF file from your bank."
    ),
}
# Where the start of a file says which format it's in.
_HEAD = 65_536


class FileProblem(Exception):
    """A file Cashcove can't read at all, and what to tell people about it."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass
class FileRow:
    """One transaction as the file has it, or why it can't be read."""

    # Where it is in the file, counted from 1.
    line: int
    date: dt.date | None = None
    # In Cashcove's terms: positive for money in, negative for money out.
    amount: Decimal | None = None
    # What the file calls it, and more about it.
    description: str = ""
    memo: str | None = None
    # The file's own category for it.
    category: str | None = None
    # The file's ID for it, which keeps it from being imported twice.
    external_id: str | None = None
    # The account's balance after it, for files that have one.
    balance: Decimal | None = None
    problem: str | None = None


def payee_and_notes(payee: str, memo: str, check: str, *, memo_first: bool) -> tuple[str, str]:
    """A transaction's description, and its notes: the memo, and the check number if any.
    The memo is the payee when the file keeps payees there, or when there's no payee."""
    if memo_first and memo:
        payee, memo = memo, payee
    if not payee:
        payee, memo = memo, ""
    return payee, " · ".join(part for part in (memo, check) if part)


def settle(row: FileRow, written: str, text: str, amount: Decimal | None, *, flip: bool) -> None:
    """Gives the row its amount, or says why it can't be imported. ``written`` is its date as
    the file writes it, ``text`` its amount."""
    if row.date is None:
        row.problem = "It has no date." if not written else f"“{written[:40]}” isn't a date."
    elif amount is None:
        row.problem = "It has no amount." if not text else f"“{text[:40]}” isn't an amount."
    elif amount == 0:
        row.problem = "Its amount is zero."
    else:
        row.amount = -amount if flip else amount


@dataclass
class Statement:
    """One account's transactions. Most files have one; OFX and QIF files can have several."""

    rows: list[FileRow] = field(default_factory=list[FileRow])
    name: str | None = None
    institution: str | None = None
    type: AccountType | None = None
    # The last few characters of the account number.
    mask: str | None = None
    currency: str | None = None
    # The balance the statement ends on, and the day of it.
    closing: Decimal | None = None
    closing_date: dt.date | None = None


def decode(data: bytes) -> str:
    """The file's text, in whichever encoding it was saved in: UTF-8, UTF-16 with its byte
    order mark, or else Windows' Western European encoding, which older exports use."""
    for signature, message in _BINARY.items():
        if data.startswith(signature):
            raise FileProblem(message)
    if data.startswith(codecs.BOM_UTF8):
        text = data[len(codecs.BOM_UTF8) :].decode("utf-8", errors="replace")
    elif data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        text = data.decode("utf-16", errors="replace")
    else:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("cp1252", errors="replace")
    if "\x00" in text:
        raise FileProblem(
            "This doesn't look like a statement file. Choose a CSV, OFX, QFX, QBO or QIF file."
        )
    if not text.strip():
        raise FileProblem("The file is empty.")
    return text


def sniff(text: str) -> FileFormat:
    """Which format the file is in, from what it starts with rather than its name."""
    head = text[:_HEAD].lstrip()
    upper = head.upper()
    if upper.startswith("OFXHEADER") or "<OFX>" in upper:
        return FileFormat.OFX
    if upper.startswith(("!TYPE", "!ACCOUNT", "!OPTION", "!CLEAR")):
        return FileFormat.QIF
    return FileFormat.CSV
