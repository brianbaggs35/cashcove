"""Request and response models for the Import tab."""

import datetime as dt
import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.models import AccountType, FileFormat, TransactionSource
from app.schemas.fields import STRICT, AmountOut, Name

# Files are small: a year of a busy card is a few hundred kilobytes.
MAX_FILE_BYTES = 5 * 1024 * 1024
# Base64 takes four characters for every three bytes.
MAX_CONTENT = -(-MAX_FILE_BYTES // 3) * 4
# Rows a file can have, and columns a CSV file can have.
MAX_ROWS = 10_000
MAX_COLUMNS = 100

# Which way round a date's numbers go when they're all numbers: 2026-09-26, 09/26/2026 or
# 26/09/2026.
DateOrder = Literal["ymd", "mdy", "dmy"]
DecimalMark = Literal[".", ","]
Delimiter = Literal[",", ";", "\t", "|"]
# How a CSV file gives amounts: in one column, in separate columns for money in and money out,
# or in one column beside another that says which way the money went ("Debit", "CR").
AmountColumns = Literal["one", "split", "direction"]
# Where an OFX or QIF transaction's payee comes from: its name, or its memo, for banks that
# put the same few words in every name ("POS PURCHASE") and the details in the memo.
PayeeField = Literal["name", "memo"]
# What importing does to the account's balance: set it to the balance the file ends on, move
# it by what's imported, as adding the transactions by hand would, or leave it alone because
# it already counts them.
BalanceChoice = Literal["file", "move", "keep"]
RowStatus = Literal["new", "duplicate", "possible_duplicate", "invalid"]
# What a CSV file's columns have to say where to find. Transactions without a payee are named
# by their memo, or "Unknown payee".
NeededField = Literal["date", "amount"]

ColumnIndex = Annotated[int, Field(ge=0, lt=MAX_COLUMNS)]
FileName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
DirectionValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]


class CsvColumns(BaseModel):
    """Which column holds what, counted from 0. Columns left out aren't in the file."""

    model_config = STRICT

    date: ColumnIndex | None = None
    amount: ColumnIndex | None = None
    money_in: ColumnIndex | None = None
    money_out: ColumnIndex | None = None
    # Says which way an amount went, like "Debit" and "Credit".
    direction: ColumnIndex | None = None
    payee: ColumnIndex | None = None
    memo: ColumnIndex | None = None
    category: ColumnIndex | None = None
    # The bank's own ID for each transaction, which keeps it from being imported twice.
    id: ColumnIndex | None = None
    # The balance after each transaction.
    balance: ColumnIndex | None = None

    @model_validator(mode="after")
    def _one_use_each(self) -> Self:
        used = [index for index in self.model_dump().values() if index is not None]
        if len(used) != len(set(used)):
            raise PydanticCustomError("column_reused", "Each column can only hold one thing.")
        return self


class CsvLayout(BaseModel):
    """How a CSV file is laid out."""

    model_config = STRICT

    delimiter: Delimiter = ","
    # Lines before the column names, or before the first transaction when there are none, like
    # a summary of the account some banks put first.
    skip_rows: Annotated[int, Field(ge=0, le=100)] = 0
    # Whether the first line after those holds the column names.
    header: bool = True
    columns: CsvColumns = Field(default_factory=CsvColumns)
    amounts: AmountColumns = "one"
    # With a direction column, the values in it that mean money came in, in lowercase.
    money_in_values: Annotated[list[DirectionValue], Field(max_length=20)] = []


class ImportOptions(BaseModel):
    """How to read a file. The preview works them out when they're left out."""

    model_config = STRICT

    date_order: DateOrder = "mdy"
    decimal_mark: DecimalMark = "."
    # The file's amounts are positive for money going out, as many card exports have them.
    flip: bool = False
    payee_field: PayeeField = "name"
    # Only for CSV files.
    csv: CsvLayout | None = None


class _Upload(BaseModel):
    model_config = STRICT

    file_name: FileName
    # The file itself, base64-encoded.
    content: Annotated[str, StringConstraints(min_length=1, max_length=MAX_CONTENT)]
    # A saved format to read it with. The saved format whose columns match is used otherwise.
    profile_id: uuid.UUID | None = None
    # Files that hold several accounts' statements are imported one statement at a time.
    statement: Annotated[int, Field(ge=0, lt=100)] = 0


