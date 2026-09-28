"""Reading CSV exports, which every bank lays out its own way.

A file's layout (its delimiter, where its transactions start, and which column holds what) is
worked out from its column names and values, then shown for people to check and change. The
layout can be saved, and the next file with the same column names is read the same way.
"""

import csv
import datetime as dt
import hashlib
import io
import itertools
import re
import unicodedata
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal

from app.imports.files import FileProblem, FileRow, Statement
from app.imports.values import (
    clean_text,
    date_orders,
    guess_decimal_mark,
    locale_date_order,
    only_date,
    parse_amount,
    parse_date,
    plausible,
)
from app.schemas.imports import (
    MAX_COLUMNS,
    MAX_ROWS,
    AmountColumns,
    CsvColumnOut,
    CsvColumns,
    CsvLayout,
    CsvPreview,
    DateOrder,
    Delimiter,
    ImportOptions,
    NeededField,
)

DELIMITERS: tuple[Delimiter, ...] = (",", ";", "\t", "|")
# Lines looked at to work out a file's layout.
SAMPLE = 50
# Lines of the file the preview shows, how much of each cell, and how many values of each
# column.
SHOWN_LINES = 15
SHOWN_CELL = 60
SAMPLES = 3
TOO_MANY_ROWS = (
    f"This file has more than {MAX_ROWS:,} transactions. Download a shorter period from your "
    "bank and import it a part at a time."
)
_NOT_WORDS = re.compile(r"[\W_]+")

# The names banks give each column, most likely first, with a few common in Europe after the
# English ones. Names are compared in lowercase without accents, with anything but letters and
# digits as a space ("Running Bal." is "running bal", "Libellé" is "libelle").
COLUMN_NAMES: dict[str, tuple[str, ...]] = {
    "date": (
        "transaction date",
        "trans date",
        "txn date",
        "date",
        "posted date",
        "posting date",
        "post date",
        "date posted",
        "booking date",
        "value date",
        "effective date",
        "datum",
        "buchungstag",
        "buchungsdatum",
        "fecha",
        "data",
    ),
    "direction": (
        "debit credit",
        "credit debit",
        "dr cr",
        "cr dr",
        "debit or credit",
        "credit or debit",
        "transaction type",
        "type",
        "af bij",
    ),
    "money_out": (
        "debit",
        "debits",
        "debit amount",
        "withdrawal",
        "withdrawals",
        "withdrawal amount",
        "money out",
        "paid out",
        "outflow",
        "soll",
    ),
    "money_in": (
        "credit",
        "credits",
        "credit amount",
        "deposit",
        "deposits",
        "deposit amount",
        "money in",
        "paid in",
        "inflow",
        "haben",
    ),
    "amount": (
        "amount",
        "transaction amount",
        "amt",
        "net amount",
        "value",
        "betrag",
        "bedrag",
        "montant",
        "importe",
        "importo",
    ),
    "balance": (
        "balance",
        "running balance",
        "running bal",
        "account balance",
        "ledger balance",
        "available balance",
        "closing balance",
        "saldo",
        "solde",
        "kontostand",
    ),
    "id": (
        "transaction id",
        "id",
        "fitid",
        "reference number",
        "reference no",
        "ref no",
        "transaction reference",
        "confirmation number",
    ),
    "category": ("category", "category name", "categories"),
    "payee": (
        "payee",
        "payee name",
        "merchant",
        "merchant name",
        "description",
        "transaction description",
        "name",
        "details",
        "transaction details",
        "narrative",
        "counterparty",
        "counter party",
        "naam omschrijving",
        "omschrijving",
        "empfanger",
        "auftraggeber empfanger",
        "beguenstigter zahlungspflichtiger",
        "beschreibung",
        "libelle",
        "concepto",
        "descripcion",
        "descrizione",
    ),
    "memo": (
        "memo",
        "notes",
        "note",
        "extended description",
        "extended details",
        "additional information",
        "additional info",
        "remarks",
        "verwendungszweck",
        "mededelingen",
    ),
}
# What a direction column says for money coming in and going out.
MONEY_IN_WORDS = frozenset({"credit", "cr", "c", "deposit", "in", "+", "bij"})
MONEY_OUT_WORDS = frozenset({"debit", "dr", "d", "withdrawal", "out", "-", "af"})


