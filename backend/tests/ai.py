"""A household with account information in awkward places, and helpers for the AI API's tests."""

import datetime as dt
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    Category,
    CategoryKind,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    HistoryStatus,
    Transaction,
)
from e2e.ai import KEYS
from tests.finance import (
    TODAY,
    add_account,
    add_category,
    add_group,
    add_transaction,
    linked_account,
)

# None of these may ever reach an AI.
SECRETS = (
    "Everyday checking",
    "Rewards Visa",
    "Tartan",
    "Harbor",
    "Plaid Checking",
    "4410",
    "3333",
    "99887766554433",
    "123456789012",
    "alex@example.com",
)

PROVIDERS = {
    "anthropic": ("claude-sonnet-5-5", KEYS["anthropic"]),
    "openai": ("gpt-6-luna", KEYS["openai"]),
    "ollama_cloud": ("gemma4:31b", KEYS["ollama_cloud"]),
    "ollama_local": ("llama3.2:3b", None),
}
LOCAL_URL = "http://host.docker.internal:11434"


def configure(client: TestClient, provider: str = "openai", **fields: Any) -> dict[str, Any]:
    """Sets AI up, as an admin, the way the form does."""
    model, key = PROVIDERS[provider]
    body: dict[str, Any] = {"provider": provider, "model": model}
    if key is not None:
        body["api_key"] = key
    if provider == "ollama_local":
        body["base_url"] = LOCAL_URL
    response = client.put("/api/ai/settings", json=body | fields)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


class Household:
    """What `household()` made."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.checking = add_account(
            session, "Everyday checking", institution="Harbor Credit Union", mask="4410"
        )
        self.card = linked_account(
            session,
            "Rewards Visa",
            institution="Tartan Bank",
            mask="3333",
            official_name="Tartan Rewards Visa Signature",
        )
        session.add(
            Connection(
                provider=ConnectionProvider.PLAID,
                external_id="item-tartan",
                access_token="sealed-token",
                institution_name="Tartan Bank",
                status=ConnectionStatus.HEALTHY,
                history=HistoryStatus.COMPLETE,
                available_accounts=[{"name": "Plaid Checking", "mask": "0000"}],
            )
        )
        session.commit()
        food = add_group(session, "Food & drink")
        self.groceries = add_category(session, "Groceries", food)
        self.coffee = add_category(session, "Coffee", food)
        self.gifts = add_category(session, "Gifts & donations", add_group(session, "Lifestyle"))
        self.subscriptions = add_category(session, "Subscriptions", add_group(session, "Bills"))
        transfers = add_group(session, "Transfers", CategoryKind.TRANSFER)
        self.card_payments = add_category(session, "Credit card payments", transfers)
        income = add_group(session, "Income", CategoryKind.INCOME)
        self.paycheck = add_category(session, "Paycheck", income)

    def transaction(
        self, payee: str, amount: str, category: Category | None = None, **fields: Any
    ) -> Transaction:
        return add_transaction(
            self.session,
            fields.pop("account", self.checking),
            amount,
            payee,
            category_id=category.id if category else None,
            **fields,
        )

    def sorted_badly(self) -> dict[str, Transaction]:
        """Transactions for the AI to look at, some of which carry account information."""
        recent = TODAY - dt.timedelta(days=2)
        return {
            "venmo": self.transaction("Venmo", "-40.00", date=recent),
            "netflix": self.transaction("Netflix", "-15.49", self.coffee, date=recent),
            "whole_foods": self.transaction("Whole Foods", "-84.12", self.groceries, date=recent),
            "starbucks": self.transaction(
                "Starbucks 12345",
                "-4.50",
                None,
                date=recent,
                original_description="STARBUCKS ACH 99887766554433 HARBOR CU",
                notes="Account 123456789012, ask alex@example.com",
            ),
            "autopay": self.transaction(
                "Payment to Tartan Bank card ending in 4410 from Everyday checking",
                "-300.00",
                self.card_payments,
                date=recent,
            ),
        }


def household(session: Session) -> Household:
    return Household(session)
