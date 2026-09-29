"""The stand-in for Plaid turns requests down the way Plaid does."""

from typing import Any

import httpx2 as httpx
import pytest

from app.plaid.deps import plaid_transport
from e2e.plaid import BANKS, FIDELITY_ACCESS, KEYS, TARTAN_ACCESS, FakePlaid


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


def test_an_items_status_says_whether_its_transactions_update() -> None:
    fake = FakePlaid()
    body = {"access_token": TARTAN_ACCESS}

    working = ask(fake, "/item/get", body).json()["status"]["transactions"]
    fake.item("tartan").feed_down = True
    broken = ask(fake, "/item/get", body).json()["status"]["transactions"]

    assert (working["last_successful_update"] is None, working["last_failed_update"]) == (
        False,
        None,
    )
    assert (broken["last_successful_update"], broken["last_failed_update"] is None) == (None, False)
    # A bank that wants someone to sign in again has a status too.
    assert ask(fake, "/item/get", {"access_token": FIDELITY_ACCESS}).status_code == 200


def test_a_banks_health_is_only_given_when_asked_for_and_known() -> None:
    fake = FakePlaid()
    ask_for = {"institution_id": BANKS["tartan"].institution_id}
    fake.health[BANKS["tartan"].institution_id] = "DEGRADED"

    asked = ask(fake, "/institutions/get_by_id", {**ask_for, "options": {"include_status": True}})
    not_asked = ask(fake, "/institutions/get_by_id", ask_for)
    unknown = ask(
        fake,
        "/institutions/get_by_id",
        {"institution_id": BANKS["fidelity"].institution_id, "options": {"include_status": True}},
    )

    assert asked.json()["institution"]["status"] == {"transactions_updates": {"status": "DEGRADED"}}
    assert "status" not in not_asked.json()["institution"]
    assert "status" not in unknown.json()["institution"]
    fake.reset()
    assert fake.health == {}


def test_a_bank_plaid_cant_get_transactions_from_answers_with_nothing_but_a_cursor() -> None:
    fake = FakePlaid()
    fake.item("tartan").feed_down = True
    body = {"access_token": TARTAN_ACCESS, "options": {"account_id": "e2e-card"}}

    answer = ask(fake, "/transactions/sync", body).json()

    assert (answer["added"], answer["has_more"]) == ([], False)
    assert answer["transactions_update_status"] == "HISTORICAL_UPDATE_COMPLETE"
    # A cursor past everything the bank has, so a client that keeps it never sees the history.
    events = len(fake.item("tartan").accounts[0].events)
    assert answer["next_cursor"] == f"e2e-card:{events}"


def test_a_public_token_is_exchanged_only_once() -> None:
    fake = FakePlaid()
    body = {"public_token": "public-sandbox-gingham-1"}

    assert ask(fake, "/item/public_token/exchange", body).status_code == 200
    assert code(ask(fake, "/item/public_token/exchange", body)) == "INVALID_PUBLIC_TOKEN"
