"""The Plaid API client: what it sends, and how it reads Plaid's answers and errors."""

import json
from decimal import Decimal
from typing import Any

import httpx2 as httpx
import pytest
from pydantic import SecretStr

from app.config import Settings
from app.plaid.client import API_VERSION, PlaidClient, PlaidError


class Recorder:
    """Answers every request with the next canned response, and keeps what was sent."""

    def __init__(self, *responses: httpx.Response) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responses.pop(0)

    @property
    def body(self) -> dict[str, Any]:
        body: dict[str, Any] = json.loads(self.requests[-1].content)
        return body


@pytest.fixture
def plaid_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "plaid_client_id": "client-123",
            "plaid_secret": SecretStr("secret-456"),
            "plaid_country_codes": ["US", "CA"],
        }
    )


def client(settings: Settings, recorder: Recorder) -> PlaidClient:
    return PlaidClient(settings, transport=httpx.MockTransport(recorder))


def ok(body: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json={**body, "request_id": "req-1"})


def test_the_client_needs_plaids_keys(settings: Settings) -> None:
    with pytest.raises(ValueError, match="client ID and secret"):
        PlaidClient(settings)


def test_requests_carry_the_keys_and_api_version(plaid_settings: Settings) -> None:
    recorder = Recorder(ok({"access_token": "access-1", "item_id": "item-1"}))
    with client(plaid_settings, recorder) as plaid:
        exchange = plaid.exchange_public_token("public-sandbox-1")

    assert (exchange.access_token, exchange.item_id) == ("access-1", "item-1")
    request = recorder.requests[0]
    assert str(request.url) == "https://sandbox.plaid.com/item/public_token/exchange"
    assert request.headers["PLAID-CLIENT-ID"] == "client-123"
    assert request.headers["PLAID-SECRET"] == "secret-456"
    assert request.headers["Plaid-Version"] == API_VERSION
    assert request.headers["User-Agent"].startswith("Cashcove/")
    assert recorder.body == {"public_token": "public-sandbox-1"}


def test_production_talks_to_plaids_production_host(plaid_settings: Settings) -> None:
    recorder = Recorder(ok({}))
    with client(plaid_settings.model_copy(update={"plaid_env": "production"}), recorder) as plaid:
        plaid.remove_item("access-1")

    assert str(recorder.requests[0].url) == "https://production.plaid.com/item/remove"
    assert recorder.body == {"access_token": "access-1"}


def test_a_link_token_for_a_new_bank_asks_for_transactions(plaid_settings: Settings) -> None:
    recorder = Recorder(ok({"link_token": "link-1", "expiration": "2026-09-27T12:00:00Z"}))
    with client(plaid_settings, recorder) as plaid:
        token = plaid.create_link_token(user_id="user-1", language="en", days_requested=365)

    assert token.link_token == "link-1"
    assert recorder.body == {
        "client_name": "Cashcove",
        "language": "en",
        "country_codes": ["US", "CA"],
        "user": {"client_user_id": "user-1"},
        "products": ["transactions"],
        "transactions": {"days_requested": 365},
    }


def test_a_link_token_in_update_mode_can_offer_account_selection(
    plaid_settings: Settings,
) -> None:
    recorder = Recorder(
        ok({"link_token": "link-1", "expiration": "2026-09-27T12:00:00Z"}),
        ok({"link_token": "link-2", "expiration": "2026-09-27T12:00:00Z"}),
    )
    oauth = plaid_settings.model_copy(update={"plaid_oauth_redirect": True})
    with client(oauth, recorder) as plaid:
        plaid.create_link_token(user_id="user-1", language="fr", access_token="access-1")
        reconnect = recorder.body
        plaid.create_link_token(
            user_id="user-1", language="fr", access_token="access-1", account_selection=True
        )

    assert "products" not in reconnect
    assert reconnect["access_token"] == "access-1"
    assert "update" not in reconnect
    assert reconnect["redirect_uri"] == "https://cashcove.example.com/connect/oauth"
    assert recorder.body["update"] == {"account_selection_enabled": True}


def test_a_link_token_without_a_history_length_leaves_it_to_plaid(
    plaid_settings: Settings,
) -> None:
    recorder = Recorder(ok({"link_token": "link-1", "expiration": "2026-09-27T12:00:00Z"}))
    with client(plaid_settings, recorder) as plaid:
        plaid.create_link_token(user_id="user-1", language="en")

    assert "transactions" not in recorder.body
    assert "redirect_uri" not in recorder.body


def test_accounts_and_balances_come_back_exact(plaid_settings: Settings) -> None:
    body = (
        '{"accounts": [{"account_id": "a1", "name": "Checking", "mask": "0000", '
        '"type": "depository", "subtype": "checking", "balances": {"current": 110.1, '
        '"available": 100.07, "limit": null, "iso_currency_code": "USD"}, "new_field": 1}], '
        '"item": {"item_id": "item-1", "institution_id": "ins_1", "error": null}}'
    )
    recorder = Recorder(httpx.Response(200, content=body.encode()))
    with client(plaid_settings, recorder) as plaid:
        accounts = plaid.get_accounts("access-1")

    balances = accounts.accounts[0].balances
    assert (balances.current, balances.available) == (Decimal("110.1"), Decimal("100.07"))
    assert accounts.item.institution_id == "ins_1"
    assert recorder.body == {"access_token": "access-1"}


