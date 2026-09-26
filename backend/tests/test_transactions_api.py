import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.finance.transactions import searched_amount
from app.models import Account, AccountType, Transaction, TransactionSource
from app.models.base import utcnow
from tests.finance import (
    TODAY,
    add_account,
    add_category,
    add_group,
    add_transaction,
    linked_account,
)
from tests.helpers import error


def balance(session: Session, account: Account) -> Decimal:
    session.expire_all()
    stored = session.get(Account, account.id)
    assert stored is not None
    return stored.balance


def listed(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/transactions", params=params)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def payees(client: TestClient, **params: Any) -> list[str]:
    return [item["payee"] for item in listed(client, **params)["items"]]


def days_ago(days: int) -> dt.date:
    return TODAY - dt.timedelta(days=days)


@pytest.fixture
def household(session: Session) -> dict[str, Any]:
    """Two accounts, a few categories and a month of transactions."""
    checking = add_account(session, "Everyday checking")
    card = linked_account(session)
    food = add_group(session)
    groceries = add_category(session, "Groceries", food, "🛒")
    coffee = add_category(session, "Coffee", food, "☕")
    income = add_category(session, "Paycheck", emoji="💼")
    rows = {
        "paycheck": add_transaction(
            session, checking, "2400.00", "Acme Corp", date=days_ago(14), category_id=income.id
        ),
        "shop": add_transaction(
            session,
            checking,
            "-84.12",
            "Whole Foods",
            date=days_ago(3),
            category_id=groceries.id,
            original_description="WHOLEFDS MKT #10234 AUSTIN TX",
        ),
        "latte": add_transaction(
            session,
            card,
            "-4.50",
            "Blue Bottle",
            date=days_ago(1),
            category_id=coffee.id,
            source=TransactionSource.PLAID,
            external_id="txn-coffee",
            pending=True,
        ),
        "refund": add_transaction(
            session,
            card,
            "18.20",
            "Hardware Store",
            date=days_ago(7),
            source=TransactionSource.PLAID,
            external_id="txn-refund",
            notes="Returned the drill",
        ),
        "rent": add_transaction(
            session, checking, "-1650.00", "Parkside Apartments", date=days_ago(25)
        ),
    }
    return {
        "checking": checking,
        "card": card,
        "groceries": groceries,
        "coffee": coffee,
        "income": income,
        **rows,
    }


# ---- Listing, filtering and searching -------------------------------------------------


def test_everyone_sees_the_newest_transactions_first_with_totals(
    viewer_client: TestClient, household: dict[str, Any]
) -> None:
    page = listed(viewer_client)

    assert [item["payee"] for item in page["items"]] == [
        "Blue Bottle",
        "Whole Foods",
        "Hardware Store",
        "Acme Corp",
        "Parkside Apartments",
    ]
    assert (page["total"], page["page"], page["page_size"]) == (5, 1, 50)
    assert page["totals"] == [
        {"currency": "USD", "count": 5, "money_in": "2418.20", "money_out": "-1738.62"}
    ]
    coffee = page["items"][0]
    assert coffee == {
        "id": str(household["latte"].id),
        "account_id": str(household["card"].id),
        "date": days_ago(1).isoformat(),
        "amount": "-4.50",
        "payee": "Blue Bottle",
        "original_description": None,
        "category_id": str(household["coffee"].id),
        "notes": None,
        "pending": True,
        "source": "plaid",
        "created_at": coffee["created_at"],
        "updated_at": coffee["updated_at"],
    }


def test_signing_in_is_needed_to_see_transactions(client: TestClient) -> None:
    assert error(client.get("/api/transactions")) == "not_signed_in"


def test_pages_split_the_list_without_changing_the_totals(
    viewer_client: TestClient, household: dict[str, Any]
) -> None:
    second = listed(viewer_client, page=2, page_size=2)

    assert [item["payee"] for item in second["items"]] == ["Hardware Store", "Acme Corp"]
    assert (second["total"], second["page"], second["page_size"]) == (5, 2, 2)
    assert listed(viewer_client, page=4, page_size=2)["items"] == []


def test_no_transactions_add_up_to_nothing(viewer_client: TestClient) -> None:
    assert listed(viewer_client) == {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 50,
        "totals": [],
    }


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"account_id": "card"}, ["Blue Bottle", "Hardware Store"]),
        ({"category_id": "coffee"}, ["Blue Bottle"]),
        ({"category_id": ["coffee", "groceries"]}, ["Blue Bottle", "Whole Foods"]),
        ({"uncategorized": True}, ["Hardware Store", "Parkside Apartments"]),
        (
            {"category_id": "groceries", "uncategorized": True},
            ["Whole Foods", "Hardware Store", "Parkside Apartments"],
        ),
        ({"start": days_ago(7), "end": days_ago(2)}, ["Whole Foods", "Hardware Store"]),
        ({"start": days_ago(3)}, ["Blue Bottle", "Whole Foods"]),
        ({"end": days_ago(14)}, ["Acme Corp", "Parkside Apartments"]),
        ({"direction": "in"}, ["Hardware Store", "Acme Corp"]),
        ({"direction": "out"}, ["Blue Bottle", "Whole Foods", "Parkside Apartments"]),
        ({"status": "pending"}, ["Blue Bottle"]),
        (
            {"status": "posted"},
            ["Whole Foods", "Hardware Store", "Acme Corp", "Parkside Apartments"],
        ),
        ({"source": "plaid"}, ["Blue Bottle", "Hardware Store"]),
        (
            {"source": ["manual", "file"]},
            ["Whole Foods", "Acme Corp", "Parkside Apartments"],
        ),
        # Amounts count however the money went.
        (
            {"min_amount": "18.20"},
            ["Whole Foods", "Hardware Store", "Acme Corp", "Parkside Apartments"],
        ),
        ({"max_amount": "84.12"}, ["Blue Bottle", "Whole Foods", "Hardware Store"]),
        ({"min_amount": "5", "max_amount": "100", "direction": "out"}, ["Whole Foods"]),
        (
            {"account_id": ["checking", "card"], "direction": "in", "start": days_ago(10)},
            ["Hardware Store"],
        ),
    ],
)
def test_filters_narrow_the_list(
    viewer_client: TestClient,
    household: dict[str, Any],
    params: dict[str, str | bool | dt.date | list[str]],
    expected: list[str],
) -> None:
    def resolve(value: str | bool | dt.date | list[str]) -> Any:
        if isinstance(value, list):
            return [resolve(item) for item in value]
        if isinstance(value, str) and value in household:
            return str(household[value].id)
        return value

    resolved = {key: resolve(value) for key, value in params.items()}

    assert payees(viewer_client, **resolved) == expected


