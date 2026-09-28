import datetime as dt
from decimal import Decimal
from typing import Any

import pytest

from app.imports.csvfile import TOO_MANY_ROWS, CsvFile, closing_balance, missing, signature
from app.imports.files import FileProblem, FileRow
from app.schemas.imports import CsvColumns, CsvLayout, ImportOptions
from tests.imports import CARD_CSV, CHECKING_CSV, HEADERLESS_CSV, SPLIT_CSV

TODAY = dt.date(2026, 9, 28)

# Exports laid out like the ones these banks give, for working out their layouts.
CHASE_CHECKING = """Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,09/25/2026,"WHOLEFDS MKT 10234 AUSTIN TX",-42.50,DEBIT_CARD,1234.56,,
CREDIT,09/24/2026,"NORTHWIND HEALTH PAYROLL PPD ID: 123",1875.00,ACH_CREDIT,1277.06,,
CHECK,09/23/2026,"CHECK 1043",-100.00,CHECK_PAID,-597.94,1043,
"""

AMEX = """Date,Description,Amount,Extended Details,Appears On Your Statement As,Category
09/26/2026,UBER TRIP,23.10,UBER TRIP HELP.UBER.COM,UBER TRIP,Transportation-Taxis & Limousines
09/25/2026,AUTOPAY PAYMENT - THANK YOU,-500.00,,AUTOPAY PAYMENT,
09/24/2026,WHOLE FOODS,86.10,WHOLE FOODS,WHOLE FOODS,Merchandise & Supplies-Groceries
"""

# A summary of the account above the transactions.
BANK_OF_AMERICA = """Description,,Summary Amt.
Beginning balance as of 09/01/2026,,"1,000.00"
Total credits,,"500.00"
Total debits,,"-300.00"
Ending balance as of 09/26/2026,,"1,200.00"

Date,Description,Amount,Running Bal.
09/01/2026,Beginning balance as of 09/01/2026,,"1,000.00"
09/02/2026,"PAYROLL",500.00,"1,500.00"
09/03/2026,"RENT",-300.00,"1,200.00"
"""

# Semicolons, day-first dates and decimal commas.
EUROPEAN = """Buchungstag;Empfänger;Betrag;Saldo
26.09.2026;REWE SAGT DANKE;-12,50;1.234,56
25.09.2026;GEHALT;2.500,00;1.247,06
"""

# Unsigned amounts beside a column saying which way they went.
MINT = """"Date","Description","Original Description","Amount","Transaction Type","Category","Notes"
"9/26/2026","Whole Foods","WHOLEFDS MKT 10234","42.50","debit","Groceries",""
"9/25/2026","Northwind","NORTHWIND PAYROLL","1875.00","credit","Paycheck","Bonus"
"""

REVOLUT = """Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tCurrency\tBalance
CARD_PAYMENT\tCurrent\t2026-09-26 10:00:00\t2026-09-27 08:00:00\tTesco\t-12.40\tGBP\t812.60
TOPUP\tCurrent\t2026-09-25 09:00:00\t2026-09-25 09:00:01\tTop-up\t500.00\tGBP\t825.00
"""