def _name(text: str) -> str:
    """A column name as compared."""
    letters = unicodedata.normalize("NFKD", text.casefold())
    plain = "".join(letter for letter in letters if not unicodedata.combining(letter))
    return " ".join(_NOT_WORDS.sub(" ", plain).split())


def _short(text: str) -> str:
    return text if len(text) <= SHOWN_CELL else f"{text[: SHOWN_CELL - 1]}…"


def _is_amount(text: str) -> bool:
    return not only_date(text) and parse_amount(text) is not None


def _is_number(text: str) -> bool:
    return only_date(text) or parse_amount(text) is not None


def _mostly(values: Sequence[str], test: Callable[[str], bool]) -> bool:
    return bool(values) and sum(test(value) for value in values) >= 0.8 * len(values)


def signature(headers: Sequence[str]) -> str:
    """What recognizes the next file with the same column names."""
    names = "|".join(_name(header) for header in headers)
    return hashlib.sha256(names.encode()).hexdigest()


@dataclass(frozen=True)
class _Start:
    # Where the column names are, or the first transaction when the file has no names.
    row: int
    header: bool


class CsvFile:
    """A CSV file's text, and what's been worked out about it."""

    def __init__(self, text: str) -> None:
        self.text = text
        self._records: dict[Delimiter, list[list[str]]] = {}

    def records(self, delimiter: Delimiter) -> list[list[str]]:
        """Every line of the file, split into cells. Blank lines stay, as empty lists, so each
        one's position is its line in the file."""
        if delimiter not in self._records:
            reader = csv.reader(io.StringIO(self.text), delimiter=delimiter, skipinitialspace=True)
            try:
                self._records[delimiter] = [[cell.strip() for cell in row] for row in reader]
            except csv.Error:
                raise FileProblem(
                    "Cashcove couldn't read this file. Check that it's a CSV file from your bank."
                ) from None
        return self._records[delimiter]

    # ---- Working out the layout --------------------------------------------------------

    def _delimiter(self) -> Delimiter:
        """The delimiter that splits the most lines into the same number of cells."""
        lines = [line for line in self.text.splitlines() if line.strip()][:SAMPLE]
        best: tuple[int, int] = (0, 0)
        chosen: Delimiter = ","
        for delimiter in DELIMITERS:
            try:
                counts = Counter(len(row) for row in csv.reader(lines, delimiter=delimiter))
            except csv.Error:
                continue
            width, lines_that_wide = counts.most_common(1)[0]
            if width > 1 and (lines_that_wide, width) > best:
                best, chosen = (lines_that_wide, width), delimiter
        return chosen

    def _start(self, records: list[list[str]]) -> _Start:
        """Where the transactions start: the first line with a date and an amount in it that's
        as wide as most such lines, or the column names above it.

        The column names are on the nearest line above it with no dates or amounts, past any
        transactions with dates that can't be read, like pending ones. A blank line, or one
        with a single cell, means there are none.
        """
        sample = records[:SAMPLE]
        found = [
            index
            for index, row in enumerate(sample)
            if any(only_date(cell) for cell in row) and any(_is_amount(cell) for cell in row)
        ]
        if not found:
            return _Start(0, True)
        widths = Counter(len(sample[index]) for index in found)
        # A summary above the transactions is narrower than them, so ties go to the wider.
        width = max(widths, key=lambda count: (widths[count], count))
        first = next(index for index in found if len(sample[index]) >= width)
        for index in range(first - 1, -1, -1):
            row = records[index]
            if sum(bool(cell) for cell in row) < 2:
                break
            if not any(only_date(cell) or _is_amount(cell) for cell in row):
                return _Start(index, True)
        return _Start(first, False)

    def detect(self, locale: str) -> ImportOptions:
        """The layout that fits the file best."""
        delimiter = self._delimiter()
        records = self.records(delimiter)
        start = self._start(records)
        names = [_name(cell) for cell in records[start.row]] if start.header else []
        data = self._data(records, start.row + (1 if start.header else 0))
        columns = _Guess(names, data).columns()
        layout = CsvLayout(
            delimiter=delimiter,
            skip_rows=start.row,
            header=start.header,
            columns=CsvColumns.model_validate(columns),
        )
        layout = _amount_style(layout, data)
        values = _Values(data, layout.columns)
        orders = date_orders(values.of("date"))
        preferred = locale_date_order(locale)
        order: DateOrder = preferred if preferred in orders or not orders else orders[0]
        mark = guess_decimal_mark(values.of("amount", "money_in", "money_out", "balance"))
        flip = False
        if layout.amounts == "one":
            signs = [parse_amount(text, mark) for text in values.of("amount")]
            flip = sum(bool(sign and sign > 0) for sign in signs) > len(signs) / 2
        return ImportOptions(date_order=order, decimal_mark=mark, flip=flip, csv=layout)

    @staticmethod
    def _data(records: list[list[str]], start: int) -> list[list[str]]:
        return [row for row in records[start : start + SAMPLE] if any(row)]

    def headers(self, layout: CsvLayout | None) -> list[str]:
        """The column names, as the file has them, or none when it doesn't name its columns."""
        if layout is None or not layout.header:
            return []
        records = self.records(layout.delimiter)
        if layout.skip_rows >= len(records):
            return []
        return records[layout.skip_rows][:MAX_COLUMNS]

    def relocate(self, layout: CsvLayout, headers: Sequence[str]) -> CsvLayout:
        """A saved layout moved to where this file's column names are, for banks that put a
        summary of varying length above them."""
        wanted = [_name(header) for header in headers]
        records = self.records(layout.delimiter)
        row = next(
            (
                index
                for index, record in enumerate(records[:SAMPLE])
                if [_name(cell) for cell in record[:MAX_COLUMNS]] == wanted
            ),
            layout.skip_rows,
        )
        return layout.model_copy(update={"skip_rows": row})

    # ---- Reading it ----------------------------------------------------------------------

    def preview(self, layout: CsvLayout) -> CsvPreview:
        records = self.records(layout.delimiter)
        data = self._data(records, first_row(layout))
        headers = self.headers(layout)
        width = min(max((len(row) for row in [headers, *data]), default=0), MAX_COLUMNS)
        columns = [
            CsvColumnOut(
                index=index,
                name=(headers[index] if index < len(headers) else "") or f"Column {index + 1}",
                samples=[_short(row[index]) for row in data if index < len(row) and row[index]][
                    :SAMPLES
                ],
            )
            for index in range(width)
        ]
        return CsvPreview(
            columns=columns,
            lines=[[_short(cell) for cell in row[:MAX_COLUMNS]] for row in records[:SHOWN_LINES]],
            missing=missing(layout),
            direction_values=_direction_values(layout, data),
        )

    def read(self, options: ImportOptions, today: dt.date) -> Statement:
        """The file's transactions. None until the layout says where the date and amount
        are."""
        layout = options.csv or CsvLayout()
        if missing(layout):
            return Statement()
        records = self.records(layout.delimiter)
        reader = _RowReader(options, layout, today)
        rows: list[FileRow] = []
        for index in range(first_row(layout), len(records)):
            if not any(records[index]):
                continue
            if len(rows) == MAX_ROWS:
                raise FileProblem(TOO_MANY_ROWS)
            rows.append(reader.row(index + 1, records[index]))
        closing, closing_date = closing_balance(rows)
        return Statement(rows=rows, closing=closing, closing_date=closing_date)


