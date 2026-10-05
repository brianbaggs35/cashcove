"""Automations that are exact about what they sort: the way the money went, and what someone chose
by hand."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Account, Transaction
from tests.finance import TODAY, add_account, add_transaction
from tests.helpers import error
from tests.test_automations_api import category, create, patch, payload, post_payment, reload
from tests.test_budget_api import make_budget

# ---- Which way the money went --------------------------------------------------------------


def acme(session: Session) -> tuple[Account, Transaction, Transaction]:
    """An employer that pays, and a shop of the same name that is paid."""
    account = add_account(session)
    pay = add_transaction(session, account, "2500.00", "ACME PAYROLL")
    shop = add_transaction(session, account, "-45.00", "ACME STORE PURCHASE")
    return account, pay, shop


def test_an_automation_for_money_in_leaves_what_was_spent_alone(
    admin_client: TestClient, session: Session
) -> None:
    _, pay, shop = acme(session)
    paycheck = category(session, "Paycheck", "Income")

    created = create(
        admin_client,
        payload(
            name="Paycheck",
            payees=["acme"],
            match="contains",
            direction="in",
            category_id=str(paycheck.id),
        ),
    )

    assert (created["direction"], created["applied"], created["matching_count"]) == ("in", 1, 1)
    assert reload(session, pay).category_id == paycheck.id
    assert reload(session, shop).category_id is None


def test_an_automation_for_money_out_leaves_what_came_in_alone(
    admin_client: TestClient, session: Session
) -> None:
    _, pay, shop = acme(session)
    shopping = category(session, "Shopping", "Spending")

    created = create(
        admin_client,
        payload(payees=["acme"], match="contains", direction="out", category_id=str(shopping.id)),
    )

    assert (created["direction"], created["applied"]) == ("out", 1)
    assert reload(session, shop).category_id == shopping.id
    assert reload(session, pay).category_id is None


def test_an_automation_is_for_either_way_unless_it_says_otherwise(
    admin_client: TestClient, session: Session
) -> None:
    _, pay, shop = acme(session)
    anything = category(session, "Anything", "Other")

    created = create(
        admin_client, payload(payees=["acme"], match="contains", category_id=str(anything.id))
    )

    assert (created["direction"], created["applied"]) == ("any", 2)
    assert reload(session, pay).category_id == anything.id
    assert reload(session, shop).category_id == anything.id
    assert admin_client.get("/api/automations").json()[0]["direction"] == "any"


def test_what_arrives_later_is_sorted_by_the_way_the_money_went(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    paycheck = category(session, "Paycheck", "Income")
    create(
        admin_client,
        payload(
            payees=["acme"],
            match="contains",
            direction="in",
            category_id=str(paycheck.id),
            apply_to="future",
        ),
    )

    paid = post_payment(admin_client, account, "Acme Payroll", "2500.00")
    spent = post_payment(admin_client, account, "Acme Store", "-45.00")

    assert (paid["category_id"], spent["category_id"]) == (str(paycheck.id), None)


def test_a_transaction_that_changes_which_way_it_went_is_sorted_again(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    paycheck = category(session, "Paycheck", "Income")
    create(
        admin_client,
        payload(payees=["acme"], direction="in", category_id=str(paycheck.id), apply_to="future"),
    )
    refund = post_payment(admin_client, account, "Acme", "-45.00")
    assert refund["category_id"] is None

    response = admin_client.patch(f"/api/transactions/{refund['id']}", json={"amount": "45.00"})

    assert response.json()["category_id"] == str(paycheck.id)


def test_changing_the_direction_sorts_what_it_now_finds(
    admin_client: TestClient, session: Session
) -> None:
    _, pay, shop = acme(session)
    paycheck = category(session, "Paycheck", "Income")
    created = create(
        admin_client,
        payload(payees=["acme"], match="contains", direction="in", category_id=str(paycheck.id)),
    )
    assert reload(session, shop).category_id is None

    changed = patch(admin_client, created, direction="any")

    assert (changed["direction"], changed["applied"]) == ("any", 1)
    assert reload(session, shop).category_id == paycheck.id
    # And back: what it sorted stays, as it does when anything else about it changes.
    assert patch(admin_client, created, direction="in")["applied"] == 0
    assert reload(session, pay).category_id == paycheck.id


def test_a_preview_counts_what_goes_the_way_asked(
    admin_client: TestClient, session: Session
) -> None:
    acme(session)

    def matching(direction: str) -> int:
        response = admin_client.post(
            "/api/automations/preview",
            json={"payees": ["acme"], "match": "contains", "direction": direction},
        )
        assert response.status_code == 200, response.text
        return int(response.json()["matching"])

    assert [matching(direction) for direction in ("any", "in", "out")] == [2, 1, 1]


def test_automations_for_the_same_text_only_overlap_in_the_same_direction(
    admin_client: TestClient, session: Session
) -> None:
    acme(session)
    income = category(session, "Paycheck", "Income")
    create(
        admin_client,
        payload(payees=["acme"], match="contains", direction="in", category_id=str(income.id)),
    )

    def overlaps(direction: str) -> list[int]:
        preview = admin_client.post(
            "/api/automations/preview",
            json={
                "payees": ["acme"],
                "match": "contains",
                "direction": direction,
                "category": True,
            },
        ).json()
        return [overlap["count"] for overlap in preview["overlaps"]]

    assert overlaps("out") == []
    assert overlaps("in") == [1]
    assert overlaps("any") == [1]


def test_a_budget_counts_only_the_way_the_money_went_that_an_automation_looks_for(
    admin_client: TestClient, session: Session
) -> None:
    acme(session)
    monthly = make_budget(admin_client)
    create(
        admin_client,
        {
            "name": "Paycheck",
            "payees": ["acme"],
            "match": "contains",
            "direction": "in",
            "counts": [{"budget_id": monthly["id"], "kind": "income"}],
        },
    )

    counted = admin_client.get(
        f"/api/budgets/{monthly['id']}/transactions", params={"today": TODAY.isoformat()}
    ).json()

    assert [(item["payee"], item["amount"], item["kind"]) for item in counted["items"]] == [
        ("ACME PAYROLL", "2500.00", "income")
    ]


def test_money_coming_in_cannot_be_linked_to_a_subscription_or_a_bill(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    bill = admin_client.post(
        "/api/bills",
        json={
            "name": "Power",
            "payee": "City Power",
            "amount": "96.40",
            "frequency": "monthly",
            "account_id": str(account.id),
            "next_due_date": TODAY.isoformat(),
        },
    ).json()

    refused = admin_client.post(
        "/api/automations",
        json=payload(direction="in", subscription_id=bill["id"]),
    )
    assert refused.status_code == 422
    assert "which is money going out" in refused.text

    created = create(admin_client, payload(direction="out", subscription_id=bill["id"]))
    changed = admin_client.patch(f"/api/automations/{created['id']}", json={"direction": "in"})
    assert (changed.status_code, error(changed)) == (422, "money_in_link")
    # Moving it to another way round first, or taking the link off, is fine.
    assert patch(admin_client, created, direction="any")["direction"] == "any"
    assert (
        patch(
            admin_client,
            created,
            direction="in",
            subscription_id=None,
            counts=[{"budget_id": make_budget(admin_client)["id"], "kind": "income"}],
        )["direction"]
        == "in"
    )


@pytest.mark.parametrize("direction", ["sideways", "", 1])
def test_a_direction_has_to_be_one_the_app_knows(
    admin_client: TestClient, session: Session, direction: Any
) -> None:
    streaming = category(session)

    created = admin_client.post(
        "/api/automations", json=payload(category_id=str(streaming.id), direction=direction)
    )
    changed = admin_client.patch(f"/api/automations/{uuid.uuid4()}", json={"direction": direction})

    assert created.status_code == 422
    # What's wrong with the change is found before what it's for.
    assert changed.status_code == 422


def test_a_new_automation_cannot_have_no_direction_though_a_change_can_leave_it_out(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)

    created = admin_client.post(
        "/api/automations", json=payload(category_id=str(streaming.id), direction=None)
    )
    kept = create(admin_client, payload(category_id=str(streaming.id), direction="out"))

    assert created.status_code == 422
    assert patch(admin_client, kept, direction=None, name="Renamed")["direction"] == "out"


# ---- What someone chose ----------------------------------------------------------------------


def sorted_automation(
    client: TestClient, session: Session, **changes: Any
) -> tuple[dict[str, Any], Account, Any]:
    """An automation that has put a payment of Streamflix's in its category."""
    account = add_account(session)
    streaming = category(session)
    created = create(client, payload(category_id=str(streaming.id), **changes))
    return created, account, streaming


