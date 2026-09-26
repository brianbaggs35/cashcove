import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, AccountType, AppSettings, Transaction
from app.models.base import utcnow
from app.schemas.preferences import GeneralPreferences, Preferences
from tests.finance import add_account, add_transaction, linked_account
from tests.helpers import error


def create(client: TestClient, **overrides: Any) -> dict[str, Any]:
    body = {"name": "Rainy day fund", "type": "savings", "balance": "2500.00"} | overrides
    response = client.post("/api/accounts", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def stored(session: Session, account_id: str | uuid.UUID) -> Account:
    session.expire_all()
    account = session.get(Account, uuid.UUID(str(account_id)))
    assert account is not None
    return account


def test_everyone_sees_the_accounts_open_ones_first(
    viewer_client: TestClient, session: Session
) -> None:
    savings = add_account(session, "savings account", type=AccountType.SAVINGS, balance="12500.00")
    checking = add_account(session, "Everyday checking")
    add_account(
        session,
        "Old store card",
        type=AccountType.CREDIT_CARD,
        balance="0",
        closed_at=utcnow(),
    )
    add_transaction(session, checking, "-4.50")
    add_transaction(session, checking, "-12.00")

    accounts = viewer_client.get("/api/accounts").json()

    assert [account["name"] for account in accounts] == [
        "Everyday checking",
        "savings account",
        "Old store card",
    ]
    first = accounts[0]
    assert first["transaction_count"] == 2
    assert first["balance"] == "1000.00"
    assert first["source"] == "manual"
    assert first["closed_at"] is None
    assert accounts[1]["id"] == str(savings.id)
    assert accounts[1]["balance"] == "12500.00"
    assert accounts[1]["transaction_count"] == 0
    assert accounts[2]["closed_at"] is not None


def test_signing_in_is_needed_to_see_accounts(client: TestClient) -> None:
    assert error(client.get("/api/accounts")) == "not_signed_in"


def test_an_admin_adds_an_account_in_the_household_currency(
    admin_client: TestClient, session: Session
) -> None:
    session.add(
        AppSettings(
            id=1,
            data=Preferences(general=GeneralPreferences(currency="CAD")).model_dump(mode="json"),
        )
    )
    session.commit()

    account = create(admin_client, name="  Rainy day fund ", institution=" ", notes="")

    assert account["name"] == "Rainy day fund"
    assert account["type"] == "savings"
    assert account["currency"] == "CAD"
    assert account["balance"] == "2500.00"
    assert account["source"] == "manual"
    assert (account["institution"], account["notes"], account["mask"]) == (None, None, None)
    assert account["transaction_count"] == 0
    assert account["balance_updated_at"] is not None
    assert admin_client.get(f"/api/accounts/{account['id']}").json() == account


def test_an_account_can_have_every_detail(admin_client: TestClient) -> None:
    account = create(
        admin_client,
        name="Rewards card",
        type="credit_card",
        institution="Harbor Credit Union",
        mask="4410",
        currency="USD",
        balance="-612.4",
        credit_limit="5000",
        notes="Pays off monthly",
    )

    assert account["institution"] == "Harbor Credit Union"
    assert account["mask"] == "4410"
    assert account["balance"] == "-612.40"
    assert account["credit_limit"] == "5000.00"
    assert account["notes"] == "Pays off monthly"
    assert account["available_balance"] is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "  "),
        ("name", "x" * 81),
        ("type", "piggy_bank"),
        ("mask", "12345"),
        ("mask", "1"),
        ("mask", "12-4"),
        ("currency", "usd"),
        ("balance", "1.005"),
        ("balance", "1000000000000"),
        ("credit_limit", "-5"),
        ("notes", "x" * 501),
        # Only Plaid links accounts to a bank.
        ("source", "plaid"),
        ("external_id", "plaid-account"),
    ],
)
def test_account_details_are_checked(admin_client: TestClient, field: str, value: str) -> None:
    body = {"name": "Rainy day fund", "type": "savings", "balance": "0"} | {field: value}
    response = admin_client.post("/api/accounts", json=body)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == field


def test_viewers_cannot_change_accounts(viewer_client: TestClient, session: Session) -> None:
    account = add_account(session)
    for method, path, body in [
        ("POST", "/api/accounts", {"name": "Fund", "type": "savings", "balance": "1"}),
        ("PATCH", f"/api/accounts/{account.id}", {"name": "Mine now"}),
        ("DELETE", f"/api/accounts/{account.id}", None),
    ]:
        response = viewer_client.request(method, path, json=body)
        assert response.status_code == 403
        assert error(response) == "admin_only"