def first_row(layout: CsvLayout) -> int:
    """Where the transactions start, counted from 0."""
    return layout.skip_rows + (1 if layout.header else 0)


def _spellings(values: Iterable[str]) -> dict[str, str]:
    """Each value as the file first writes it, by the value as compared."""
    spellings: dict[str, str] = {}
    for value in values:
        spellings.setdefault(value.casefold(), value)
    return spellings


def _direction_values(layout: CsvLayout, data: list[list[str]]) -> list[str]:
    """What the direction column says, as the file writes it, for choosing which values mean
    money in."""
    index = layout.columns.direction
    if index is None or layout.amounts != "direction":
        return []
    spellings = _spellings(row[index] for row in data if index < len(row) and row[index])
    return sorted(spellings.values(), key=str.casefold)[:20]


def missing(layout: CsvLayout) -> list[NeededField]:
    """The fields no column has been chosen for yet."""
    columns = layout.columns
    needs: list[NeededField] = []
    if columns.date is None:
        needs.append("date")
    if layout.amounts == "split":
        no_amount = columns.money_in is None and columns.money_out is None
    else:
        no_amount = columns.amount is None or (
            layout.amounts == "direction" and columns.direction is None
        )
    if no_amount:
        needs.append("amount")
    return needs


class _Values:
    """The values in the chosen columns of a file's first lines."""

    def __init__(self, data: list[list[str]], columns: CsvColumns) -> None:
        self._data = data
        self._columns = columns.model_dump()

    def of(self, *fields: str) -> list[str]:
        values: list[str] = []
        for name in fields:
            index = self._columns[name]
            if index is not None:
                values += [row[index] for row in self._data if index < len(row) and row[index]]
        return values