PIPES = """Posted|Payee|Amount (USD)|Ref No
2026-09-26|CORNER MARKET|-12.00|R1
2026-09-25|CITY WATER|-30.00|R2
"""


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            CHECKING_CSV,
            {
                "columns": {"date": 0, "payee": 1, "amount": 2, "balance": 3, "id": 4},
            },
        ),
        (
            CARD_CSV,
            {"flip": True, "columns": {"date": 0, "payee": 1, "amount": 2, "category": 3}},
        ),
        (
            SPLIT_CSV,
            {
                "date_order": "ymd",
                "amounts": "split",
                "columns": {"date": 0, "payee": 3, "category": 4, "money_out": 5, "money_in": 6},
            },
        ),
        (
            HEADERLESS_CSV,
            {"header": False, "columns": {"date": 0, "amount": 1, "payee": 4}},
        ),
        (
            CHASE_CHECKING,
            {"columns": {"date": 1, "payee": 2, "amount": 3, "balance": 5}},
        ),
        (
            AMEX,
            {
                "flip": True,
                "columns": {"date": 0, "payee": 1, "amount": 2, "memo": 3, "category": 5},
            },
        ),
        (
            BANK_OF_AMERICA,
            {"skip_rows": 6, "columns": {"date": 0, "payee": 1, "amount": 2, "balance": 3}},
        ),
        (
            EUROPEAN,
            {
                "delimiter": ";",
                "date_order": "dmy",
                "decimal_mark": ",",
                "columns": {"date": 0, "payee": 1, "amount": 2, "balance": 3},
            },
        ),
        (
            MINT,
            {
                "amounts": "direction",
                "money_in_values": ["credit"],
                "columns": {
                    "date": 0,
                    "payee": 1,
                    "amount": 3,
                    "direction": 4,
                    "category": 5,
                    "memo": 6,
                },
            },
        ),
        (
            REVOLUT,
            {
                "delimiter": "\t",
                "date_order": "ymd",
                "columns": {"date": 2, "payee": 4, "amount": 5, "balance": 7},
            },
        ),
        (
            PIPES,
            {
                "delimiter": "|",
                "date_order": "ymd",
                "columns": {"date": 0, "payee": 1, "amount": 2, "id": 3},
            },
        ),
    ],
)
def test_each_banks_layout_is_worked_out(text: str, expected: dict[str, Any]) -> None:
    options = CsvFile(text).detect("en-US")

    layout: dict[str, Any] = {
        "delimiter": ",",
        "skip_rows": 0,
        "header": True,
        "amounts": "one",
        "money_in_values": [],
        **{key: expected[key] for key in expected if key in CsvLayout.model_fields},
    }
    assert options.csv is not None
    assert options.csv.model_dump() == {
        **layout,
        "columns": CsvColumns.model_validate(expected["columns"]).model_dump(),
    }
    assert (options.date_order, options.decimal_mark, options.flip) == (
        expected.get("date_order", "mdy"),
        expected.get("decimal_mark", "."),
        expected.get("flip", False),
    )


def read(text: str, locale: str = "en-US", **changes: Any) -> list[FileRow]:
    csv_file = CsvFile(text)
    options = csv_file.detect(locale)
    return csv_file.read(options.model_copy(update=changes), TODAY).rows


def test_amounts_come_out_positive_for_money_in_however_the_file_has_them() -> None:
    def amounts(text: str) -> list[str]:
        return [str(row.amount) for row in read(text)]

    assert amounts(CARD_CSV) == ["-486.20", "-23.10", "500.00", "-12.00"]
    assert amounts(SPLIT_CSV) == ["-41.26", "250.00"]
    assert amounts(MINT) == ["-42.50", "1875.00"]
    assert amounts(EUROPEAN) == ["-12.50", "2500.00"]


def test_rows_read_with_their_details() -> None:
    first, *_ = read(CHECKING_CSV)

    assert first == FileRow(
        line=2,
        date=dt.date(2026, 9, 1),
        amount=Decimal("1875.00"),
        description="NORTHWIND HEALTH PAYROLL PPD",
        external_id="T1001",
        balance=Decimal("2875.00"),
    )
    [_, northwind] = read(MINT)
    assert (northwind.memo, northwind.category) == ("Bonus", "Paycheck")
    # The line numbers are the file's, past its summary.
    assert [row.line for row in read(BANK_OF_AMERICA)] == [8, 9, 10]


def test_rows_that_cant_be_read_say_why() -> None:
    text = (
        "Date,Description,Amount\n"
        ",NO DATE,-1.00\n"
        "someday,BAD DATE,-1.00\n"
        "09/26/1969,TOO OLD,-1.00\n"
        "09/30/2027,TOO FAR AHEAD,-1.00\n"
        "09/26/2026,NO AMOUNT,\n"
        "09/26/2026,SHORT\n"
        "09/26/2026,BAD AMOUNT,lots\n"
        "09/26/2026,ZERO,0.00\n"
        "\n"
        f"09/26/2026,{'LONG ' * 60},-1.00\n"
    )

    rows = read(text)

    assert [row.problem for row in rows] == [
        "It has no date.",
        "“someday” isn't a date.",
        "Its date is before 1970 or more than a year from now.",
        "Its date is before 1970 or more than a year from now.",
        "It has no amount.",
        "It has no amount.",
        "“lots” isn't an amount.",
        "Its amount is zero.",
        None,
    ]
    # Blank lines are skipped, and long descriptions are cut to fit.
    assert rows[-1].line == 11
    assert len(rows[-1].description) == 255
    assert rows[0].amount is None


def test_split_amounts_can_have_both_columns_or_a_bad_value() -> None:
    text = "Date,Description,Debit,Credit\n09/26/2026,A,10.00,2.50\n09/26/2026,B,x,\n"

    rows = read(text)

    assert [(row.amount, row.problem) for row in rows] == [
        (Decimal("-7.50"), None),
        (None, "“x” isn't an amount."),
    ]


