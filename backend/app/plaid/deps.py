"""FastAPI dependencies that hand routes a client for Plaid's API."""

from collections.abc import Iterator
from typing import Annotated

import httpx2 as httpx
from fastapi import Depends, status

from app.auth.deps import ApiError, AppSettings
from app.plaid.client import PlaidClient


def plaid_transport() -> httpx.BaseTransport | None:
    """How requests reach Plaid: over the internet, unless the tests or the end-to-end harness
    put a stand-in for Plaid here."""
    return None


def optional_plaid(
    settings: AppSettings,
    transport: Annotated[httpx.BaseTransport | None, Depends(plaid_transport)],
) -> Iterator[PlaidClient | None]:
    """A client for Plaid, or None when this install has no Plaid keys."""
    if not settings.plaid_configured:
        yield None
        return
    with PlaidClient(settings, transport=transport) as client:
        yield client


OptionalPlaid = Annotated[PlaidClient | None, Depends(optional_plaid)]


def require_plaid(client: OptionalPlaid) -> PlaidClient:
    if client is None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "plaid_not_configured",
            "Plaid isn't set up on this server yet, so banks can't be connected.",
        )
    return client


Plaid = Annotated[PlaidClient, Depends(require_plaid)]