class _Guess:
    """Which column is which, from the columns' names, then from what's in them."""

    def __init__(self, names: list[str], data: list[list[str]]) -> None:
        self.names = names
        self.data = data
        self.width = max((len(row) for row in [names, *data]), default=0)
        self.found: dict[str, int] = {}

    def values(self, index: int) -> list[str]:
        return [row[index] for row in self.data if index < len(row) and row[index]]

    def _free(self) -> list[int]:
        taken = set(self.found.values())
        return [index for index in range(min(self.width, MAX_COLUMNS)) if index not in taken]

    def _by_name(self, field: str, matches: Callable[[str, str], bool]) -> None:
        known = COLUMN_NAMES[field]
        best: tuple[int, int] | None = None
        for index in self._free():
            name = self.names[index] if index < len(self.names) else ""
            rank = next((rank for rank, word in enumerate(known) if matches(name, word)), None)
            if rank is not None and (best is None or rank < best[0]):
                best = (rank, index)
        if best is not None:
            self.found[field] = best[1]

    def _first(self, test: Callable[[list[str]], bool]) -> int | None:
        return next((index for index in self._free() if test(self.values(index))), None)

    def _by_content(self) -> None:
        if "date" not in self.found:
            date = self._first(lambda values: _mostly(values, only_date))
            if date is not None:
                self.found["date"] = date
        if not {"amount", "money_in", "money_out"} & self.found.keys():
            # Amounts have cents; check numbers and IDs don't.
            amount = self._first(
                lambda values: (
                    _mostly(values, _is_amount)
                    and any("." in value or "," in value for value in values)
                )
            )
            if amount is not None:
                self.found["amount"] = amount
        if "payee" not in self.found:
            # The longest text that isn't dates or amounts.
            words = [
                index
                for index in self._free()
                if self.values(index) and not _mostly(self.values(index), _is_number)
            ]
            if words:
                self.found["payee"] = max(words, key=lambda index: len("".join(self.values(index))))

    def columns(self) -> dict[str, int]:
        for field in COLUMN_NAMES:
            self._by_name(field, lambda name, word: name == word)
        for field in COLUMN_NAMES:
            if field not in self.found:
                # "Amount (USD)" is an amount column.
                self._by_name(field, lambda name, word: name.startswith(f"{word} "))
        self._by_content()
        return self.found


def _amount_style(layout: CsvLayout, data: list[list[str]]) -> CsvLayout:
    """How the file gives amounts, from the columns found: separate money in and out
    columns, an amount with a column saying which way it went, or one signed amount."""
    columns = layout.columns
    style: AmountColumns = "one"
    money_in_values: list[str] = []
    if columns.money_in is not None or columns.money_out is not None:
        style = "split"
        columns = columns.model_copy(update={"amount": None, "direction": None})
    elif columns.direction is not None and columns.amount is not None:
        values = _Values(data, columns)
        spellings = _spellings(values.of("direction"))
        words = set(spellings)
        signed = any(
            (amount := parse_amount(value)) is not None and amount < 0
            for value in values.of("amount")
        )
        if words and words <= MONEY_IN_WORDS | MONEY_OUT_WORDS and not signed:
            style = "direction"
            money_in_values = sorted(
                (spellings[word] for word in words & MONEY_IN_WORDS), key=str.casefold
            )
    if style == "one":
        columns = columns.model_copy(update={"direction": None})
    return layout.model_copy(
        update={"columns": columns, "amounts": style, "money_in_values": money_in_values}
    )