def test_a_direction_column_is_only_used_for_unsigned_amounts() -> None:
    # Amounts with signs already say which way they went.
    options = CsvFile("Date,Payee,Amount,Type\n09/26/2026,A,-1.00,debit\n").detect("en-US")
    assert options.csv is not None
    assert (options.csv.amounts, options.csv.columns.direction) == ("one", None)
    # So do columns that say other things.
    options = CsvFile("Date,Payee,Amount,Type\n09/26/2026,A,1.00,SALE\n").detect("en-US")
    assert options.csv is not None
    assert (options.csv.amounts, options.csv.columns.direction) == ("one", None)


def test_dates_that_read_several_ways_are_read_the_households_way() -> None:
    text = "Date,Description,Amount\n01/02/2026,A,-1.00\n03/04/2026,B,-1.00\n"

    assert CsvFile(text).detect("en-US").date_order == "mdy"
    assert CsvFile(text).detect("en-AU").date_order == "dmy"
    assert [row.date for row in read(text, "en-AU")] == [dt.date(2026, 2, 1), dt.date(2026, 4, 3)]
    # Dates that only read one way are read that way.
    assert CsvFile(text.replace("03/04", "13/04")).detect("en-US").date_order == "dmy"


def test_files_without_transactions_are_read_by_their_column_names() -> None:
    csv_file = CsvFile("Date,Description,Amount\n")

    options = csv_file.detect("en-US")

    assert options.csv is not None
    assert options.csv.columns == CsvColumns(date=0, payee=1, amount=2)
    assert csv_file.read(options, TODAY).rows == []


def test_files_the_csv_reader_cant_split_cant_be_imported() -> None:
    with pytest.raises(FileProblem) as raised:
        CsvFile(f"{'x' * 140_000},1\n").detect("en-US")

    assert raised.value.message.startswith("Cashcove couldn't read this file.")