def test_a_category_chosen_by_hand_is_not_changed_when_an_automation_is_edited(
    admin_client: TestClient, session: Session
) -> None:
    created, account, streaming = sorted_automation(admin_client, session)
    mine = post_payment(admin_client, account, "Streamflix", "-9.99")
    other = post_payment(admin_client, account, "Streamflix", "-14.99")
    assert (mine["category_id"], other["category_id"]) == (str(streaming.id),) * 2
    hobbies = category(session, "Hobbies", "Fun")
    admin_client.patch(f"/api/transactions/{mine['id']}", json={"category_id": str(hobbies.id)})
    # Not by hand: the bank's, a file's or an automation's, which are always the automation's to
    # change.
    admin_client.post(
        "/api/transactions/bulk/categorize", json={"ids": [other["id"]], "category_id": None}
    )

    changed = patch(admin_client, created, min_amount="1.00")

    assert changed["applied"] == 1
    assert reload(session, session.get_one(Transaction, uuid.UUID(mine["id"]))).category_id == (
        hobbies.id
    )
    assert reload(session, session.get_one(Transaction, uuid.UUID(other["id"]))).category_id == (
        streaming.id
    )


def test_a_category_chosen_when_adding_by_hand_is_kept(
    admin_client: TestClient, session: Session
) -> None:
    created, account, _ = sorted_automation(admin_client, session, apply_to="all")
    hobbies = category(session, "Hobbies", "Fun")
    mine = post_payment(admin_client, account, "Streamflix", "-9.99", category_id=str(hobbies.id))

    changed = patch(admin_client, created, match="contains")

    assert (mine["category_id"], changed["applied"]) == (str(hobbies.id), 0)
    stored = session.get_one(Transaction, uuid.UUID(mine["id"]))
    assert reload(session, stored).category_id == hobbies.id


