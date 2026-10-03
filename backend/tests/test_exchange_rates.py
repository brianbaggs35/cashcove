import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.finance.exchange_rates import (
    ExchangeRateClient,
    ExchangeRateError,
    RateBook,
    exchange_rate_transport,
)
from app.models import ExchangeRate, ExchangeRateSpan
from tests.rates import YESTERDAY, FakeRates


def day(month: int, number: int, year: int = 2026) -> dt.date:
    return dt.date(year, month, number)


def client_for(settings: Settings, rates: FakeRates) -> ExchangeRateClient:
    return ExchangeRateClient(settings, transport=rates.transport)


def book_for(
    session: Session, settings: Settings, rates: FakeRates, *, online: bool = True
) -> RateBook:
    """A fresh book, as each request gets, on rates from the fake server unless `online` is off."""
    return RateBook(session, client_for(settings, rates) if online else None, "USD")


def stored(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(ExchangeRate)) or 0


# ---- The client ----------------------------------------------------------------------------


def test_the_client_asks_for_a_range_of_days_and_reads_rates_exactly(
    settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", {day(9, 1): "1.1", day(9, 2): "1.123456789012", day(9, 4): "0.000061"})

    with client_for(settings, rates) as client:
        found = client.rates("EUR", "USD", day(9, 1), day(9, 5))

    assert found == {
        day(9, 1): Decimal("1.1"),
        day(9, 2): Decimal("1.123456789012"),
        day(9, 4): Decimal("0.000061"),
    }
    request = rates.requests[0]
    assert request.url.host == "api.frankfurter.dev"
    assert request.url.path == "/v2/rates"
    assert dict(request.url.params) == {
        "from": "2026-09-01",
        "to": "2026-09-05",
        "base": "EUR",
        "quotes": "USD",
    }
    assert request.headers["User-Agent"].startswith("Cashcove/")


def test_the_client_uses_the_configured_server(settings: Settings, rates: FakeRates) -> None:
    rates.rate("EUR", "1.1")
    settings.exchange_rate_url = "https://rates.example.com"

    client_for(settings, rates).rates("EUR", "USD", day(9, 1), day(9, 1))

    assert rates.requests[0].url.host == "rates.example.com"


@pytest.mark.parametrize(
    ("failure", "unreachable"),
    [
        ("unreachable", True),
        (429, True),
        (503, True),
        (422, False),
        (404, False),
        ("not json", False),
        ('[{"date": "yesterday", "rate": 1.1}]', False),
        ('{"rate": 1.1}', False),
    ],
)
def test_the_client_says_why_rates_couldnt_be_fetched(
    settings: Settings, rates: FakeRates, failure: str | int, unreachable: bool
) -> None:
    if failure == "unreachable":
        rates.unreachable = True
    elif isinstance(failure, int):
        rates.status = failure
    else:
        rates.body = failure

    client = client_for(settings, rates)
    first, last = day(9, 1), day(9, 5)

    with pytest.raises(ExchangeRateError, match="No EUR to USD rates") as caught:
        client.rates("EUR", "USD", first, last)

    assert caught.value.unreachable is unreachable


def test_requests_go_over_the_internet_unless_a_stand_in_is_plugged_in() -> None:
    assert exchange_rate_transport() is None


# ---- Converting ----------------------------------------------------------------------------


def test_amounts_convert_at_their_days_rate_to_the_nearest_cent(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", {day(9, 1): "1.5", day(9, 2): "1.25"})
    book = book_for(session, settings, rates)
    book.prepare({"EUR": (day(9, 1), day(9, 2))})

    assert book.convert("EUR", day(9, 1), Decimal("0.05")) == Decimal("0.08")
    assert book.convert("EUR", day(9, 2), Decimal("0.05")) == Decimal("0.06")
    assert book.convert("EUR", day(9, 2), Decimal("100.00")) == Decimal("125.00")
    assert book.unavailable == set()


def test_a_day_without_a_rate_uses_the_one_before_it(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", {day(9, 1): "1.10", day(9, 4): "1.20"})
    book = book_for(session, settings, rates)
    book.prepare({"EUR": (day(9, 1), day(9, 5))})

    assert book.convert("EUR", day(9, 3), Decimal("10.00")) == Decimal("11.00")
    assert book.convert("EUR", day(9, 5), Decimal("10.00")) == Decimal("12.00")
    assert book.unavailable == set()


def test_a_day_before_any_rate_cant_be_converted(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", {day(9, 3): "1.10"})
    book = book_for(session, settings, rates)
    book.prepare({"EUR": (day(9, 1), day(9, 5))})

    assert book.convert("EUR", day(9, 2), Decimal("10.00")) is None
    assert book.unavailable == {"EUR"}


def test_a_currency_that_wasnt_prepared_cant_be_converted(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    book = book_for(session, settings, rates)

    assert book.convert("EUR", day(9, 1), Decimal("10.00")) is None
    assert book.unavailable == {"EUR"}
    assert rates.requests == []


def test_today_and_later_count_at_yesterdays_rate(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    today, tomorrow = YESTERDAY + dt.timedelta(days=1), YESTERDAY + dt.timedelta(days=2)
    rates.rate("EUR", {YESTERDAY: "1.10", today: "9.99", tomorrow: "9.99"})
    book = book_for(session, settings, rates)
    book.prepare({"EUR": (YESTERDAY, tomorrow)})

    assert book.convert("EUR", today, Decimal("10.00")) == Decimal("11.00")
    assert book.convert("EUR", tomorrow, Decimal("10.00")) == Decimal("11.00")
    assert rates.days_asked() == [("2026-10-02", "2026-10-02")]


def test_only_days_that_are_over_are_asked_for_when_everything_is_in_the_future(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    book = book_for(session, settings, rates)
    book.prepare({"EUR": (day(11, 1), day(11, 30))})

    assert book.convert("EUR", day(11, 15), Decimal("10.00")) == Decimal("11.00")
    assert rates.days_asked() == [("2026-10-02", "2026-10-02")]


# ---- Keeping rates -------------------------------------------------------------------------


def test_each_days_rate_is_fetched_once_and_kept(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    book_for(session, settings, rates).prepare({"EUR": (day(9, 1), day(9, 30))})
    later = book_for(session, settings, rates)

    later.prepare({"EUR": (day(9, 10), day(9, 20))})
    later.prepare({"EUR": (day(9, 1), day(9, 30))})

    assert rates.days_asked() == [("2026-09-01", "2026-09-30")]
    assert later.convert("EUR", day(9, 15), Decimal("10.00")) == Decimal("11.00")
    assert stored(session) == 30
    span = session.get(ExchangeRateSpan, ("EUR", "USD"))
    assert span is not None
    assert (span.first_day, span.last_day) == (day(9, 1), day(9, 30))


def test_the_span_grows_both_ways_without_fetching_days_twice(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    book_for(session, settings, rates).prepare({"EUR": (day(9, 10), day(9, 20))})

    # Earlier days, and later ones, with a gap before the span that's filled in too.
    book_for(session, settings, rates).prepare({"EUR": (day(9, 5), day(9, 25))})
    book_for(session, settings, rates).prepare({"EUR": (day(8, 1), day(8, 2))})
    book_for(session, settings, rates).prepare({"EUR": (day(9, 28), day(9, 29))})

    assert rates.days_asked() == [
        ("2026-09-10", "2026-09-20"),
        ("2026-09-05", "2026-09-09"),
        ("2026-09-21", "2026-09-25"),
        ("2026-08-01", "2026-09-04"),
        ("2026-09-26", "2026-09-29"),
    ]
    span = session.get(ExchangeRateSpan, ("EUR", "USD"))
    assert span is not None
    assert (span.first_day, span.last_day) == (day(8, 1), day(9, 29))
    assert stored(session) == 31 + 29


def test_a_long_stretch_is_fetched_a_year_at_a_time(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    book_for(session, settings, rates).prepare({"EUR": (day(1, 1, 2024), day(9, 15))})

    assert rates.days_asked() == [
        ("2024-01-01", "2024-12-31"),
        ("2025-01-01", "2026-01-01"),
        ("2026-01-02", "2026-09-15"),
    ]


def test_a_rate_that_was_already_stored_isnt_replaced(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    session.add(ExchangeRate(base="EUR", quote="USD", day=day(9, 1), rate=Decimal("1.05")))
    session.commit()
    book = book_for(session, settings, rates)

    book.prepare({"EUR": (day(9, 1), day(9, 2))})

    assert book.convert("EUR", day(9, 1), Decimal("100.00")) == Decimal("105.00")
    assert book.convert("EUR", day(9, 2), Decimal("100.00")) == Decimal("110.00")


def test_each_currency_pair_has_its_own_rates(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    rates.rate("GBP", "1.30")
    book = book_for(session, settings, rates)
    book.prepare({"EUR": (day(9, 1), day(9, 2)), "GBP": (day(9, 1), day(9, 1))})

    assert book.convert("EUR", day(9, 1), Decimal("10.00")) == Decimal("11.00")
    assert book.convert("GBP", day(9, 1), Decimal("10.00")) == Decimal("13.00")
    assert stored(session) == 3


def test_days_the_server_has_no_rate_for_arent_asked_for_again(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", {})
    first = book_for(session, settings, rates)
    first.prepare({"EUR": (day(9, 1), day(9, 5))})
    again = book_for(session, settings, rates)
    again.prepare({"EUR": (day(9, 2), day(9, 4))})

    assert first.convert("EUR", day(9, 2), Decimal("10.00")) is None
    assert again.convert("EUR", day(9, 2), Decimal("10.00")) is None
    assert len(rates.requests) == 1


# ---- When rates can't be fetched ----------------------------------------------------------


@pytest.mark.parametrize("failure", ["unreachable", 429, 502])
def test_once_the_server_cant_be_reached_nothing_else_is_asked_of_it(
    session: Session, settings: Settings, rates: FakeRates, failure: str | int
) -> None:
    rates.rate("EUR", "1.10")
    rates.rate("GBP", "1.30")
    if failure == "unreachable":
        rates.unreachable = True
    else:
        assert isinstance(failure, int)
        rates.status = failure
    book = book_for(session, settings, rates)

    book.prepare({"EUR": (day(9, 1), day(9, 2)), "GBP": (day(9, 1), day(9, 2))})
    book.prepare({"EUR": (day(8, 1), day(8, 2))})

    assert book.unavailable == {"EUR", "GBP"}
    assert len(rates.requests) == 1
    assert stored(session) == 0
    assert session.get(ExchangeRateSpan, ("EUR", "USD")) is None


def test_a_currency_the_server_turns_down_doesnt_stop_the_others(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("GBP", "1.30")
    book = book_for(session, settings, rates)

    book.prepare({"XYZ": (day(9, 1), day(9, 2)), "GBP": (day(9, 1), day(9, 2))})

    assert book.unavailable == {"XYZ"}
    assert book.convert("GBP", day(9, 1), Decimal("10.00")) == Decimal("13.00")
    assert len(rates.requests) == 2


def test_a_currency_that_failed_isnt_tried_again_in_the_same_request(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    book = book_for(session, settings, rates)

    book.prepare({"XYZ": (day(9, 1), day(9, 2))})
    book.prepare({"XYZ": (day(9, 1), day(9, 2))})

    assert len(rates.requests) == 1


def test_rates_that_were_kept_still_work_when_the_server_is_down(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    rates.rate("EUR", "1.10")
    book_for(session, settings, rates).prepare({"EUR": (day(9, 1), day(9, 30))})
    rates.unreachable = True
    requests = len(rates.requests)

    covered = book_for(session, settings, rates)
    covered.prepare({"EUR": (day(9, 10), day(9, 20))})
    offline = book_for(session, settings, rates, online=False)
    offline.prepare({"EUR": (day(9, 10), day(9, 20))})
    beyond = book_for(session, settings, rates)
    beyond.prepare({"EUR": (day(9, 10), day(10, 1))})

    assert covered.convert("EUR", day(9, 15), Decimal("10.00")) == Decimal("11.00")
    assert offline.convert("EUR", day(9, 15), Decimal("10.00")) == Decimal("11.00")
    assert (covered.unavailable, offline.unavailable) == (set(), set())
    # Days that were never fetched can't be converted, rather than guessed at.
    assert beyond.unavailable == {"EUR"}
    assert len(rates.requests) == requests + 1


def test_without_a_server_only_kept_rates_are_available(
    session: Session, settings: Settings, rates: FakeRates
) -> None:
    book = book_for(session, settings, rates, online=False)

    book.prepare({"EUR": (day(9, 1), day(9, 2))})

    assert book.unavailable == {"EUR"}
    assert rates.requests == []
