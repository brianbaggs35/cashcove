"""A stand-in for Plaid's API, for the end-to-end tests and the API's own tests.

It answers the requests Cashcove makes (app/plaid/client.py) from memory, the way Plaid's
Sandbox does: Link's public tokens name a bank ("public-sandbox-platypus-1" connects First
Platypus Bank), each bank shares a few accounts with a couple of months of transactions, and
tests can add transactions, or have a bank ask for a new sign-in, to see what a sync does.
The baseline's two connections (see e2e/baseline.py) are here from the start.
"""

import base64
import datetime as dt
import json
import secrets
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import httpx2 as httpx

from app.models.base import utcnow

# A 1x1 PNG, standing in for each bank's logo.
LOGO = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082"
    )
).decode()


@dataclass(frozen=True)
class Bank:
    key: str
    institution_id: str
    name: str
    url: str
    color: str


BANKS = {
    bank.key: bank
    for bank in (
        Bank("platypus", "ins_109508", "First Platypus Bank", "https://plaid.com", "#1f6f5c"),
        Bank("gingham", "ins_109509", "First Gingham Credit Union", "https://plaid.com", "#7a3e9d"),
        Bank("tartan", "ins_109511", "Tartan Bank", "https://plaid.com", "#b3282d"),
        Bank("fidelity", "ins_12", "Fidelity", "https://www.fidelity.com", "#368727"),
    )
}

# The made-up client ID and secret the fake accepts.
KEYS = ("e2e-plaid-client", "e2e-plaid-secret")

# The baseline's connections, which the fake knows from the start.
TARTAN_ITEM = "e2e-item-tartan"
TARTAN_ACCESS = "access-sandbox-e2e-tartan"
FIDELITY_ITEM = "e2e-item-fidelity"
FIDELITY_ACCESS = "access-sandbox-e2e-fidelity"


@dataclass
class FakeAccount:
    account_id: str
    name: str
    type: str
    subtype: str
    mask: str
    current: Decimal
    available: Decimal | None = None
    limit: Decimal | None = None
    official_name: str | None = None
    # Everything that happened to its transactions, in order: ("added" | "modified" |
    # "removed", the transaction). A cursor is how many of these a sync has seen.
    events: list[tuple[str, dict[str, Any]]] = field(
        default_factory=list[tuple[str, dict[str, Any]]]
    )

    def as_plaid(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id,
            "name": self.name,
            "official_name": self.official_name,
            "mask": self.mask,
            "type": self.type,
            "subtype": self.subtype,
            "balances": {
                "current": float(self.current),
                "available": None if self.available is None else float(self.available),
                "limit": None if self.limit is None else float(self.limit),
                "iso_currency_code": "USD",
                "unofficial_currency_code": None,
            },
        }


@dataclass
class FakeItem:
    item_id: str
    access_token: str
    bank: Bank
    accounts: list[FakeAccount]
    # An error code, such as ITEM_LOGIN_REQUIRED, while the bank needs attention.
    error: str | None = None
    # Accounts the person unshared through Link's account selection.
    hidden: set[str] = field(default_factory=set[str])

    def shared(self) -> list[FakeAccount]:
        return [account for account in self.accounts if account.account_id not in self.hidden]


def _transaction(
    account: FakeAccount,
    number: int,
    days_ago: int,
    amount: str,
    merchant: str,
    category: str,
    *,
    today: dt.date,
    pending: bool = False,
) -> dict[str, Any]:
    day = (today - dt.timedelta(days=days_ago)).isoformat()
    primary = category.split("_")[0]
    return {
        "transaction_id": f"{account.account_id}-tx-{number}",
        "account_id": account.account_id,
        "amount": float(Decimal(amount)),
        "iso_currency_code": "USD",
        "date": day,
        "authorized_date": day,
        "name": merchant,
        "merchant_name": merchant,
        "original_description": f"{merchant.upper()} #{1000 + number}",
        "pending": pending,
        "pending_transaction_id": None,
        "personal_finance_category": {
            "primary": primary,
            "detailed": category,
            "confidence_level": "VERY_HIGH",
            "version": "v2",
        },
    }