def test_choosing_categories_for_several_keeps_them_and_taking_them_away_hands_them_back(
    admin_client: TestClient, session: Session
) -> None:
    created, account, streaming = sorted_automation(admin_client, session)
    first = post_payment(admin_client, account, "Streamflix", "-9.99")
    second = post_payment(admin_client, account, "Streamflix", "-14.99")
    hobbies = category(session, "Hobbies", "Fun")
    ids = [first["id"], second["id"]]
    chosen = admin_client.post(
        "/api/transactions/bulk/categorize", json={"ids": ids, "category_id": str(hobbies.id)}
    )
    assert chosen.status_code == 200
    assert patch(admin_client, created, min_amount="1.00")["applied"] == 0

    admin_client.post(
        "/api/transactions/bulk/categorize", json={"ids": [first["id"]], "category_id": None}
    )

    assert patch(admin_client, created, min_amount="2.00")["applied"] == 1
    stored = session.get_one(Transaction, uuid.UUID(first["id"]))
    assert reload(session, stored).category_id == streaming.id


def test_editing_a_transaction_without_changing_its_category_does_not_choose_it(
    admin_client: TestClient, session: Session
) -> None:
    created, account, streaming = sorted_automation(admin_client, session)
    payment = post_payment(admin_client, account, "Streamflix", "-9.99")
    # The edit form sends the category it already had along with the note.
    admin_client.patch(
        f"/api/transactions/{payment['id']}",
        json={"notes": "Family plan", "category_id": str(streaming.id)},
    )
    other = category(session, "Other", "Misc")
    admin_client.patch(f"/api/automations/{created['id']}", json={"category_id": str(other.id)})

    stored = session.get_one(Transaction, uuid.UUID(payment["id"]))
    assert reload(session, stored).category_id == other.id


def test_a_category_chosen_survives_pausing_and_resuming_an_automation(
    admin_client: TestClient, session: Session
) -> None:
    created, account, _ = sorted_automation(admin_client, session)
    payment = post_payment(admin_client, account, "Streamflix", "-9.99")
    hobbies = category(session, "Hobbies", "Fun")
    admin_client.patch(f"/api/transactions/{payment['id']}", json={"category_id": str(hobbies.id)})

    patch(admin_client, created, active=False)
    resumed = patch(admin_client, created, active=True)

    assert resumed["applied"] == 0
    stored = session.get_one(Transaction, uuid.UUID(payment["id"]))
    assert reload(session, stored).category_id == hobbies.id


def test_a_subscriptions_category_does_not_replace_one_that_was_chosen(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    utilities = category(session, "Utilities", "Bills")
    bill = admin_client.post(
        "/api/bills",
        json={
            "name": "Power",
            "payee": "Nobody called Power",
            "amount": "96.40",
            "frequency": "monthly",
            "account_id": str(account.id),
            "next_due_date": TODAY.isoformat(),
            "category_id": str(utilities.id),
        },
    ).json()
    payment = add_transaction(session, account, "-96.40", "City Power & Light")
    hobbies = category(session, "Hobbies", "Fun")
    admin_client.patch(f"/api/transactions/{payment.id}", json={"category_id": str(hobbies.id)})

    created = create(
        admin_client, payload(payees=["City Power & Light"], subscription_id=bill["id"])
    )

    assert created["applied"] == 1
    # It's linked to the bill, but keeps what was chosen for it.
    after = reload(session, payment)
    assert (after.subscription_id, after.category_id) == (uuid.UUID(bill["id"]), hobbies.id)