def test_institutions_come_with_their_logo_and_colors(plaid_settings: Settings) -> None:
    recorder = Recorder(
        ok(
            {
                "institution": {
                    "institution_id": "ins_1",
                    "name": "First Platypus Bank",
                    "primary_color": "#1f6f5c",
                    "logo": "iVBORw0KGgo=",
                    "url": "https://plaid.com",
                }
            }
        )
    )
    with client(plaid_settings, recorder) as plaid:
        institution = plaid.get_institution("ins_1")

    assert institution.name == "First Platypus Bank"
    assert recorder.body == {
        "institution_id": "ins_1",
        "country_codes": ["US", "CA"],
        "options": {"include_optional_metadata": True},
    }


def test_transactions_sync_one_account_at_a_time(plaid_settings: Settings) -> None:
    page = {
        "added": [],
        "modified": [],
        "removed": [{"transaction_id": "t1"}],
        "next_cursor": "cursor-2",
        "has_more": False,
        "transactions_update_status": "HISTORICAL_UPDATE_COMPLETE",
    }
    recorder = Recorder(ok(page), ok(page))
    with client(plaid_settings, recorder) as plaid:
        first = plaid.sync_transactions("access-1", "a1", None)
        assert "cursor" not in recorder.body
        plaid.sync_transactions("access-1", "a1", "cursor-1")

    assert first.removed[0].transaction_id == "t1"
    assert recorder.body == {
        "access_token": "access-1",
        "count": 500,
        "options": {
            "account_id": "a1",
            "include_original_description": True,
            "personal_finance_category_version": "v2",
        },
        "cursor": "cursor-1",
    }


def test_plaids_errors_come_back_with_their_code(plaid_settings: Settings) -> None:
    recorder = Recorder(
        httpx.Response(
            400,
            json={
                "error_type": "ITEM_ERROR",
                "error_code": "ITEM_LOGIN_REQUIRED",
                "error_message": "the login details of this item have changed",
                "display_message": "Sign in again.",
                "request_id": "req-9",
            },
        )
    )
    with client(plaid_settings, recorder) as plaid, pytest.raises(PlaidError) as raised:
        plaid.get_accounts("access-1")

    error = raised.value
    assert (error.error_type, error.code, error.request_id) == (
        "ITEM_ERROR",
        "ITEM_LOGIN_REQUIRED",
        "req-9",
    )
    assert error.display_message == "Sign in again."
    assert str(error) == "ITEM_LOGIN_REQUIRED: the login details of this item have changed"


def test_an_error_without_plaids_description_still_raises(plaid_settings: Settings) -> None:
    recorder = Recorder(httpx.Response(502, text="Bad gateway"))
    with client(plaid_settings, recorder) as plaid, pytest.raises(PlaidError) as raised:
        plaid.get_accounts("access-1")

    assert raised.value.code == "PLAID_UNAVAILABLE"
    assert "502" in raised.value.message


def test_plaid_being_unreachable_raises_a_plaid_error(plaid_settings: Settings) -> None:
    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Name or service not known", request=request)

    with (
        PlaidClient(plaid_settings, transport=httpx.MockTransport(unreachable)) as plaid,
        pytest.raises(PlaidError) as raised,
    ):
        plaid.get_accounts("access-1")

    assert raised.value.code == "PLAID_UNREACHABLE"


def test_an_items_transaction_updates_are_read_from_its_status(plaid_settings: Settings) -> None:
    beside = {
        "item": {"item_id": "item-1"},
        "status": {
            "transactions": {
                "last_successful_update": "2026-09-01T10:00:00Z",
                "last_failed_update": "2026-09-29T02:11:00Z",
            },
            "last_webhook": None,
        },
    }
    # Where older versions of Plaid's API put it.
    inside = {"item": {"item_id": "item-1", "status": beside["status"]}}
    recorder = Recorder(ok(beside), ok(inside), ok({"item": {"item_id": "item-1"}}), ok({}))
    with client(plaid_settings, recorder) as plaid:
        found = [plaid.get_item("access-1").transactions for _ in range(4)]

    assert str(recorder.requests[0].url) == "https://sandbox.plaid.com/item/get"
    assert recorder.body == {"access_token": "access-1"}
    assert found[0] == found[1]
    assert found[0] is not None
    assert found[0].last_successful_update is not None
    assert found[0].last_failed_update is not None
    assert found[0].last_failed_update.isoformat() == "2026-09-29T02:11:00+00:00"
    # Plaid says nothing about how updates are going, e.g. before the first.
    assert found[2:] == [None, None]


@pytest.mark.parametrize(
    ("institution", "health"),
    [
        ({"status": {"transactions_updates": {"status": "DOWN"}}}, "DOWN"),
        ({"status": {"transactions_updates": {"status": "HEALTHY", "breakdown": {}}}}, "HEALTHY"),
        # Plaid leaves the status out where it doesn't know, like in the sandbox.
        ({}, None),
        ({"status": {"item_logins": {"status": "DOWN"}}}, None),
        ({"status": {"transactions_updates": {}}}, None),
    ],
)
def test_how_well_plaid_gets_a_banks_transactions_is_asked_for_with_its_status(
    plaid_settings: Settings, institution: dict[str, Any], health: str | None
) -> None:
    recorder = Recorder(ok({"institution": {"institution_id": "ins_41", **institution}}))
    with client(plaid_settings, recorder) as plaid:
        found = plaid.transactions_health("ins_41")

    assert found == health
    assert str(recorder.requests[0].url) == "https://sandbox.plaid.com/institutions/get_by_id"
    assert recorder.body == {
        "institution_id": "ins_41",
        "country_codes": ["US", "CA"],
        "options": {"include_status": True},
    }
