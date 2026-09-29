"""A small, typed client for the parts of Plaid's API that Cashcove uses.

It talks to Plaid's REST API (https://plaid.com/docs/api/) directly rather than through
plaid-python, which Plaid only publishes as a source package: Cashcove's image installs
prebuilt wheels only, so no package's own code runs while it's built. Requests and responses
follow Plaid's OpenAPI description for API version 2020-09-14, and only the fields Cashcove
reads are modelled; Plaid adds new ones all the time, and they're ignored.
"""

import datetime as dt
from decimal import Decimal
from types import TracebackType
from typing import Any, Self

import httpx2 as httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from app.config import PlaidCountry, Settings

API_VERSION = "2020-09-14"
HOSTS = {"sandbox": "https://sandbox.plaid.com", "production": "https://production.plaid.com"}
# Plaid can take a while to answer, especially while it's reaching a bank.
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# The most /transactions/sync hands out at once.
SYNC_PAGE_SIZE = 500


class PlaidError(Exception):
    """Plaid turned a request down, or couldn't be reached.

    ``code`` is Plaid's error_code, such as ITEM_LOGIN_REQUIRED, which is safe to act on;
    ``request_id`` identifies the request if Plaid's support needs to look into it.
    """

    def __init__(
        self,
        error_type: str,
        code: str,
        message: str,
        *,
        display_message: str | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.error_type = error_type
        self.code = code
        self.message = message
        self.display_message = display_message
        self.request_id = request_id


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class ErrorBody(_Model):
    error_type: str
    error_code: str
    error_message: str = ""
    display_message: str | None = None
    request_id: str | None = None

    def to_exception(self) -> PlaidError:
        return PlaidError(
            self.error_type,
            self.error_code,
            self.error_message,
            display_message=self.display_message,
            request_id=self.request_id,
        )


class LinkToken(_Model):
    link_token: str
    expiration: dt.datetime


class TokenExchange(_Model):
    access_token: str
    item_id: str


class Balances(_Model):
    # Money in the account, or owed on a card or loan (positive when owed).
    current: Decimal | None = None
    available: Decimal | None = None
    limit: Decimal | None = None
    iso_currency_code: str | None = None
    unofficial_currency_code: str | None = None


class PlaidAccount(_Model):
    account_id: str
    name: str
    official_name: str | None = None
    mask: str | None = None
    type: str
    subtype: str | None = None
    balances: Balances


class Item(_Model):
    item_id: str
    institution_id: str | None = None
    institution_name: str | None = None
    # Set when the Item needs attention, e.g. ITEM_LOGIN_REQUIRED.
    error: ErrorBody | None = None
    consent_expiration_time: dt.datetime | None = None


class AccountsResponse(_Model):
    accounts: list[PlaidAccount]
    item: Item


class Institution(_Model):
    institution_id: str
    name: str
    url: str | None = None
    primary_color: str | None = None
    # A base64 PNG.
    logo: str | None = None


class _InstitutionResponse(_Model):
    institution: Institution


class TransactionsStatus(_Model):
    # When Plaid last got through to the bank for an Item's transactions, and when it last
    # failed to. Either can be missing, e.g. before the first attempt.
    last_successful_update: dt.datetime | None = None
    last_failed_update: dt.datetime | None = None


class ItemStatus(_Model):
    transactions: TransactionsStatus | None = None


class _ItemDetails(_Model):
    status: ItemStatus | None = None


class ItemResponse(_Model):
    # Plaid puts the status beside the Item; older versions of its API put it inside.
    item: _ItemDetails | None = None
    status: ItemStatus | None = None

    @property
    def transactions(self) -> TransactionsStatus | None:
        """How Plaid's attempts to update the Item's transactions have gone."""
        status = self.status or (self.item.status if self.item else None)
        return status.transactions if status else None


class _Health(_Model):
    # HEALTHY, DEGRADED or DOWN.
    status: str | None = None


class _InstitutionStatus(_Model):
    transactions_updates: _Health | None = None


class _InstitutionWithStatus(_Model):
    # Plaid leaves it out where it doesn't know, like in the sandbox.
    status: _InstitutionStatus | None = None


class _InstitutionStatusResponse(_Model):
    institution: _InstitutionWithStatus


class PersonalFinanceCategory(_Model):
    primary: str
    detailed: str
    confidence_level: str | None = None


class PlaidTransaction(_Model):
    transaction_id: str
    account_id: str
    # Positive when money leaves the account, the other way round from Cashcove.
    amount: Decimal
    iso_currency_code: str | None = None
    # The posting date, or for a pending transaction the day it happened.
    date: dt.date
    # The day it happened, which people recognise, when the bank says.
    authorized_date: dt.date | None = None
    name: str | None = None
    merchant_name: str | None = None
    original_description: str | None = None
    pending: bool = False
    # For a posted transaction: the pending one it replaces.
    pending_transaction_id: str | None = None
    personal_finance_category: PersonalFinanceCategory | None = None


class RemovedTransaction(_Model):
    transaction_id: str
    account_id: str | None = None


class TransactionsPage(_Model):
    added: list[PlaidTransaction]
    modified: list[PlaidTransaction]
    removed: list[RemovedTransaction]
    next_cursor: str
    has_more: bool
    # NOT_READY, INITIAL_UPDATE_COMPLETE or HISTORICAL_UPDATE_COMPLETE.
    transactions_update_status: str = "TRANSACTIONS_UPDATE_STATUS_UNKNOWN"


class PlaidClient:
    """One connection to Plaid, reused for every request until it's closed."""

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None):
        if settings.plaid_client_id is None or settings.plaid_secret is None:
            raise ValueError("Plaid isn't configured: its client ID and secret are missing")
        self.country_codes: list[PlaidCountry] = list(settings.plaid_country_codes)
        self.redirect_uri = settings.plaid_redirect_uri
        self._http = httpx.Client(
            base_url=HOSTS[settings.plaid_env],
            timeout=TIMEOUT,
            transport=transport,
            headers={
                "Plaid-Version": API_VERSION,
                "PLAID-CLIENT-ID": settings.plaid_client_id,
                "PLAID-SECRET": settings.plaid_secret.get_secret_value(),
                "User-Agent": f"Cashcove/{settings.version}",
            },
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

    def _post[T: BaseModel](self, path: str, body: dict[str, Any], model: type[T]) -> T:
        try:
            response = self._http.post(path, json=body)
        except httpx.HTTPError as error:
            raise PlaidError("API_ERROR", "PLAID_UNREACHABLE", str(error)) from error
        if response.is_success:
            return model.model_validate_json(response.content)
        try:
            raise ErrorBody.model_validate_json(response.content).to_exception()
        except ValidationError:
            raise PlaidError(
                "API_ERROR",
                "PLAID_UNAVAILABLE",
                f"Plaid answered {response.status_code} without an error description",
            ) from None

    def create_link_token(
        self,
        *,
        user_id: str,
        language: str,
        days_requested: int | None = None,
        access_token: str | None = None,
        account_selection: bool = False,
    ) -> LinkToken:
        """A token to open Link with: for a new bank, or, with an access token, in update mode
        to sign in to a connected bank again or choose which of its accounts it shares."""
        body: dict[str, Any] = {
            "client_name": "Cashcove",
            "language": language,
            "country_codes": self.country_codes,
            "user": {"client_user_id": user_id},
        }
        if access_token is None:
            body["products"] = ["transactions"]
            if days_requested is not None:
                body["transactions"] = {"days_requested": days_requested}
        else:
            body["access_token"] = access_token
            if account_selection:
                body["update"] = {"account_selection_enabled": True}
        if self.redirect_uri is not None:
            body["redirect_uri"] = self.redirect_uri
        return self._post("/link/token/create", body, LinkToken)

    def exchange_public_token(self, public_token: str) -> TokenExchange:
        return self._post(
            "/item/public_token/exchange", {"public_token": public_token}, TokenExchange
        )

    def get_accounts(self, access_token: str) -> AccountsResponse:
        """The Item's accounts with the balances Plaid last fetched, and the Item's health."""
        return self._post("/accounts/get", {"access_token": access_token}, AccountsResponse)

    def get_institution(self, institution_id: str) -> Institution:
        response = self._post(
            "/institutions/get_by_id",
            {
                "institution_id": institution_id,
                "country_codes": self.country_codes,
                "options": {"include_optional_metadata": True},
            },
            _InstitutionResponse,
        )
        return response.institution

    def get_item(self, access_token: str) -> ItemResponse:
        """How Plaid's attempts to update the Item's transactions have gone."""
        return self._post("/item/get", {"access_token": access_token}, ItemResponse)

    def transactions_health(self, institution_id: str) -> str | None:
        """How well Plaid is getting transactions from a bank right now for everyone: HEALTHY,
        DEGRADED or DOWN, or None where Plaid doesn't say."""
        response = self._post(
            "/institutions/get_by_id",
            {
                "institution_id": institution_id,
                "country_codes": self.country_codes,
                "options": {"include_status": True},
            },
            _InstitutionStatusResponse,
        )
        status = response.institution.status
        updates = status.transactions_updates if status else None
        return updates.status if updates else None

    def sync_transactions(
        self, access_token: str, account_id: str, cursor: str | None
    ) -> TransactionsPage:
        """One page of what changed in an account since the cursor, or its whole history when
        there's no cursor yet. Each account is its own stream with its own cursor."""
        body: dict[str, Any] = {
            "access_token": access_token,
            "count": SYNC_PAGE_SIZE,
            "options": {
                "account_id": account_id,
                # What the bank itself called each transaction, kept alongside Plaid's
                # cleaned-up merchant name.
                "include_original_description": True,
                # Plaid's newest category taxonomy.
                "personal_finance_category_version": "v2",
            },
        }
        if cursor:
            body["cursor"] = cursor
        return self._post("/transactions/sync", body, TransactionsPage)

    def remove_item(self, access_token: str) -> None:
        """Revokes the access token, which also ends Plaid's billing for the connection."""
        self._post("/item/remove", {"access_token": access_token}, _Model)