def test_filtered_totals_add_up_only_what_matches(
    viewer_client: TestClient, household: dict[str, Any]
) -> None:
    page = listed(viewer_client, account_id=str(household["card"].id))

    assert page["total"] == 2
    assert page["totals"] == [
        {"currency": "USD", "count": 2, "money_in": "18.20", "money_out": "-4.50"}
    ]


@pytest.mark.parametrize(
    ("q", "expected"),
    [
        # The payee, the bank's description, the notes and the category's name.
        ("whole", ["Whole Foods"]),
        ("wholefds mkt", ["Whole Foods"]),
        ("drill", ["Hardware Store"]),
        ("paycheck", ["Acme Corp"]),
        ("COFFEE", ["Blue Bottle"]),
        # Amounts, however they're typed and whichever way the money went.
        ("84.12", ["Whole Foods"]),
        ("$1,650", ["Parkside Apartments"]),
        ("-18.2", ["Hardware Store"]),
        ("2400", ["Acme Corp"]),
        # Wildcards are just characters.
        ("%", []),
        ("_", []),
        ("nothing like this", []),
    ],
)
def test_search_looks_everywhere(
    viewer_client: TestClient, household: dict[str, Any], q: str, expected: list[str]
) -> None:
    assert payees(viewer_client, q=q) == expected


