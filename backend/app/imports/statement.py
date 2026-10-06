"""The transactions read off a PDF statement, as a file the import can read.

The AI reads a PDF (see ``app.ai.statements``), and a person checks and corrects what it found.
This is how those rows then reach the preview and the import: as a small JSON document that is
read like any other file, so the rows are checked against the account, sorted by automations,
counted and undone the way a CSV file's are.
"""

import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from app.imports.files import FileProblem, FileRow, Statement, settle

# What a document starts with, which no CSV, OFX or QIF file does.
MARKER = "cashcove-statement"
# A statement has a few hundred transactions at most.
MAX_ROWS = 2_000
UNKNOWN_PAYEE = "Unknown payee"
UNREADABLE = "That statement couldn't be read. Read the PDF again."


class _Row(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: dt.date | None = None
    payee: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    # In Cashcove's terms: positive for money in, negative for money out.
    amount: Annotated[Decimal, Field(max_digits=12, decimal_places=2)] | None = None


class _Document(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["cashcove-statement"]
    version: Literal[1]
    rows: Annotated[list[_Row], Field(max_length=MAX_ROWS)]


def is_statement(text: str) -> bool:
    """Whether the file is one of these documents, from how it starts."""
    return text.lstrip().startswith("{") and MARKER in text[:200]


def read_statement(text: str) -> list[Statement]:
    """The one statement the document holds, with a row for each of its rows."""
    try:
        document = _Document.model_validate_json(text)
    except ValidationError:
        raise FileProblem(UNREADABLE) from None
    rows: list[FileRow] = []
    for number, item in enumerate(document.rows, start=1):
        row = FileRow(line=number, date=item.date, description=item.payee or UNKNOWN_PAYEE)
        settle(row, "", "", item.amount, flip=False)
        rows.append(row)
    return [Statement(rows=rows)]
