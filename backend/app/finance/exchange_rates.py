"""Exchange rates, so accounts in other currencies count in the household's.

Rates come from a Frankfurter server (https://frankfurter.dev; the public one is
api.frankfurter.dev), which has a rate for every calendar day, and are kept in the database so
each day's is fetched once. A transaction counts at its own day's rate. Today's rate isn't
final until the day is over, so today's transactions (and any later) count at yesterday's, and
move to their own day's rate tomorrow. Nothing converted is stored, so that happens by itself.
"""

import bisect
import datetime as dt
from collections.abc import Iterator, Mapping
from decimal import ROUND_HALF_UP, Decimal
from types import TracebackType
from typing import Annotated, Self

import httpx2 as httpx
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth.deps import AppSettings
from app.config import Settings
from app.models import ExchangeRate, ExchangeRateSpan
from app.models.base import CENT, utcnow

# Quick to answer, so a server that can't be reached shouldn't hold a page up for long.
TIMEOUT = httpx.Timeout(10.0, connect=3.0)
# The most days asked for at once; a year of rates comes back in about a second.
CHUNK_DAYS = 366
ONE_DAY = dt.timedelta(days=1)


class ExchangeRateError(Exception):
    """Rates couldn't be fetched. `unreachable` says the server can't be reached or is too busy
    to answer, so there's no point asking it for anything else just now."""

    def __init__(self, message: str, *, unreachable: bool = False) -> None:
        super().__init__(message)
        self.unreachable = unreachable


class _Rate(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    date: dt.date
    rate: Decimal


_RATES = TypeAdapter(list[_Rate])


class ExchangeRateClient:
    """One connection to a Frankfurter server, reused until it's closed."""

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None):
        self._http = httpx.Client(
            base_url=settings.exchange_rate_url,
            timeout=TIMEOUT,
            transport=transport,
            headers={"User-Agent": f"Cashcove/{settings.version}"},
        )

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def rates(self, base: str, quote: str, first: dt.date, last: dt.date) -> dict[dt.date, Decimal]:
        """What one `base` was worth in `quote` on each day from `first` to `last`. Days the
        server has no rate for are left out."""
        problem = f"No {base} to {quote} rates from {first} to {last}"
        try:
            response = self._http.get(
                "/v2/rates",
                params={
                    "from": first.isoformat(),
                    "to": last.isoformat(),
                    "base": base,
                    "quotes": quote,
                },
            )
            response.raise_for_status()
            return {row.date: row.rate for row in _RATES.validate_json(response.content)}
        except httpx.TransportError as error:
            raise ExchangeRateError(problem, unreachable=True) from error
        except httpx.HTTPStatusError as error:
            # Too many requests, or a failing server: not just one currency turned down.
            code = error.response.status_code
            raise ExchangeRateError(problem, unreachable=code == 429 or code >= 500) from error
        except ValidationError as error:
            raise ExchangeRateError(problem) from error


def exchange_rate_transport() -> httpx.BaseTransport | None:
    """How requests reach the rate server: over the internet, unless the tests put a stand-in
    for it here."""
    return None


def optional_exchange_rates(
    settings: AppSettings,
    transport: Annotated[httpx.BaseTransport | None, Depends(exchange_rate_transport)],
) -> Iterator[ExchangeRateClient | None]:
    """A client for the rate server, or None when this install has none to ask."""
    if not settings.exchange_rate_url:
        yield None
        return
    with ExchangeRateClient(settings, transport=transport) as client:
        yield client


ExchangeRates = Annotated[ExchangeRateClient | None, Depends(optional_exchange_rates)]


class RateBook:
    """The exchange rates one request needs, into the household's currency (`quote`). Ask for
    the days wanted with `prepare`, which fetches whatever the database lacks, then `convert`."""

    def __init__(self, db: Session, client: ExchangeRateClient | None, quote: str) -> None:
        self.quote = quote
        # Currencies that couldn't be converted, because there are no rates for them or for
        # some of the days asked about.
        self.unavailable: set[str] = set()
        self._db = db
        self._client = client
        self._last_day = utcnow().date() - ONE_DAY
        self._loaded: dict[str, tuple[dt.date, dt.date]] = {}
        self._days: dict[str, list[dt.date]] = {}
        self._rates: dict[str, dict[dt.date, Decimal]] = {}
        # Once the server can't be reached, the rest of the request doesn't try again.
        self._offline = False

    def prepare(self, spans: Mapping[str, tuple[dt.date, dt.date]]) -> None:
        """Gets rates ready for each currency's transactions from its first day to its last."""
        for currency, (first, last) in spans.items():
            first, last = min(first, self._last_day), min(last, self._last_day)
            loaded = self._loaded.get(currency)
            if currency in self.unavailable or (
                loaded is not None and loaded[0] <= first and last <= loaded[1]
            ):
                continue
            try:
                self._load(currency, first, last)
            except ExchangeRateError:
                self.unavailable.add(currency)

    def convert(self, currency: str, day: dt.date, amount: Decimal) -> Decimal | None:
        """The amount in the household's currency, or None without a rate for the day."""
        days = self._days.get(currency, [])
        index = bisect.bisect_right(days, min(day, self._last_day)) - 1
        if index < 0:
            self.unavailable.add(currency)
            return None
        return (amount * self._rates[currency][days[index]]).quantize(CENT, ROUND_HALF_UP)

    def _load(self, currency: str, first: dt.date, last: dt.date) -> None:
        span = self._db.get(ExchangeRateSpan, (currency, self.quote))
        if span is None:
            self._fetch(currency, first, last)
        else:
            if first < span.first_day:
                self._fetch(currency, first, span.first_day - ONE_DAY)
            if last > span.last_day:
                self._fetch(currency, span.last_day + ONE_DAY, last)
        rows = self._db.execute(
            select(ExchangeRate.day, ExchangeRate.rate)
            .where(
                ExchangeRate.base == currency,
                ExchangeRate.quote == self.quote,
                ExchangeRate.day >= first,
                ExchangeRate.day <= last,
            )
            .order_by(ExchangeRate.day)
        ).all()
        self._days[currency] = [row.day for row in rows]
        self._rates[currency] = {row.day: row.rate for row in rows}
        self._loaded[currency] = (first, last)

    def _fetch(self, currency: str, first: dt.date, last: dt.date) -> None:
        """Fetches the days from `first` to `last` into the database, which then has every day
        from its earliest to its latest, as it did before."""
        if self._client is None or self._offline:
            raise ExchangeRateError(f"No {currency} to {self.quote} rates are stored")
        fetched: dict[dt.date, Decimal] = {}
        start = first
        while start <= last:
            end = min(last, start + dt.timedelta(days=CHUNK_DAYS - 1))
            try:
                fetched |= self._client.rates(currency, self.quote, start, end)
            except ExchangeRateError as error:
                self._offline = self._offline or error.unreachable
                raise
            start = end + ONE_DAY
        if fetched:
            self._db.execute(
                insert(ExchangeRate).on_conflict_do_nothing(),
                [
                    {"base": currency, "quote": self.quote, "day": day, "rate": rate}
                    for day, rate in fetched.items()
                ],
            )
        span = insert(ExchangeRateSpan).values(
            base=currency, quote=self.quote, first_day=first, last_day=last
        )
        self._db.execute(
            span.on_conflict_do_update(
                index_elements=["base", "quote"],
                set_={
                    "first_day": func.least(ExchangeRateSpan.first_day, span.excluded.first_day),
                    "last_day": func.greatest(ExchangeRateSpan.last_day, span.excluded.last_day),
                },
            )
        )
        self._db.commit()