# What each kind of account spends on: (days ago, amount, merchant, Plaid category).
_SPENDING = {
    "checking": (
        (2, "-2450.00", "Acme Corp Payroll", "INCOME_WAGES"),
        (3, "84.12", "Whole Foods", "FOOD_AND_DRINK_GROCERIES"),
        (5, "1800.00", "Maple Street Apartments", "RENT_AND_UTILITIES_RENT"),
        (8, "62.40", "City Power & Light", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"),
        (12, "45.00", "Shell", "TRANSPORTATION_GAS"),
        (16, "-2450.00", "Acme Corp Payroll", "INCOME_WAGES"),
        (20, "118.37", "Trader Joe's", "FOOD_AND_DRINK_GROCERIES"),
        (34, "1800.00", "Maple Street Apartments", "RENT_AND_UTILITIES_RENT"),
    ),
    "credit card": (
        (0, "6.33", "Starbucks", "FOOD_AND_DRINK_COFFEE"),
        (1, "23.18", "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
        (4, "15.49", "Netflix", "ENTERTAINMENT_TV_AND_MOVIES"),
        (9, "412.00", "United Airlines", "TRAVEL_FLIGHTS"),
        (13, "54.90", "Blue Fin Sushi", "FOOD_AND_DRINK_RESTAURANT"),
        (21, "-500.00", "Credit card payment", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
        (27, "89.99", "Best Buy", "GENERAL_MERCHANDISE_ELECTRONICS"),
    ),
}


def _history(account: FakeAccount, today: dt.date) -> None:
    for number, (days_ago, amount, merchant, category) in enumerate(
        _SPENDING.get(account.subtype, ())
    ):
        pending = days_ago == 0
        account.events.append(
            (
                "added",
                _transaction(
                    account,
                    number,
                    days_ago,
                    amount,
                    merchant,
                    category,
                    today=today,
                    pending=pending,
                ),
            )
        )


def _accounts(prefix: str, today: dt.date) -> list[FakeAccount]:
    """The accounts Plaid's Sandbox banks share, with some history."""
    accounts = [
        FakeAccount(
            f"{prefix}-checking",
            "Plaid Checking",
            "depository",
            "checking",
            "0000",
            Decimal("110.00"),
            Decimal("100.00"),
            official_name="Plaid Gold Standard 0% Interest Checking",
        ),
        FakeAccount(
            f"{prefix}-savings",
            "Plaid Saving",
            "depository",
            "savings",
            "1111",
            Decimal("210.00"),
            Decimal("200.00"),
            official_name="Plaid Silver Standard 0.1% Interest Saving",
        ),
        FakeAccount(
            f"{prefix}-credit",
            "Plaid Credit Card",
            "credit",
            "credit card",
            "3333",
            Decimal("410.00"),
            limit=Decimal("2000.00"),
            official_name="Plaid Diamond 12.5% APR Interest Credit Card",
        ),
    ]
    for account in accounts:
        _history(account, today)
    return accounts


class PlaidError(Exception):
    def __init__(self, status: int, error_type: str, code: str, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.error_type = error_type
        self.code = code
        self.message = message


def _invalid(message: str) -> PlaidError:
    return PlaidError(400, "INVALID_REQUEST", "INVALID_FIELD", message)


class FakePlaid:
    """Plaid's API in memory. ``transport`` plugs it into Cashcove's Plaid client."""

    def __init__(self) -> None:
        self.items: dict[str, FakeItem] = {}
        self.link_tokens: list[dict[str, Any]] = []
        # Errors to answer the next request to a path with: path -> (error_type, code).
        self.failures: dict[str, tuple[str, str]] = {}
        self._exchanged: set[str] = set()
        self.reset()

    def reset(self) -> None:
        """Back to the baseline's two connections."""
        self.items = {}
        self.link_tokens = []
        self.failures = {}
        self._exchanged = set()
        tartan = FakeItem(
            TARTAN_ITEM,
            TARTAN_ACCESS,
            BANKS["tartan"],
            [
                FakeAccount(
                    "e2e-card",
                    "Rewards Visa",
                    "credit",
                    "credit card",
                    "3333",
                    Decimal("612.40"),
                    Decimal("4387.60"),
                    Decimal("5000.00"),
                    official_name="Tartan Rewards Visa Signature",
                ),
                FakeAccount(
                    "e2e-tartan-checking",
                    "Tartan Checking",
                    "depository",
                    "checking",
                    "0042",
                    Decimal("2310.55"),
                    Decimal("2310.55"),
                ),
            ],
        )
        fidelity = FakeItem(
            FIDELITY_ITEM,
            FIDELITY_ACCESS,
            BANKS["fidelity"],
            [
                FakeAccount(
                    "e2e-retirement",
                    "Retirement 401(k)",
                    "investment",
                    "401k",
                    "8812",
                    Decimal("48210.55"),
                    official_name="Fidelity 401(k) Plan",
                )
            ],
            error="ITEM_LOGIN_REQUIRED",
        )
        for item in (tartan, fidelity):
            self.items[item.access_token] = item

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def item(self, key: str) -> FakeItem:
        """A connected bank by its key ("platypus"), item ID or access token."""
        for item in self.items.values():
            if key in {item.bank.key, item.item_id, item.access_token}:
                return item
        raise KeyError(key)

    def add_transaction(
        self, key: str, account_id: str, amount: str, merchant: str, category: str
    ) -> dict[str, Any]:
        """A new transaction, as if the bank just reported it."""
        account = next(item for item in self.item(key).accounts if item.account_id == account_id)
        transaction = _transaction(
            account, len(account.events), 0, amount, merchant, category, today=utcnow().date()
        )
        account.events.append(("added", transaction))
        return transaction

    # ---- The API ---------------------------------------------------------------------

    def handle(self, request: httpx.Request) -> httpx.Response:
        body: dict[str, Any] = json.loads(request.content or b"{}")
        try:
            failure = self.failures.pop(request.url.path, None)
            if failure is not None:
                raise PlaidError(400, failure[0], failure[1], f"Made to fail with {failure[1]}")
            if (
                request.headers.get("PLAID-CLIENT-ID"),
                request.headers.get("PLAID-SECRET"),
            ) != KEYS:
                raise PlaidError(400, "INVALID_INPUT", "INVALID_API_KEYS", "Invalid keys")
            handler = {
                "/link/token/create": self._link_token,
                "/item/public_token/exchange": self._exchange,
                "/accounts/get": self._accounts,
                "/institutions/get_by_id": self._institution,
                "/transactions/sync": self._sync,
                "/item/remove": self._remove,
            }.get(request.url.path)
            if handler is None:
                raise PlaidError(404, "INVALID_REQUEST", "UNKNOWN_ENDPOINT", request.url.path)
            answer = handler(body)
        except PlaidError as error:
            return httpx.Response(
                error.status,
                json={
                    "error_type": error.error_type,
                    "error_code": error.code,
                    "error_message": error.message,
                    "display_message": None,
                    "request_id": "fake-request",
                },
            )
        return httpx.Response(200, json={**answer, "request_id": "fake-request"})

    def _item(self, body: dict[str, Any], *, healthy: bool = True) -> FakeItem:
        item = self.items.get(str(body.get("access_token")))
        if item is None:
            raise PlaidError(400, "INVALID_INPUT", "INVALID_ACCESS_TOKEN", "Unknown access token")
        if healthy and item.error is not None:
            raise PlaidError(400, "ITEM_ERROR", item.error, "The bank needs attention")
        return item

    def _link_token(self, body: dict[str, Any]) -> dict[str, Any]:
        # Plaid's tokens are opaque. These say what they're for, so the end-to-end tests'
        # stand-in for Link (frontend/e2e/support/plaid-link.ts) can show the right screen.
        purpose = "new"
        if "access_token" in body:
            # Update mode. The person will fix whatever the bank needed in Link.
            item = self._item(body, healthy=False)
            item.error = None
            purpose = f"update-{item.bank.key}"
        elif body.get("products") != ["transactions"]:
            raise _invalid("products must be ['transactions']")
        self.link_tokens.append(body)
        expiration = utcnow() + dt.timedelta(hours=4)
        return {
            "link_token": f"link-sandbox-{purpose}-{secrets.token_hex(8)}",
            "expiration": expiration.isoformat(),
        }

    def _exchange(self, body: dict[str, Any]) -> dict[str, Any]:
        token = str(body.get("public_token"))
        parts = token.split("-")
        if len(parts) < 3 or parts[2] not in BANKS or token in self._exchanged:
            raise PlaidError(400, "INVALID_INPUT", "INVALID_PUBLIC_TOKEN", "Unknown public token")
        self._exchanged.add(token)
        bank = BANKS[parts[2]]
        number = len(self.items) + 1
        item = FakeItem(
            f"item-{bank.key}-{number}",
            f"access-sandbox-{bank.key}-{number}",
            bank,
            _accounts(f"{bank.key}-{number}", utcnow().date()),
        )
        self.items[item.access_token] = item
        return {"access_token": item.access_token, "item_id": item.item_id}

    def _accounts(self, body: dict[str, Any]) -> dict[str, Any]:
        item = self._item(body)
        return {
            "accounts": [account.as_plaid() for account in item.shared()],
            "item": {
                "item_id": item.item_id,
                "institution_id": item.bank.institution_id,
                "institution_name": item.bank.name,
                "error": None,
                "consent_expiration_time": None,
            },
        }

    def _institution(self, body: dict[str, Any]) -> dict[str, Any]:
        bank = next(
            (bank for bank in BANKS.values() if bank.institution_id == body.get("institution_id")),
            None,
        )
        if bank is None:
            raise PlaidError(400, "INVALID_INPUT", "INVALID_INSTITUTION", "Unknown institution")
        return {
            "institution": {
                "institution_id": bank.institution_id,
                "name": bank.name,
                "url": bank.url,
                "primary_color": bank.color,
                "logo": LOGO,
            }
        }

    def _sync(self, body: dict[str, Any]) -> dict[str, Any]:
        item = self._item(body)
        options: dict[str, Any] = body.get("options") or {}
        account = next(
            (item for item in item.shared() if item.account_id == options.get("account_id")),
            None,
        )
        if account is None:
            raise PlaidError(400, "INVALID_INPUT", "INVALID_ACCOUNT_ID", "Unknown account")
        cursor = str(body.get("cursor") or f"{account.account_id}:0")
        seen = int(cursor.rpartition(":")[2])
        count = int(body.get("count", 100))
        page = account.events[seen : seen + count]
        changes: dict[str, list[dict[str, Any]]] = {"added": [], "modified": [], "removed": []}
        for kind, transaction in page:
            if kind == "removed":
                changes[kind].append(
                    {
                        "transaction_id": transaction["transaction_id"],
                        "account_id": account.account_id,
                    }
                )
            else:
                changes[kind].append(transaction)
        return {
            **changes,
            "next_cursor": f"{account.account_id}:{seen + len(page)}",
            "has_more": seen + len(page) < len(account.events),
            "transactions_update_status": "HISTORICAL_UPDATE_COMPLETE",
            "accounts": [],
        }

    def _remove(self, body: dict[str, Any]) -> dict[str, Any]:
        item = self._item(body, healthy=False)
        del self.items[item.access_token]
        return {}