def test_files_with_too_many_rows_are_turned_away(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.imports.csvfile.MAX_ROWS", 2)

    with pytest.raises(FileProblem) as raised:
        read(CHECKING_CSV)

    assert raised.value.message == TOO_MANY_ROWS


def test_files_are_only_read_once_the_date_and_amount_have_columns() -> None:
    csv_file = CsvFile(CHECKING_CSV)
    layout = CsvLayout(columns=CsvColumns(payee=1))

    assert missing(layout) == ["date", "amount"]
    assert missing(CsvLayout(amounts="split", columns=CsvColumns(date=0))) == ["amount"]
    assert missing(CsvLayout(amounts="direction", columns=CsvColumns(date=0, amount=2))) == [
        "amount"
    ]
    assert missing(CsvLayout(amounts="split", columns=CsvColumns(date=0, money_in=2))) == []
    assert csv_file.read(ImportOptions(csv=layout), TODAY).rows == []
    assert csv_file.read(ImportOptions(), TODAY).rows == []


def test_the_preview_shows_the_columns_and_the_files_first_lines() -> None:
    csv_file = CsvFile(BANK_OF_AMERICA + f"09/04/2026,{'X' * 70},-1.00,\n" * 20)
    options = csv_file.detect("en-US")
    assert options.csv is not None

    preview = csv_file.preview(options.csv)

    assert [(column.name, column.samples[:2]) for column in preview.columns] == [
        ("Date", ["09/01/2026", "09/02/2026"]),
        ("Description", ["Beginning balance as of 09/01/2026", "PAYROLL"]),
        ("Amount", ["500.00", "-300.00"]),
        ("Running Bal.", ["1,000.00", "1,500.00"]),
    ]
    assert len(preview.lines) == 15
    assert preview.lines[5] == []
    assert preview.lines[6] == ["Date", "Description", "Amount", "Running Bal."]
    assert preview.lines[-1][1] == f"{'X' * 59}…"
    assert preview.missing == []
    assert preview.direction_values == []


def test_files_without_a_payee_column_can_still_be_read() -> None:
    csv_file = CsvFile("09/26/2026,-1.00\n09/25/2026,-2.00\n")
    options = csv_file.detect("en-US")

    assert options.csv is not None
    assert options.csv.columns == CsvColumns(date=0, amount=1)
    assert [row.description for row in csv_file.read(options, TODAY).rows] == ["", ""]


def test_pending_transactions_above_the_rest_stay_under_the_column_names() -> None:
    text = "Date,Description,Amount\nPENDING,COFFEE,-4.50\n09/26/2026,SHOP,-10.00\n"

    options = CsvFile(text).detect("en-US")

    assert options.csv is not None
    assert (options.csv.skip_rows, options.csv.header) == (0, True)
    assert [row.problem for row in read(text)] == ["“PENDING” isn't a date.", None]


@pytest.mark.parametrize("above", ["Account ending 1234", ""])
def test_a_title_or_blank_line_above_the_transactions_isnt_their_column_names(above: str) -> None:
    options = CsvFile(f"{above}\n09/26/2026,SHOP,-1.00\n09/25/2026,CAFE,-2.00\n").detect("en-US")

    assert options.csv is not None
    assert (options.csv.skip_rows, options.csv.header) == (1, False)


def test_files_without_column_names_get_numbered_ones() -> None:
    csv_file = CsvFile(HEADERLESS_CSV)
    options = csv_file.detect("en-US")
    assert options.csv is not None

    preview = csv_file.preview(options.csv)

    assert [column.name for column in preview.columns] == [
        "Column 1",
        "Column 2",
        "Column 3",
        "Column 4",
        "Column 5",
    ]
    assert preview.columns[3].samples == ["1043"]
    assert csv_file.headers(options.csv) == []
    assert csv_file.headers(None) == []
    # A header row past the end of the file.
    assert csv_file.headers(CsvLayout(skip_rows=10)) == []


def test_the_preview_lists_what_the_direction_column_says() -> None:
    csv_file = CsvFile(MINT)
    options = csv_file.detect("en-US")
    assert options.csv is not None

    assert csv_file.preview(options.csv).direction_values == ["credit", "debit"]


def test_saved_layouts_follow_their_column_names_down_the_file() -> None:
    saved = CsvFile(BANK_OF_AMERICA).detect("en-US").csv
    assert saved is not None
    headers = CsvFile(BANK_OF_AMERICA).headers(saved)
    assert headers == ["Date", "Description", "Amount", "Running Bal."]
    # A longer summary this time.
    longer = CsvFile(BANK_OF_AMERICA.replace("\n\n", "\nPending,,0.00\n\n"))

    assert longer.relocate(saved, headers).skip_rows == 7
    # Files without those names keep the saved place.
    assert CsvFile(CHECKING_CSV).relocate(saved, headers).skip_rows == 6


def test_signatures_ignore_case_and_punctuation() -> None:
    assert signature(["Date", "Running Bal."]) == signature(["DATE", "running bal"])
    assert signature(["Date", "Amount"]) != signature(["Amount", "Date"])


def balances(*points: tuple[str, str, str]) -> list[FileRow]:
    return [
        FileRow(
            line=line,
            date=dt.date.fromisoformat(f"2026-09-{day}"),
            amount=Decimal(amount),
            balance=Decimal(balance),
        )
        for line, (day, amount, balance) in enumerate(points, start=1)
    ]


@pytest.mark.parametrize(
    ("points", "expected"),
    [
        # Oldest first, and newest first.
        ([("01", "-5.00", "95.00"), ("02", "-10.00", "85.00")], "85.00"),
        ([("02", "-10.00", "85.00"), ("01", "-5.00", "95.00")], "85.00"),
        # Cards that show what's owed, which goes up as money goes out.
        ([("01", "-100.00", "100.00"), ("02", "-4.50", "104.50")], "-104.50"),
        ([("02", "-4.50", "104.50"), ("01", "-100.00", "100.00")], "-104.50"),
        # Several on the latest day, newest first.
        ([("26", "-1.00", "97.00"), ("26", "-2.00", "98.00"), ("25", "-5.00", "100.00")], "97.00"),
        # Balances that don't add up go by the dates.
        ([("26", "-1.00", "50.00"), ("25", "-2.00", "10.00")], "50.00"),
        ([("25", "-1.00", "50.00"), ("26", "-2.00", "10.00")], "10.00"),
    ],
)
def test_the_closing_balance_is_the_balance_after_the_latest_transaction(
    points: list[tuple[str, str, str]], expected: str
) -> None:
    closing, day = closing_balance(balances(*points))

    assert closing == Decimal(expected)
    assert day == max(row.date for row in balances(*points) if row.date)


def test_files_without_balances_have_no_closing_balance() -> None:
    assert closing_balance([FileRow(line=1, date=TODAY, amount=Decimal("1.00"))]) == (None, None)
    csv_file = CsvFile(CARD_CSV)
    assert csv_file.read(csv_file.detect("en-US"), TODAY).closing is None