def test_an_admin_edits_a_manual_account(admin_client: TestClient, session: Session) -> None:
    account = add_account(session, institution="Harbor Credit Union", mask="4410", notes="Joint")
    updated_before = account.balance_updated_at
    add_transaction(session, account, "-20.00")

    response = admin_client.patch(
        f"/api/accounts/{account.id}",
        json={
            "name": " Joint checking ",
            "type": "savings",
            "institution": None,
            "mask": "9921",
            "currency": "EUR",
            "credit_limit": "250",
            "notes": "  ",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Joint checking"
    assert body["type"] == "savings"
    assert (body["institution"], body["mask"], body["notes"]) == (None, "9921", None)
    assert (body["currency"], body["credit_limit"]) == ("EUR", "250.00")
    assert body["transaction_count"] == 1
    # The balance didn't change, so neither did when it was last updated.
    assert stored(session, account.id).balance_updated_at == updated_before


def test_changing_the_balance_records_when(admin_client: TestClient, session: Session) -> None:
    account = add_account(session)
    before = account.balance_updated_at

    body = admin_client.patch(f"/api/accounts/{account.id}", json={"balance": "950.25"}).json()

    assert body["balance"] == "950.25"
    assert stored(session, account.id).balance_updated_at > before
    # Sending the same balance again changes nothing.
    again = admin_client.patch(f"/api/accounts/{account.id}", json={"balance": "950.250"})
    assert again.json()["balance_updated_at"] == body["balance_updated_at"]


def test_required_details_sent_as_null_stay_as_they_are(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)

    body = admin_client.patch(
        f"/api/accounts/{account.id}", json={"name": None, "type": None, "balance": None}
    ).json()

    assert (body["name"], body["type"], body["balance"]) == (
        "Everyday checking",
        "checking",
        "1000.00",
    )


def test_closing_and_reopening_an_account(admin_client: TestClient, session: Session) -> None:
    account = add_account(session)
    path = f"/api/accounts/{account.id}"

    closed = admin_client.patch(path, json={"closed": True}).json()
    assert closed["closed_at"] is not None
    # Closing it again keeps the date it was first closed.
    assert (
        admin_client.patch(path, json={"closed": True}).json()["closed_at"] == (closed["closed_at"])
    )

    assert admin_client.patch(path, json={"closed": False}).json()["closed_at"] is None
    assert stored(session, account.id).closed_at is None


def test_plaid_keeps_a_linked_accounts_details(admin_client: TestClient, session: Session) -> None:
    account = linked_account(session, mask="3333")
    path = f"/api/accounts/{account.id}"

    body = admin_client.patch(
        path,
        # Details sent back unchanged, as a form would, are fine.
        json={"name": "Travel card", "notes": "For trips", "mask": "3333", "balance": "-612.40"},
    ).json()
    assert (body["name"], body["notes"]) == ("Travel card", "For trips")
    assert admin_client.patch(path, json={"closed": True}).json()["closed_at"] is not None

    for change in [
        {"balance": "0"},
        {"type": "checking"},
        {"institution": "Another bank"},
        {"mask": "1111"},
        {"currency": "EUR"},
        {"credit_limit": "100"},
    ]:
        response = admin_client.patch(path, json=change)
        assert response.status_code == 409
        assert error(response) == "linked_account"
    assert stored(session, account.id).balance == account.balance


def test_deleting_an_account_deletes_its_transactions(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    add_transaction(session, account, "-20.00")
    other = add_account(session, "Wallet cash", type=AccountType.CASH)
    add_transaction(session, other, "-3.00")

    response = admin_client.delete(f"/api/accounts/{account.id}")

    assert response.status_code == 204
    assert error(admin_client.get(f"/api/accounts/{account.id}")) == "not_found"
    remaining = session.scalars(select(Transaction.account_id)).all()
    assert remaining == [other.id]
    assert session.scalar(select(func.count()).select_from(Account)) == 1


def test_missing_accounts_are_not_found(admin_client: TestClient) -> None:
    missing = uuid.uuid4()
    for method, body in [("GET", None), ("PATCH", {"name": "Found"}), ("DELETE", None)]:
        response = admin_client.request(method, f"/api/accounts/{missing}", json=body)
        assert response.status_code == 404
        assert error(response) == "not_found"
