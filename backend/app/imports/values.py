"""Reading dates and amounts of money written the many ways banks write them."""

import datetime as dt
import re
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from app.models.base import CENT
from app.schemas.fields import MAX_AMOUNT
from app.schemas.imports import DateOrder, DecimalMark

# The parts of a date: runs of digits, and words, which may name a month. Everything else
# (slashes, dots, dashes, commas, spaces) separates them.
_DATE_PARTS = re.compile(r"[A-Za-z]+|\d+")
# What's left of an amount once its currency, sign and grouping are gone.
_DIGITS = re.compile(r"\d+(?:\.\d+)?")
# Grouping marks between thousands: spaces of any width, and the apostrophes Swiss banks use.
_GROUPING = str.maketrans("", "", " \u00a0\u202f\u2009'\u2019")
_CURRENCY = re.compile(r"[$€£¥₹₩₽¤]|\b[A-Z]{3}\b")

_MONTHS = {
    name: number
    for number, names in enumerate(
        (
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ),
        start=1,
    )
    for name in names
}

_WEEKDAYS = frozenset(
    {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
)

# Earliest and latest days a transaction can plausibly have, as for one added by hand.
EARLIEST = dt.date(1970, 1, 1)
LATEST_AHEAD = dt.timedelta(days=366)

# Regions and languages that write a date's numbers month first, or year first. Everywhere
# else writes the day first.
_MONTH_FIRST_REGIONS = frozenset({"US", "PH", "FM", "MH", "PW", "AS", "GU", "PR", "UM", "VI"})
_YEAR_FIRST_LANGUAGES = frozenset({"ja", "zh", "ko", "hu", "lt", "mn"})


def clean_text(value: str | None) -> str:
    """Text with its runs of spaces, tabs and line breaks made single spaces."""
    return " ".join((value or "").split())


def _year(text: str) -> int:
    year = int(text)
    if len(text) > 2:
        return year
    # Two-digit years: 00 to 69 are this century, 70 to 99 the last, as strptime reads them.
    return year + (2000 if year < 70 else 1900)


def _date(year: int, month: int, day: int) -> dt.date | None:
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


def _named_month(parts: list[str]) -> dt.date | None:
    """Dates that spell out the month: "26 Sep 2026", "Sep 26, 2026" or "2026-Sep-26"."""
    words = [index for index, part in enumerate(parts) if not part.isdigit()]
    if len(words) != 1:
        return None
    month = _MONTHS[parts[words[0]].lower()]
    first, second = (part for part in parts if part.isdigit())
    # The year comes first only when it's written in full; otherwise the day does.
    year, day = (first, second) if words[0] == 1 and len(first) == 4 else (second, first)
    return _date(_year(year), month, int(day))


def parse_date(text: str, order: DateOrder) -> dt.date | None:
    """The day a date means, or None if it isn't one. Anything after it, like a time, is
    ignored. Dates with a four-digit year first are always read year first."""
    parts: list[str] = []
    for part in _DATE_PARTS.findall(text):
        # Words that aren't months, like a weekday or "T" before a time, are skipped.
        if part.isdigit() or part.lower() in _MONTHS:
            parts.append(part)
        if len(parts) == 3:
            break
    if parts and len(parts[0]) >= 8 and parts[0].isdigit():
        # 20260926, as some CSV exports write them, maybe with the time after it, as OFX
        # files do (20260926120000).
        compact = parts[0][:8]
        return _date(int(compact[:4]), int(compact[4:6]), int(compact[6:]))
    if len(parts) != 3 or any(part.isdigit() and len(part) > 4 for part in parts):
        return None
    if not all(part.isdigit() for part in parts):
        return _named_month(parts)
    first, second, third = parts
    if len(first) == 4 or order == "ymd":
        return _date(_year(first), int(second), int(third))
    if order == "mdy":
        return _date(_year(third), int(first), int(second))
    return _date(_year(third), int(second), int(first))


def only_date(text: str) -> bool:
    """Whether text is a date and nothing more, maybe with its weekday and time, rather than
    words with a date in them, like "Balance as of 09/01/2026"."""
    words = [part.lower() for part in _DATE_PARTS.findall(text) if not part.isdigit()]
    if any(len(word) > 4 and word not in _MONTHS and word not in _WEEKDAYS for word in words):
        return False
    return parse_date(text, "mdy") is not None or parse_date(text, "dmy") is not None


def plausible(day: dt.date, today: dt.date) -> bool:
    return EARLIEST <= day <= today + LATEST_AHEAD


def _year_first(text: str) -> bool:
    parts = _DATE_PARTS.findall(text)
    return bool(parts) and parts[0].isdigit() and len(parts[0]) >= 4


def date_orders(values: Iterable[str]) -> list[DateOrder]:
    """The orders that read the most of these dates. A footer like "Total" doesn't count
    against any of them. Dates written with the year first in full read the same in every
    order, so they're year first."""
    texts = [value for value in values if value.strip()]
    orders: list[DateOrder] = ["ymd", "mdy", "dmy"]
    read = {order: sum(parse_date(text, order) is not None for text in texts) for order in orders}
    most = max(read.values())
    found: list[DateOrder] = [order for order in orders if most and read[order] == most]
    dates = [text for text in texts if parse_date(text, "ymd") is not None]
    if len(found) == len(orders) and all(_year_first(text) for text in dates):
        found = ["ymd"]
    return found


def locale_date_order(locale: str) -> DateOrder:
    """How the household's own region writes dates, to settle dates that fit several orders."""
    language, _, region = locale.partition("-")
    if region in _MONTH_FIRST_REGIONS:
        return "mdy"
    return "ymd" if language in _YEAR_FIRST_LANGUAGES else "dmy"


def _direction(value: str) -> tuple[str, bool | None]:
    """An amount without the "CR" or "DR" some statements write after it, and whether it said
    debit (money out)."""
    trimmed = value.rstrip(". ")
    suffix = trimmed[-2:].upper()
    if suffix not in {"CR", "DR"} or trimmed[-3:-2].isalpha():
        return value, None
    return trimmed[:-2], suffix == "DR"


def parse_amount(text: str, decimal_mark: DecimalMark = ".") -> Decimal | None:
    """An amount of money, rounded to the cent, or None if it isn't one.

    Reads "1,234.56", "-12.50", "(12.50)" and "12.50-" (both negative), "$12.50", "12.50 CR"
    and "12.50 DR", and "1.234,56" with a decimal comma.
    """
    value, debit = _direction(text.strip().replace("\u2212", "-"))
    negative = bool(debit)
    value = _CURRENCY.sub("", value).translate(_GROUPING)
    if value.startswith("(") and value.endswith(")"):
        negative, value = True, value[1:-1]
    if value.startswith(("-", "+")):
        negative, value = negative or value[0] == "-", value[1:]
    elif value.endswith(("-", "+")):
        negative, value = negative or value[-1] == "-", value[:-1]
    grouping = "," if decimal_mark == "." else "."
    value = value.replace(grouping, "").replace(",", ".")
    if not _DIGITS.fullmatch(value):
        return None
    amount = Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)
    if amount > MAX_AMOUNT:
        return None
    return -amount if negative else amount


def guess_decimal_mark(values: Iterable[str]) -> DecimalMark:
    """Whether amounts use a decimal point or a decimal comma, by which of the two comes last
    with one or two digits after it."""
    votes = {".": 0, ",": 0}
    for value in values:
        digits = value.strip().rstrip("-+) CRDcrd")
        last = max(digits.rfind("."), digits.rfind(","))
        if last == -1:
            continue
        after = digits[last + 1 :]
        if 1 <= len(after) <= 2 and after.isdigit():
            votes[digits[last]] += 1
    return "," if votes[","] > votes["."] else "."