def test_search_treats_backslashes_as_text(
    viewer_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    add_transaction(session, household["checking"], "-1.00", "Back\\slash Books")

    assert payees(viewer_client, q="k\\s") == ["Back\\slash Books"]


@pytest.mark.parametrize(
    ("text", "amount"),
    [
        ("42", Decimal("42.0")),
        ("42.5", Decimal("42.5")),
        (" $1,234.56 ", Decimal("1234.56")),
        ("-€18.20", Decimal("18.20")),
        ("+ 7", Decimal("7.0")),
        ("1,234,567,890", Decimal("1234567890.0")),
        ("12,34", None),
        ("4.2.1", None),
        ("1.234", None),
        ("coffee", None),
        ("1,234,567,890,123", None),
    ],
)
def test_amounts_people_search_for(text: str, amount: Decimal | None) -> None:
    assert searched_amount(text) == amount


@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        (
            "date",
            ["Parkside Apartments", "Acme Corp", "Hardware Store", "Whole Foods", "Blue Bottle"],
        ),
        (
            "amount",
            ["Parkside Apartments", "Whole Foods", "Blue Bottle", "Hardware Store", "Acme Corp"],
        ),
        (
            "-amount",
            ["Acme Corp", "Hardware Store", "Blue Bottle", "Whole Foods", "Parkside Apartments"],
        ),
        (
            "payee",
            ["Acme Corp", "Blue Bottle", "Hardware Store", "Parkside Apartments", "Whole Foods"],
        ),
        (
            "-payee",
            ["Whole Foods", "Parkside Apartments", "Hardware Store", "Blue Bottle", "Acme Corp"],
        ),
    ],
)
def test_sorting(
    viewer_client: TestClient, household: dict[str, Any], sort: str, expected: list[str]
) -> None:
    assert payees(viewer_client, sort=sort) == expected


def test_ties_are_broken_newest_first(viewer_client: TestClient, session: Session) -> None:
    account = add_account(session)
    added = utcnow() - dt.timedelta(hours=1)
    for minutes, payee in enumerate(("First", "Second", "Third")):
        created_at = added + dt.timedelta(minutes=minutes)
        add_transaction(session, account, "-5.00", payee, created_at=created_at)

    assert payees(viewer_client, sort="amount") == ["Third", "Second", "First"]
    assert payees(viewer_client, sort="date") == ["First", "Second", "Third"]


def test_totals_are_kept_apart_by_currency(viewer_client: TestClient, session: Session) -> None:
    dollars = add_account(session)
    euros = add_account(session, "Euro account", currency="EUR")
    add_transaction(session, dollars, "-10.00")
    add_transaction(session, euros, "-20.00")
    add_transaction(session, euros, "5.00")

    page = listed(viewer_client)

    assert page["total"] == 3
    assert page["totals"] == [
        {"currency": "EUR", "count": 2, "money_in": "5.00", "money_out": "-20.00"},
        {"currency": "USD", "count": 1, "money_in": "0.00", "money_out": "-10.00"},
    ]


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-09-10", "end": "2026-09-01"},
        {"min_amount": "50", "max_amount": "10"},
        {"min_amount": "-5"},
        {"page": 0},
        {"page_size": 201},
        {"sort": "category"},
        {"direction": "sideways"},
        {"q": "x" * 101},
        {"account_id": "not-an-id"},
        {"colour": "blue"},
    ],
)
def test_list_requests_are_checked(viewer_client: TestClient, params: dict[str, Any]) -> None:
    assert viewer_client.get("/api/transactions", params=params).status_code == 422


# ---- Payee suggestions -----------------------------------------------------------------