class ImportPreviewRequest(_Upload):
    # How to read it; when left out, the saved format's way, or else the way that fits it best.
    options: ImportOptions | None = None
    # The account the file is going into, to find the transactions it already has. When left
    # out, the likeliest one is chosen, if any.
    account_id: uuid.UUID | None = None


class ProfileSave(BaseModel):
    """Saves how the file was read, for the next file from the same bank."""

    model_config = STRICT

    # A saved format to update. A new one is saved when it's left out.
    id: uuid.UUID | None = None
    name: Name


class ImportCreate(_Upload):
    # As the preview read it.
    options: ImportOptions
    account_id: uuid.UUID
    # The preview's line numbers for the rows to import.
    lines: Annotated[list[Annotated[int, Field(ge=1)]], Field(min_length=1, max_length=MAX_ROWS)]
    balance: BalanceChoice
    save_profile: ProfileSave | None = None


class MatchOut(BaseModel):
    """A transaction already in the account that a row of the file seems to repeat."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: dt.date
    amount: AmountOut
    payee: str
    source: TransactionSource


class PreviewRow(BaseModel):
    # Where it is in the file, counted from 1, as a spreadsheet numbers rows.
    line: int
    date: dt.date | None
    amount: AmountOut | None
    # What the transaction will be called: the file's description, or the name it was given
    # the last time one with that description came in.
    payee: str | None
    # As the file has it.
    description: str | None
    memo: str | None
    category_id: uuid.UUID | None
    status: RowStatus
    # Why it can't be imported.
    problem: str | None
    match: MatchOut | None


class CsvColumnOut(BaseModel):
    index: int
    # The column's name in the file, or "Column 3" when the file doesn't name its columns.
    name: str
    # A few of its values, to tell the columns apart.
    samples: list[str]


class CsvPreview(BaseModel):
    columns: list[CsvColumnOut]
    # The first lines of the file, split into cells, for finding where the transactions start.
    lines: list[list[str]]
    # The fields no column has been chosen for yet, which the file needs to be read.
    missing: list[NeededField]
    # The values of the direction column, for choosing which ones mean money in.
    direction_values: list[str]


class StatementOut(BaseModel):
    """One account's statement, in a file that has several."""

    index: int
    name: str | None
    institution: str | None
    type: AccountType | None
    mask: str | None
    currency: str | None
    count: int


class AccountSuggestion(BaseModel):
    """What the file says about its account, for adding it as a new one."""

    name: str | None
    institution: str | None
    type: AccountType | None
    mask: str | None
    currency: str | None


class BalanceOut(BaseModel):
    current: AmountOut
    # The balance the file ends on, and the day of it, for files that have one.
    closing: AmountOut | None
    closing_date: dt.date | None
    suggested: BalanceChoice


class ImportSummary(BaseModel):
    rows: int
    new: int
    duplicates: int
    possible_duplicates: int
    invalid: int
    # The days the rows that can be imported span.
    first_date: dt.date | None
    last_date: dt.date | None


class ImportPreview(BaseModel):
    format: FileFormat
    file_name: str
    # How the file was read, to change and send back.
    options: ImportOptions
    # The saved format it was read with.
    profile_id: uuid.UUID | None
    csv: CsvPreview | None
    statements: list[StatementOut]
    statement: int
    new_account: AccountSuggestion
    # The account the rows were compared with: the one asked for, or the likeliest one.
    account_id: uuid.UUID | None
    rows: list[PreviewRow]
    summary: ImportSummary
    balance: BalanceOut | None


class FileImportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    profile_id: uuid.UUID | None
    file_name: str
    format: FileFormat
    added: int
    skipped: int
    total: AmountOut
    balance_change: AmountOut
    first_date: dt.date
    last_date: dt.date
    created_at: dt.datetime
    # Who imported it, by name.
    created_by: str | None = None


class ImportProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    headers: list[str]
    options: ImportOptions
    account_id: uuid.UUID | None
    last_used_at: dt.datetime | None
    created_at: dt.datetime


class ImportProfileUpdate(BaseModel):
    model_config = STRICT

    name: Name
