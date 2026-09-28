"""The stand-in for Plaid turns requests down the way Plaid does."""

from typing import Any

import httpx2 as httpx
import pytest

from app.plaid.deps import plaid_transport
from e2e.plaid import FIDELITY_ACCESS, KEYS, TARTAN_ACCESS, FakePlaid


def ask(
    fake: FakePlaid, path: str, body: dict[str, Any], keys: tuple[str, str] = KEYS
) -> httpx.Response:
    return fake.handle(
        httpx.Request(
            "POST",
            f"https://sandbox.plaid.com{path}",
            json=body,
            headers={"PLAID-CLIENT-ID": keys[0], "PLAID-SECRET": keys[1]},
        )
    )


def code(response: httpx.Response) -> str:
    return str(response.json()["error_code"])


def test_without_a_stand_in_requests_go_to_plaid() -> None:
    assert plaid_transport() is None


def test_the_wrong_keys_are_turned_down() -> None:
    response = ask(FakePlaid(), "/accounts/get", {"access_token": TARTAN_ACCESS}, ("a", "b"))

    assert (response.status_code, code(response)) == (400, "INVALID_API_KEYS")


@pytest.mark.parametrize(
    ("path", "body", "status", "expected"),
    [
        ("/processor/token/create", {}, 404, "UNKNOWN_ENDPOINT"),
        ("/link/token/create", {"products": ["auth"]}, 400, "INVALID_FIELD"),
        ("/institutions/get_by_id", {"institution_id": "ins_0"}, 400, "INVALID_INSTITUTION"),
        ("/accounts/get", {"access_token": "access-nope"}, 400, "INVALID_ACCESS_TOKEN"),
        ("/accounts/get", {"access_token": FIDELITY_ACCESS}, 400, "ITEM_LOGIN_REQUIRED"),
        ("/transactions/sync", {"access_token": TARTAN_ACCESS}, 400, "INVALID_ACCOUNT_ID"),
        (
            "/transactions/sync",
            {"access_token": TARTAN_ACCESS, "options": {"account_id": "nope"}},
            400,
            "INVALID_ACCOUNT_ID",
        ),
        (
            "/item/public_token/exchange",
            {"public_token": "public-sandbox"},
            400,
            "INVALID_PUBLIC_TOKEN",
        ),
    ],
)
def test_requests_plaid_would_turn_down_are(
    path: str, body: dict[str, Any], status: int, expected: str
) -> None:
    response = ask(FakePlaid(), path, body)

    assert (response.status_code, code(response)) == (status, expected)


def test_a_public_token_is_exchanged_only_once() -> None:
    fake = FakePlaid()
    body = {"public_token": "public-sandbox-gingham-1"}

    assert ask(fake, "/item/public_token/exchange", body).status_code == 200
    assert code(ask(fake, "/item/public_token/exchange", body)) == "INVALID_PUBLIC_TOKEN"
