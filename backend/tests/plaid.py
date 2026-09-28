"""A stand-in for Plaid behind the API, for the Connect tab's tests."""

import base64
import uuid
from collections.abc import Callable
from typing import Any

import httpx2 as httpx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import plaid_box
from app.config import Settings
from app.models import (
    Account,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    HistoryStatus,
    Transaction,
)
from app.plaid.accounts import share
from app.plaid.client import PlaidAccount
from e2e.plaid import FakePlaid

# A 1x1 PNG, standing in for a bank's logo. Plaid's Sandbox banks mostly have none.
LOGO = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082"
    )
).decode()


def connect(client: TestClient, bank: str = "platypus", number: int = 1) -> dict[str, Any]:
    """Connects a bank as if Plaid Link just handed back a public token for it."""
    response = client.post(
        "/api/connections", json={"public_token": f"public-sandbox-{bank}-{number}"}
    )
    assert response.status_code == 201, response.text
    connection: dict[str, Any] = response.json()
    return connection


def choose(
    client: TestClient, connection: dict[str, Any], *accounts: str | dict[str, str], **body: Any
) -> httpx.Response:
    """Chooses which of the connection's accounts to import, by Plaid ID."""
    chosen = [{"id": account} if isinstance(account, str) else account for account in accounts]
    return client.put(
        f"/api/connections/{connection['id']}/accounts", json={"accounts": chosen, **body}
    )


def plaid_ids(connection: dict[str, Any]) -> dict[str, str]:
    """The connection's accounts' Plaid IDs by name."""
    return {account["name"]: account["id"] for account in connection["accounts"]}


def seeded(
    session: Session, settings: Settings, fake: FakePlaid, key: str = "tartan"
) -> Connection:
    """A connection to one of the fake's banks, straight into the database, nothing imported."""
    item = fake.item(key)
    connection = Connection(
        provider=ConnectionProvider.PLAID,
        external_id=item.item_id,
        access_token=plaid_box(settings).encrypt(item.access_token),
        institution_id=item.bank.institution_id,
        institution_name=item.bank.name,
        status=ConnectionStatus.HEALTHY,
        history=HistoryStatus.COMPLETE,
        available_accounts=[
            share(PlaidAccount.model_validate(account.as_plaid()), "USD").model_dump(mode="json")
            for account in item.accounts
        ],
        skipped_accounts=[],
    )
    session.add(connection)
    session.commit()
    return connection


def rewriting(
    fake: FakePlaid, path: str, change: Callable[[dict[str, Any]], None]
) -> httpx.MockTransport:
    """The fake, with its answers to one path changed."""

    def handle(request: httpx.Request) -> httpx.Response:
        response = fake.handle(request)
        if request.url.path != path:
            return response
        body: dict[str, Any] = response.json()
        change(body)
        return httpx.Response(response.status_code, json=body)

    return httpx.MockTransport(handle)


def accounts_of(session: Session, connection_id: str | uuid.UUID) -> list[Account]:
    """The accounts a connection keeps up to date, by name."""
    session.expire_all()
    return list(
        session.scalars(
            select(Account)
            .where(Account.connection_id == uuid.UUID(str(connection_id)))
            .order_by(Account.name)
        )
    )


def transactions_in(session: Session, account: Account) -> list[Transaction]:
    session.expire_all()
    return list(
        session.scalars(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .order_by(Transaction.date.desc(), Transaction.payee)
        )
    )
