import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import categories as categories_api
from app.finance.categories import SUGGESTED
from app.models import Category, CategoryGroup, CategoryKind, Transaction
from tests.finance import add_account, add_category, add_group, add_transaction
from tests.helpers import error

SUGGESTED_COUNT = sum(len(group.categories) for group in SUGGESTED)


def names(groups: list[dict[str, Any]]) -> list[tuple[str, list[str]]]:
    return [(group["name"], [item["name"] for item in group["categories"]]) for group in groups]


def listed(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/categories")
    assert response.status_code == 200, response.text
    groups: list[dict[str, Any]] = response.json()
    return groups


def category_of(session: Session, transaction: Transaction) -> uuid.UUID | None:
    session.expire_all()
    return session.scalar(select(Transaction.category_id).where(Transaction.id == transaction.id))


def test_everyone_sees_income_then_spending_then_transfers(
    viewer_client: TestClient, session: Session
) -> None:
    food = add_group(session, "Food & drink")
    groceries = add_category(session, "Groceries", food, "🛒")
    add_category(session, "coffee", food, "☕")
    add_group(session, "bills", CategoryKind.EXPENSE)
    transfers = add_group(session, "Transfers", CategoryKind.TRANSFER)
    add_category(session, "Transfers", transfers, "🔁")
    income = add_group(session, "Income", CategoryKind.INCOME)
    add_category(session, "Paycheck", income, "💼")
    account = add_account(session)
    add_transaction(session, account, "-12.00", category_id=groceries.id)
    add_transaction(session, account, "-40.00", category_id=groceries.id)

    groups = listed(viewer_client)

    assert names(groups) == [
        ("Income", ["Paycheck"]),
        ("bills", []),
        ("Food & drink", ["coffee", "Groceries"]),
        ("Transfers", ["Transfers"]),
    ]
    assert [group["kind"] for group in groups] == ["income", "expense", "expense", "transfer"]
    assert groups[2]["categories"][1] == {
        "id": str(groceries.id),
        "group_id": str(food.id),
        "name": "Groceries",
        "emoji": "🛒",
        "transaction_count": 2,
    }
    assert groups[2]["categories"][0]["transaction_count"] == 0


def test_signing_in_is_needed_to_see_categories(client: TestClient) -> None:
    assert error(client.get("/api/categories")) == "not_signed_in"


# ---- Suggested categories --------------------------------------------------------------


def test_the_suggested_categories_are_added_once(admin_client: TestClient) -> None:
    response = admin_client.post("/api/categories/suggested")

    assert response.status_code == 200
    body = response.json()
    assert body["added"] == SUGGESTED_COUNT
    assert len(body["groups"]) == len(SUGGESTED)
    assert body["groups"][0]["name"] == "Income"
    assert body["groups"][-1]["name"] == "Transfers"
    food = next(group for group in body["groups"] if group["name"] == "Food & drink")
    assert [(item["emoji"], item["name"]) for item in food["categories"]] == [
        ("☕", "Coffee"),
        ("🛒", "Groceries"),
        ("🍽️", "Restaurants"),
    ]

    again = admin_client.post("/api/categories/suggested").json()
    assert again["added"] == 0
    assert again["groups"] == body["groups"]


def test_only_missing_suggestions_come_back(admin_client: TestClient, session: Session) -> None:
    # Renamed groups and categories keep their new names; whatever's missing is added back.
    food = add_group(session, "FOOD & DRINK")
    add_category(session, "groceries", food)
    income = add_group(session, "Earnings", CategoryKind.INCOME)
    for name in ("Paycheck", "Interest & dividends", "Other income"):
        add_category(session, name, income)

    body = admin_client.post("/api/categories/suggested").json()

    assert body["added"] == SUGGESTED_COUNT - 4
    listed_names = dict(names(body["groups"]))
    assert listed_names["FOOD & DRINK"] == ["Coffee", "groceries", "Restaurants"]
    # Every income category exists, so no empty Income group appears beside Earnings.
    assert "Income" not in listed_names
    assert session.scalar(select(func.count()).select_from(Category)) == SUGGESTED_COUNT


# ---- Groups ----------------------------------------------------------------------------


def test_an_admin_adds_groups(admin_client: TestClient) -> None:
    response = admin_client.post("/api/categories/groups", json={"name": "  Hobbies "})

    assert response.status_code == 201
    body = response.json()
    assert (body["name"], body["kind"], body["categories"]) == ("Hobbies", "expense", [])

    side = admin_client.post("/api/categories/groups", json={"name": "Side gigs", "kind": "income"})
    assert side.json()["kind"] == "income"
    assert names(listed(admin_client)) == [("Side gigs", []), ("Hobbies", [])]


def test_group_names_are_unique_whatever_their_case(
    admin_client: TestClient, session: Session
) -> None:
    add_group(session, "Food & drink")

    response = admin_client.post("/api/categories/groups", json={"name": "FOOD & DRINK"})

    assert response.status_code == 409
    assert error(response) == "name_taken"
    assert response.json()["detail"]["message"] == "There's already a group called Food & drink."


def test_an_admin_renames_a_group_and_changes_its_kind(
    admin_client: TestClient, session: Session
) -> None:
    group = add_group(session, "Food & drink")
    add_category(session, "Groceries", group)
    add_group(session, "Shopping")
    path = f"/api/categories/groups/{group.id}"

    # Only the case changes, which doesn't clash with itself.
    body = admin_client.patch(path, json={"name": "Food & Drink"}).json()
    assert body["name"] == "Food & Drink"
    assert [item["name"] for item in body["categories"]] == ["Groceries"]

    body = admin_client.patch(path, json={"name": "Eating", "kind": "transfer"}).json()
    assert (body["name"], body["kind"]) == ("Eating", "transfer")
    # Leaving everything out, or sending the same name, keeps it.
    assert admin_client.patch(path, json={}).json() == body
    assert admin_client.patch(path, json={"name": "Eating"}).json() == body

    taken = admin_client.patch(path, json={"name": "shopping"})
    assert error(taken) == "name_taken"


def test_deleting_a_group_uncategorizes_its_transactions(
    admin_client: TestClient, session: Session
) -> None:
    group = add_group(session)
    groceries = add_category(session, "Groceries", group)
    kept = add_category(session, "Rent")
    account = add_account(session)
    shop = add_transaction(session, account, "-50.00", category_id=groceries.id)
    rent = add_transaction(session, account, "-900.00", category_id=kept.id)

    response = admin_client.delete(f"/api/categories/groups/{group.id}")

    assert response.status_code == 204
    assert category_of(session, shop) is None
    assert category_of(session, rent) == kept.id
    assert names(listed(admin_client)) == [("Rent group", ["Rent"])]


# ---- Categories ------------------------------------------------------------------------


def test_an_admin_adds_categories(admin_client: TestClient, session: Session) -> None:
    group = add_group(session, "Hobbies")

    response = admin_client.post(
        "/api/categories", json={"group_id": str(group.id), "name": " Board games ", "emoji": "🎲"}
    )

    assert response.status_code == 201
    body = response.json()
    assert (body["name"], body["emoji"], body["group_id"]) == ("Board games", "🎲", str(group.id))
    assert body["transaction_count"] == 0
    plain = admin_client.post("/api/categories", json={"group_id": str(group.id), "name": "Yarn"})
    assert plain.json()["emoji"] == "🏷️"


def test_category_names_are_unique_whatever_their_case(
    admin_client: TestClient, session: Session
) -> None:
    add_category(session, "Groceries")
    other = add_group(session, "Other")

    response = admin_client.post(
        "/api/categories", json={"group_id": str(other.id), "name": "groceries"}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["message"] == "There's already a category called Groceries."


def test_an_admin_edits_a_category(admin_client: TestClient, session: Session) -> None:
    food = add_group(session, "Food & drink")
    coffee = add_category(session, "Coffee", food, "☕")
    add_category(session, "Groceries", food)
    treats = add_group(session, "Treats")
    add_transaction(session, add_account(session), "-4.50", category_id=coffee.id)
    path = f"/api/categories/{coffee.id}"

    body = admin_client.patch(path, json={"name": "coffee"}).json()
    assert body["name"] == "coffee"

    body = admin_client.patch(
        path, json={"name": "Coffee shops", "emoji": "🫖", "group_id": str(treats.id)}
    ).json()
    assert body == {
        "id": str(coffee.id),
        "group_id": str(treats.id),
        "name": "Coffee shops",
        "emoji": "🫖",
        "transaction_count": 1,
    }
    assert admin_client.patch(path, json={}).json() == body
    assert admin_client.patch(path, json={"name": "Coffee shops"}).json() == body
    assert error(admin_client.patch(path, json={"name": "GROCERIES"})) == "name_taken"
    missing_group = admin_client.patch(path, json={"group_id": str(uuid.uuid4())})
    assert error(missing_group) == "not_found"


def test_deleting_a_category_uncategorizes_or_moves_its_transactions(
    admin_client: TestClient, session: Session
) -> None:
    food = add_group(session)
    coffee = add_category(session, "Coffee", food)
    cafes = add_category(session, "Cafes", food)
    snacks = add_category(session, "Snacks", food)
    account = add_account(session)
    latte = add_transaction(session, account, "-4.50", category_id=coffee.id)
    chips = add_transaction(session, account, "-2.00", category_id=snacks.id)

    moved = admin_client.delete(f"/api/categories/{coffee.id}", params={"move_to": str(cafes.id)})
    assert moved.status_code == 204
    assert category_of(session, latte) == cafes.id

    assert admin_client.delete(f"/api/categories/{snacks.id}").status_code == 204
    assert category_of(session, chips) is None
    assert names(listed(admin_client)) == [("Food & drink", ["Cafes"])]


def test_transactions_move_to_another_real_category(
    admin_client: TestClient, session: Session
) -> None:
    coffee = add_category(session, "Coffee")
    path = f"/api/categories/{coffee.id}"

    same = admin_client.delete(path, params={"move_to": str(coffee.id)})
    assert same.status_code == 422
    assert error(same) == "same_category"
    unknown = admin_client.delete(path, params={"move_to": str(uuid.uuid4())})
    assert error(unknown) == "unknown_category"
    assert session.get(Category, coffee.id) is not None


def test_two_admins_naming_things_at_once_get_a_clear_answer(
    admin_client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Both requests passed the check before either saved, so the database has the last word.
    def no_check(*args: object) -> None:
        return None

    monkeypatch.setattr(categories_api, "_ensure_unique", no_check)
    group = add_group(session, "Food & drink")
    add_category(session, "Groceries", group)

    for path, body in [
        ("/api/categories/groups", {"name": "Food & drink"}),
        ("/api/categories", {"group_id": str(group.id), "name": "Groceries"}),
    ]:
        response = admin_client.post(path, json=body)
        assert response.status_code == 409
        assert error(response) == "name_taken"
    assert session.scalar(select(func.count()).select_from(CategoryGroup)) == 1


@pytest.mark.parametrize(
    ("path", "body", "field"),
    [
        ("/api/categories/groups", {"name": " "}, "name"),
        ("/api/categories/groups", {"name": "x" * 61}, "name"),
        ("/api/categories/groups", {"name": "Fun", "kind": "savings"}, "kind"),
        ("/api/categories/groups", {"name": "Fun", "colour": "red"}, "colour"),
        ("/api/categories", {"group_id": "", "name": "Fun"}, "group_id"),
        ("/api/categories", {"group_id": str(uuid.uuid4()), "name": ""}, "name"),
        (
            "/api/categories",
            {"group_id": str(uuid.uuid4()), "name": "Fun", "emoji": "a b"},
            "emoji",
        ),
        ("/api/categories", {"group_id": str(uuid.uuid4()), "name": "Fun", "emoji": ""}, "emoji"),
    ],
)
def test_names_and_emoji_are_checked(
    admin_client: TestClient, path: str, body: dict[str, str], field: str
) -> None:
    response = admin_client.post(path, json=body)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == field


def test_viewers_cannot_change_categories(viewer_client: TestClient, session: Session) -> None:
    group = add_group(session)
    category = add_category(session, "Groceries", group)
    for method, path, body in [
        ("POST", "/api/categories/suggested", None),
        ("POST", "/api/categories/groups", {"name": "Mine"}),
        ("PATCH", f"/api/categories/groups/{group.id}", {"name": "Mine"}),
        ("DELETE", f"/api/categories/groups/{group.id}", None),
        ("POST", "/api/categories", {"group_id": str(group.id), "name": "Mine"}),
        ("PATCH", f"/api/categories/{category.id}", {"name": "Mine"}),
        ("DELETE", f"/api/categories/{category.id}", None),
    ]:
        response = viewer_client.request(method, path, json=body)
        assert response.status_code == 403
        assert error(response) == "admin_only"


def test_missing_categories_and_groups_are_not_found(admin_client: TestClient) -> None:
    missing = uuid.uuid4()
    for method, path, body in [
        ("PATCH", f"/api/categories/groups/{missing}", {"name": "Found"}),
        ("DELETE", f"/api/categories/groups/{missing}", None),
        ("POST", "/api/categories", {"group_id": str(missing), "name": "Found"}),
        ("PATCH", f"/api/categories/{missing}", {"name": "Found"}),
        ("DELETE", f"/api/categories/{missing}", None),
    ]:
        response = admin_client.request(method, path, json=body)
        assert response.status_code == 404
        assert error(response) == "not_found"