def test_payees_come_most_used_first_with_their_latest_category(
    viewer_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    checking = household["checking"]
    add_transaction(session, checking, "-60.00", "Whole Foods", date=days_ago(20))
    # The newest one decides the suggested category, even without one.
    add_transaction(session, checking, "-12.00", "Trader Joe's", date=days_ago(30))
    add_transaction(
        session,
        checking,
        "-14.00",
        "Trader Joe's",
        date=days_ago(2),
        category_id=household["groceries"].id,
    )
    add_transaction(session, checking, "-3.00", "Trader Joe's", date=days_ago(1))

    suggestions = viewer_client.get("/api/transactions/payees").json()

    assert suggestions[:2] == [
        {"payee": "Trader Joe's", "category_id": None, "count": 3},
        {"payee": "Whole Foods", "category_id": str(household["groceries"].id), "count": 2},
    ]
    assert len(suggestions) == 6


def test_payees_that_start_with_the_text_come_first(
    viewer_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    checking = household["checking"]
    for _ in range(3):
        add_transaction(session, checking, "-1.00", "The Coffee Bar")
    add_transaction(session, checking, "-1.00", "Coffee Collective")

    suggestions = viewer_client.get("/api/transactions/payees", params={"q": " coffee "}).json()

    assert [item["payee"] for item in suggestions] == ["Coffee Collective", "The Coffee Bar"]
    limited = viewer_client.get("/api/transactions/payees", params={"limit": 1}).json()
    assert [item["payee"] for item in limited] == ["The Coffee Bar"]


# ---- Adding ----------------------------------------------------------------------------


def new(account: Account, **overrides: Any) -> dict[str, Any]:
    body = {
        "account_id": str(account.id),
        "date": TODAY.isoformat(),
        "amount": "-42.50",
        "payee": "  Corner Market ",
    }
    return body | overrides


def test_an_admin_adds_a_transaction_and_the_balance_follows(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    checking = household["checking"]
    response = admin_client.post(
        "/api/transactions",
        json=new(checking, category_id=str(household["groceries"].id), notes=" Party food "),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["payee"] == "Corner Market"
    assert body["amount"] == "-42.50"
    assert body["notes"] == "Party food"
    assert body["category_id"] == str(household["groceries"].id)
    assert (body["source"], body["pending"], body["original_description"]) == (
        "manual",
        False,
        None,
    )
    assert balance(session, checking) == Decimal("957.50")
    assert admin_client.get(f"/api/transactions/{body['id']}").json() == body


def test_money_coming_in_raises_the_balance(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    checking = household["checking"]
    admin_client.post("/api/transactions", json=new(checking, amount="100", notes=""))

    assert balance(session, checking) == Decimal("1100.00")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("amount", "0"),
        ("amount", "0.001"),
        ("amount", "1000000000000"),
        ("date", "1969-12-31"),
        ("date", "2999-01-01"),
        ("date", "yesterday"),
        ("payee", "   "),
        ("payee", "x" * 161),
        ("notes", "x" * 1001),
        ("source", "plaid"),
        ("pending", True),
    ],
)
def test_new_transactions_are_checked(
    admin_client: TestClient, household: dict[str, Any], field: str, value: Any
) -> None:
    response = admin_client.post(
        "/api/transactions", json=new(household["checking"], **{field: value})
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == field


def test_the_messages_for_zero_and_distant_dates_read_well(
    admin_client: TestClient, household: dict[str, Any]
) -> None:
    for field, value, message in [
        ("amount", "0.00", "Enter an amount other than zero."),
        ("date", "1901-01-01", "Choose a date between 1970 and a year from now."),
    ]:
        response = admin_client.post(
            "/api/transactions", json=new(household["checking"], **{field: value})
        )
        assert response.json()["detail"][0]["msg"] == message


def test_transactions_need_an_account_people_keep_themselves(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    closed = add_account(session, "Old checking", closed_at=utcnow())
    for account_id, code in [
        (household["card"].id, "linked_account"),
        (closed.id, "account_closed"),
        (uuid.uuid4(), "unknown_account"),
    ]:
        response = admin_client.post(
            "/api/transactions", json=new(household["checking"], account_id=str(account_id))
        )
        assert error(response) == code
    assert balance(session, household["card"]) == Decimal("-612.40")


def test_the_category_has_to_exist(admin_client: TestClient, household: dict[str, Any]) -> None:
    response = admin_client.post(
        "/api/transactions",
        json=new(household["checking"], category_id=str(uuid.uuid4())),
    )

    assert response.status_code == 422
    assert error(response) == "unknown_category"


def test_viewers_cannot_change_transactions(
    viewer_client: TestClient, household: dict[str, Any]
) -> None:
    transaction = household["shop"]
    ids = {"ids": [str(transaction.id)]}
    for method, path, body in [
        ("POST", "/api/transactions", new(household["checking"])),
        ("PATCH", f"/api/transactions/{transaction.id}", {"payee": "Mine"}),
        ("DELETE", f"/api/transactions/{transaction.id}", None),
        ("POST", "/api/transactions/bulk/delete", ids),
        ("POST", "/api/transactions/bulk/categorize", ids | {"category_id": None}),
    ]:
        response = viewer_client.request(method, path, json=body)
        assert response.status_code == 403
        assert error(response) == "admin_only"


def test_missing_transactions_are_not_found(admin_client: TestClient) -> None:
    missing = uuid.uuid4()
    for method, body in [("GET", None), ("PATCH", {"payee": "Found"}), ("DELETE", None)]:
        response = admin_client.request(method, f"/api/transactions/{missing}", json=body)
        assert response.status_code == 404
        assert error(response) == "not_found"


# ---- Editing ---------------------------------------------------------------------------


def edit(client: TestClient, transaction: Transaction, **changes: Any) -> dict[str, Any]:
    response = client.patch(f"/api/transactions/{transaction.id}", json=changes)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_editing_a_transaction_moves_the_balance_by_the_difference(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    body = edit(
        admin_client,
        household["shop"],
        amount="-100.00",
        date=days_ago(4).isoformat(),
        payee="Whole Foods Market",
        category_id=str(household["coffee"].id),
        notes="Big shop",
    )

    assert (body["amount"], body["date"], body["payee"]) == (
        "-100.00",
        days_ago(4).isoformat(),
        "Whole Foods Market",
    )
    assert (body["category_id"], body["notes"]) == (str(household["coffee"].id), "Big shop")
    # 84.12 came out before; 100.00 comes out now.
    assert balance(session, household["checking"]) == Decimal("984.12")


def test_the_category_and_notes_can_be_cleared(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    body = edit(admin_client, household["refund"], category_id=None, notes=None)
    assert (body["category_id"], body["notes"]) == (None, None)

    # Leaving them out keeps them.
    body = edit(admin_client, household["shop"], payee="Whole Foods")
    assert body["category_id"] == str(household["groceries"].id)
    assert balance(session, household["checking"]) == Decimal("1000.00")


def test_moving_a_transaction_moves_its_money_between_accounts(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    wallet = add_account(session, "Wallet", type=AccountType.CASH, balance="50.00")

    body = edit(admin_client, household["shop"], account_id=str(wallet.id), amount="-20.00")

    assert body["account_id"] == str(wallet.id)
    assert balance(session, household["checking"]) == Decimal("1084.12")
    assert balance(session, wallet) == Decimal("30.00")


def test_transactions_only_move_to_accounts_people_keep(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    closed = add_account(session, "Old checking", closed_at=utcnow())
    path = f"/api/transactions/{household['shop'].id}"
    for account_id, code in [
        (household["card"].id, "linked_account"),
        (closed.id, "account_closed"),
        (uuid.uuid4(), "unknown_account"),
    ]:
        assert error(admin_client.patch(path, json={"account_id": str(account_id)})) == code
    assert error(admin_client.patch(path, json={"category_id": str(uuid.uuid4())})) == (
        "unknown_category"
    )
    assert balance(session, household["checking"]) == Decimal("1000.00")


def test_plaid_keeps_a_synced_transactions_money_and_date(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    coffee = household["latte"]

    body = edit(
        admin_client,
        coffee,
        payee="Blue Bottle Coffee",
        category_id=None,
        notes="Meeting",
        # Sent back unchanged, as a form would.
        amount="-4.5",
        date=coffee.date.isoformat(),
        account_id=str(coffee.account_id),
    )
    assert (body["payee"], body["category_id"], body["notes"]) == (
        "Blue Bottle Coffee",
        None,
        "Meeting",
    )

    wallet = add_account(session, "Wallet", type=AccountType.CASH)
    for change in [
        {"amount": "-5.00"},
        {"date": days_ago(9).isoformat()},
        {"account_id": str(wallet.id)},
    ]:
        response = admin_client.patch(f"/api/transactions/{coffee.id}", json=change)
        assert response.status_code == 409
        assert error(response) == "from_bank"
    assert balance(session, household["card"]) == Decimal("-612.40")


def test_edits_in_a_linked_account_leave_its_balance_to_the_bank(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    # Imported from a file into what's now a linked account: the bank still owns the balance.
    imported = add_transaction(
        session, household["card"], "-30.00", "Gift shop", source=TransactionSource.FILE
    )

    edit(admin_client, imported, amount="-35.00")

    assert balance(session, household["card"]) == Decimal("-612.40")


# ---- Removing --------------------------------------------------------------------------


def test_deleting_a_transaction_takes_it_out_of_the_balance(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    for name in ("shop", "latte"):
        response = admin_client.delete(f"/api/transactions/{household[name].id}")
        assert response.status_code == 204

    assert balance(session, household["checking"]) == Decimal("1084.12")
    # The bank reports the card's balance, so it stays.
    assert balance(session, household["card"]) == Decimal("-612.40")
    assert payees(admin_client) == ["Hardware Store", "Acme Corp", "Parkside Apartments"]


def test_deleting_several_transactions_at_once(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    wallet = add_account(session, "Wallet", type=AccountType.CASH, balance="40.00")
    snack = add_transaction(session, wallet, "-6.00", "Vending machine")
    ids = [household[name].id for name in ("shop", "paycheck", "latte")] + [snack.id]

    response = admin_client.post(
        "/api/transactions/bulk/delete",
        json={"ids": [str(item) for item in [*ids, uuid.uuid4()]]},
    )

    assert response.json() == {"count": 4}
    assert balance(session, household["checking"]) == Decimal("-1315.88")
    assert balance(session, wallet) == Decimal("46.00")
    assert balance(session, household["card"]) == Decimal("-612.40")
    assert payees(admin_client) == ["Hardware Store", "Parkside Apartments"]


def test_categorizing_several_transactions_at_once(
    admin_client: TestClient, session: Session, household: dict[str, Any]
) -> None:
    ids = [str(household[name].id) for name in ("refund", "rent")] + [str(uuid.uuid4())]
    groceries = str(household["groceries"].id)

    response = admin_client.post(
        "/api/transactions/bulk/categorize", json={"ids": ids, "category_id": groceries}
    )

    assert response.json() == {"count": 2}
    assert payees(admin_client, category_id=groceries) == [
        "Whole Foods",
        "Hardware Store",
        "Parkside Apartments",
    ]
    cleared = admin_client.post(
        "/api/transactions/bulk/categorize", json={"ids": ids[:1], "category_id": None}
    )
    assert cleared.json() == {"count": 1}
    session.expire_all()
    assert (
        session.scalar(
            select(Transaction.category_id).where(Transaction.id == household["refund"].id)
        )
        is None
    )


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/transactions/bulk/delete", {"ids": []}),
        ("/api/transactions/bulk/delete", {"ids": [str(uuid.uuid4())] * 501}),
        ("/api/transactions/bulk/categorize", {"ids": [str(uuid.uuid4())]}),
    ],
)
def test_bulk_requests_are_checked(
    admin_client: TestClient, path: str, body: dict[str, Any]
) -> None:
    assert admin_client.post(path, json=body).status_code == 422


def test_bulk_categorizing_needs_a_real_category(
    admin_client: TestClient, household: dict[str, Any]
) -> None:
    response = admin_client.post(
        "/api/transactions/bulk/categorize",
        json={"ids": [str(household["rent"].id)], "category_id": str(uuid.uuid4())},
    )

    assert error(response) == "unknown_category"
