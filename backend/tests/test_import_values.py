import datetime as dt
from decimal import Decimal

import pytest

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
from app.schemas.imports import DateOrder, DecimalMark


@pytest.mark.parametrize(
    ("text", "mark", "expected"),
    [
        ("1,234.56", ".", "1234.56"),
        ("-12.50", ".", "-12.50"),
        ("+12.50", ".", "12.50"),
        ("(12.50)", ".", "-12.50"),
        ("12.50-", ".", "-12.50"),
        ("12.50+", ".", "12.50"),
        ("$12.50", ".", "12.50"),
        ("-$1,000", ".", "-1000.00"),
        ("USD 42.00", ".", "42.00"),
        ("\u221242.00", ".", "-42.00"),
        ("12.50 CR", ".", "12.50"),
        ("12.50 DR", ".", "-12.50"),
        ("12.50cr", ".", "12.50"),
        ("12 Dr.", ".", "-12.00"),
        ("1'234.50", ".", "1234.50"),
        ("1\u00a0234,56 €", ",", "1234.56"),
        ("1.234,56", ",", "1234.56"),
        ("-42,5", ",", "-42.50"),
        # Fractions of a cent round to the nearest cent.
        ("0.005", ".", "0.01"),
        ("12.3400", ".", "12.34"),
    ],
)
def test_amounts_read_however_banks_write_them(text: str, mark: DecimalMark, expected: str) -> None:
    assert parse_amount(text, mark) == Decimal(expected)


@pytest.mark.parametrize(
    "text", ["", "abc", "12.5.6", "--12", "CR", "RECORD", "1,00,0.00.0", "1000000000000.00"]
)
def test_what_isnt_an_amount_reads_as_none(text: str) -> None:
    assert parse_amount(text) is None


@pytest.mark.parametrize(
    ("text", "order", "expected"),
    [
        ("2026-09-26", "mdy", dt.date(2026, 9, 26)),
        ("2026/09/26", "dmy", dt.date(2026, 9, 26)),
        ("09/26/2026", "mdy", dt.date(2026, 9, 26)),
        ("26/09/2026", "dmy", dt.date(2026, 9, 26)),
        ("26.09.2026", "dmy", dt.date(2026, 9, 26)),
        ("9/5/26", "mdy", dt.date(2026, 9, 5)),
        ("9/5/26", "dmy", dt.date(2026, 5, 9)),
        ("26-09-28", "ymd", dt.date(2026, 9, 28)),
        ("9/5/99", "mdy", dt.date(1999, 9, 5)),
        ("1/ 5'26", "mdy", dt.date(2026, 1, 5)),
        ("26 Sep 2026", "mdy", dt.date(2026, 9, 26)),
        ("Sep 26, 2026", "dmy", dt.date(2026, 9, 26)),
        ("September 26 2026", "ymd", dt.date(2026, 9, 26)),
        ("2026-Sept-26", "mdy", dt.date(2026, 9, 26)),
        ("26-sep-26", "mdy", dt.date(2026, 9, 26)),
        ("Sat, 26 Sep 2026", "mdy", dt.date(2026, 9, 26)),
        ("2026-09-26T14:33:00Z", "dmy", dt.date(2026, 9, 26)),
        ("09/26/2026 2:33 PM", "mdy", dt.date(2026, 9, 26)),
        ("20260926", "mdy", dt.date(2026, 9, 26)),
        ("20260926120000.000[-5:EST]", "mdy", dt.date(2026, 9, 26)),
    ],
)
def test_dates_read_in_every_common_style(text: str, order: DateOrder, expected: dt.date) -> None:
    assert parse_date(text, order) == expected


@pytest.mark.parametrize(
    "text",
    ["", "Total", "13/13/2026", "2026-02-30", "09/26", "12345/1/1", "Sep Oct 2026", "20261399"],
)
def test_what_isnt_a_date_reads_as_none(text: str) -> None:
    assert parse_date(text, "mdy") is None


def test_dates_are_plausible_from_1970_to_a_year_ahead() -> None:
    today = dt.date(2026, 9, 28)

    assert plausible(dt.date(1970, 1, 1), today)
    assert plausible(dt.date(2027, 9, 29), today)
    assert not plausible(dt.date(1969, 12, 31), today)
    assert not plausible(dt.date(2027, 9, 30), today)


def test_date_orders_are_the_ones_that_read_the_most_dates() -> None:
    assert date_orders(["09/26/2026", "Total", "01/02/2026"]) == ["mdy"]
    assert date_orders(["26/09/2026", "01/02/2026"]) == ["dmy"]
    assert date_orders(["01/02/2026"]) == ["mdy", "dmy"]
    # Years written first in full read the same every way.
    assert date_orders(["2026-01-02", "20260103", " "]) == ["ymd"]
    assert date_orders(["01/02/03"]) == ["ymd", "mdy", "dmy"]
    assert date_orders(["Total"]) == []
    assert date_orders([]) == []


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("09/26/2026", True),
        ("Saturday, September 26, 2026 2:33 PM", True),
        ("26 Sept 2026 14:33 AEST", True),
        ("Beginning balance as of 09/01/2026", False),
        ("Total", False),
        ("1043", False),
    ],
)
def test_only_dates_count_as_dates_and_not_words_with_dates_in_them(
    text: str, expected: bool
) -> None:
    assert only_date(text) is expected


@pytest.mark.parametrize(
    ("locale", "order"),
    [("en-US", "mdy"), ("es-US", "mdy"), ("en-GB", "dmy"), ("de", "dmy"), ("ja", "ymd")],
)
def test_the_households_region_settles_dates_that_fit_several_orders(
    locale: str, order: DateOrder
) -> None:
    assert locale_date_order(locale) == order


def test_the_decimal_mark_is_whichever_ends_amounts() -> None:
    assert guess_decimal_mark(["12,50", "1.234,56", "3,00-", "7"]) == ","
    assert guess_decimal_mark(["1,234", "12.50", "(4.5)", "8.00 CR"]) == "."
    assert guess_decimal_mark([]) == "."


def test_text_is_tidied_to_single_spaces() -> None:
    assert clean_text("  WHOLEFDS\tMKT \n #10234 ") == "WHOLEFDS MKT #10234"
    assert clean_text(None) == ""