class _RowReader:
    """Turns a line of the file into a transaction, as the layout says."""

    def __init__(self, options: ImportOptions, layout: CsvLayout, today: dt.date) -> None:
        self.options = options
        self.layout = layout
        self.columns = layout.columns
        self.today = today
        self.money_in = {value.casefold() for value in layout.money_in_values}

    @staticmethod
    def _cell(record: list[str], index: int | None) -> str:
        return record[index] if index is not None and index < len(record) else ""

    def row(self, line: int, record: list[str]) -> FileRow:
        columns = self.columns
        cell = self._cell
        balance = cell(record, columns.balance)
        row = FileRow(
            line=line,
            description=clean_text(cell(record, columns.payee))[:255],
            memo=clean_text(cell(record, columns.memo))[:1000] or None,
            category=clean_text(cell(record, columns.category))[:60] or None,
            external_id=cell(record, columns.id)[:255] or None,
            balance=parse_amount(balance, self.options.decimal_mark) if balance else None,
        )
        written = cell(record, columns.date)
        row.date = parse_date(written, self.options.date_order) if written else None
        amount, problem = self._amount(record)
        if row.date is None:
            row.problem = f"“{_short(written)}” isn't a date." if written else "It has no date."
        elif not plausible(row.date, self.today):
            row.problem = "Its date is before 1970 or more than a year from now."
        elif problem:
            row.problem = problem
        else:
            row.amount = amount
        return row

    def _amount(self, record: list[str]) -> tuple[Decimal | None, str | None]:
        columns = self.columns
        if self.layout.amounts == "split":
            written = [
                self._cell(record, columns.money_in),
                self._cell(record, columns.money_out),
            ]
        else:
            written = [self._cell(record, columns.amount)]
        if not any(written):
            return None, "It has no amount."
        values: list[Decimal] = []
        for text in written:
            value = parse_amount(text, self.options.decimal_mark) if text else Decimal(0)
            if value is None:
                return None, f"“{_short(text)}” isn't an amount."
            values.append(value)
        if self.layout.amounts == "split":
            amount = abs(values[0]) - abs(values[1])
        elif self.layout.amounts == "direction":
            into = self._cell(record, columns.direction).casefold() in self.money_in
            amount = abs(values[0]) if into else -abs(values[0])
        else:
            amount = -values[0] if self.options.flip else values[0]
        if amount == 0:
            return None, "Its amount is zero."
        return amount, None


@dataclass(frozen=True)
class _Point:
    date: dt.date
    amount: Decimal
    balance: Decimal


def closing_balance(rows: list[FileRow]) -> tuple[Decimal | None, dt.date | None]:
    """The balance after the file's latest transaction, from its balance column.

    Files list transactions newest first or oldest first, and some give balances as what's
    owed, which go up as money goes out. Both show in how the balance moves from one line to
    the next.
    """
    points = [
        _Point(row.date, row.amount, row.balance)
        for row in rows
        if row.date and row.amount is not None and row.balance is not None
    ]
    if not points:
        return None, None
    as_is = owed = newest_first = 0
    for before, after in itertools.pairwise(points):
        change = after.balance - before.balance
        # Oldest first, each line's balance has its own transaction added; newest first, the
        # line before's balance has that line's transaction added.
        as_is += change in {after.amount, -before.amount}
        owed += change in {-after.amount, before.amount}
        newest_first += (change in {before.amount, -before.amount}) - (
            change in {after.amount, -after.amount}
        )
    if newest_first == 0:
        newest_first = 1 if points[0].date > points[-1].date else -1
    latest = max(point.date for point in points)
    last = [point for point in points if point.date == latest]
    point = last[0] if newest_first > 0 else last[-1]
    return (-point.balance if owed > as_is else point.balance), latest
