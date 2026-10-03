"""A stand-in for a Frankfurter server, so tests never reach the real one."""

import datetime as dt
from collections.abc import Mapping
from decimal import Decimal

import httpx2 as httpx

# What the clock says in tests, so "yesterday", the latest day with a final rate, is the
# same whenever they run.
NOW = dt.datetime(2026, 10, 3, 12, 0, tzinfo=dt.UTC)
YESTERDAY = dt.date(2026, 10, 2)


class FakeRates:
    """Answers like a Frankfurter server's /v2/rates, with the rates given to it."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        # Set to make every request fail the way a server that's down does.
        self.status: int | None = None
        self.unreachable = False
        self.body: str | None = None
        self._rates: dict[str, Mapping[dt.date, Decimal] | Decimal] = {}

    def rate(self, base: str, rate: str | Mapping[dt.date, str]) -> None:
        """One `base` is worth `rate` in whatever it's asked for, every day, or the rate of each
        day given. A base with no rate is one the server doesn't know."""
        self._rates[base] = (
            Decimal(rate)
            if isinstance(rate, str)
            else {day: Decimal(value) for day, value in rate.items()}
        )

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._answer)

    def _answer(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.unreachable:
            raise httpx.ConnectError("The rate server can't be reached", request=request)
        if self.status is not None:
            return httpx.Response(self.status, json={"status": self.status, "message": "No"})
        if self.body is not None:
            return httpx.Response(200, text=self.body)
        query = request.url.params
        base, quote = query["base"], query["quotes"]
        if base not in self._rates:
            return httpx.Response(422, json={"status": 422, "message": f"invalid currency: {base}"})
        rates = self._rates[base]
        first, last = dt.date.fromisoformat(query["from"]), dt.date.fromisoformat(query["to"])
        rows: list[str] = []
        for offset in range((last - first).days + 1):
            day = first + dt.timedelta(days=offset)
            rate = rates if isinstance(rates, Decimal) else rates.get(day)
            if rate is not None:
                # A JSON number, like a real server's.
                rows.append(f'{{"date":"{day}","base":"{base}","quote":"{quote}","rate":{rate}}}')
        return httpx.Response(200, text=f"[{','.join(rows)}]")

    def days_asked(self) -> list[tuple[str, str]]:
        """The first and last day of each request, as ISO dates."""
        return [(r.url.params["from"], r.url.params["to"]) for r in self.requests]
