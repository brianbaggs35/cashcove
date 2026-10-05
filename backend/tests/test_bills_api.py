"""Bills: recurring payments like electricity or a phone line, which are the same rows as
subscriptions and so are tracked, matched and linked the same way, but kept apart by kind."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import CSRF_HEADER
from app.models import (
    Account,
    Automation,
    BudgetLink,
    RecurringKind,
    Subscription,
    Transaction,
)
from tests.finance import TODAY, add_account, add_category, add_group, add_transaction
from tests.helpers import error


def payload(account: Account, **changes: Any) -> dict[str, Any]:
    return {
        "name": "City Power",
        "amount": "96.40",
        "frequency": "monthly",
        "account_id": str(account.id),
        "next_due_date": (TODAY + dt.timedelta(days=12)).isoformat(),
        **changes,
    }


def create(client: TestClient, body: dict[str, Any], kind: str = "bills") -> dict[str, Any]:
    response = client.post(f"/api/{kind}", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def link(client: TestClient, bill: dict[str, Any], *ids: Any) -> dict[str, Any]:
    response = client.post(f"/api/bills/{bill['id']}/payments", json={"ids": [str(i) for i in ids]})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_signing_in_is_required_to_see_bills(client: TestClient) -> None:
    assert error(client.get("/api/bills")) == "not_signed_in"
    assert error(client.get(f"/api/bills/{uuid.uuid4()}")) == "not_signed_in"


def test_viewers_can_read_bills_but_cannot_manage_them(
    viewer_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    bill = Subscription(
        name="City Power",
        kind=RecurringKind.BILL,
        payee="City Power",
        amount=Decimal("96.40"),
        frequency="monthly",
        account_id=account.id,
        next_due_date=TODAY,
        active=True,
    )
    session.add(bill)
    payment = add_transaction(session, account, "-96.40", "Elsewhere")
    session.commit()
    path = f"/api/bills/{bill.id}"

    assert [item["id"] for item in viewer_client.get("/api/bills").json()] == [str(bill.id)]
    assert viewer_client.get(path).json()["kind"] == "bill"
    refused = [
        viewer_client.post("/api/bills", json=payload(account)),
        viewer_client.patch(path, json={"name": "Changed"}),
        viewer_client.delete(path),
        viewer_client.post(f"{path}/payments", json={"ids": [str(payment.id)]}),
        viewer_client.delete(f"{path}/payments/{payment.id}"),
    ]
    assert [error(response) for response in refused] == ["admin_only"] * 5
    assert [response.status_code for response in refused] == [403] * 5
    session.expire_all()
    assert session.get_one(Subscription, bill.id).name == "City Power"


def changes(account: Account, bill_id: object, payment_id: object) -> list[tuple[str, str, Any]]:
    """Every way to change a bill, as (method, path, body)."""
    path = f"/api/bills/{bill_id}"
    return [
        ("POST", "/api/bills", payload(account, name="Another", payee="Another")),
        ("PATCH", path, {"name": "Changed"}),
        ("DELETE", path, None),
        ("POST", f"{path}/payments", {"ids": [str(payment_id)]}),
        ("DELETE", f"{path}/payments/{payment_id}", None),
    ]


def test_nobody_signed_out_can_change_a_bill(client: TestClient, session: Session) -> None:
    account = add_account(session)
    bill = Subscription(
        name="City Power",
        kind=RecurringKind.BILL,
        payee="City Power",
        amount=Decimal("96.40"),
        frequency="monthly",
        account_id=account.id,
        next_due_date=TODAY,
    )
    session.add(bill)
    payment = add_transaction(session, account, "-96.40", "City Power")
    session.commit()

    for method, path, body in changes(account, bill.id, payment.id):
        response = client.request(method, path, json=body)
        assert (response.status_code, error(response)) == (401, "not_signed_in"), path

    session.expire_all()
    assert session.get_one(Subscription, bill.id).name == "City Power"
    assert session.get_one(Transaction, payment.id).subscription_id is None


def test_a_change_to_a_bill_needs_the_sessions_csrf_token_and_cashcove_as_its_origin(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    bill = create(admin_client, payload(account, payee="City Power"))
    payment = add_transaction(session, account, "-96.40", "Elsewhere")

    for method, path, body in changes(account, bill["id"], payment.id):
        wrong_token = admin_client.request(method, path, json=body, headers={CSRF_HEADER: "nope"})
        assert (wrong_token.status_code, error(wrong_token)) == (403, "csrf"), path
        other_site = admin_client.request(
            method, path, json=body, headers={"Origin": "https://evil.example"}
        )
        assert (other_site.status_code, error(other_site)) == (403, "cross_origin"), path
        cross_site = admin_client.request(
            method, path, json=body, headers={"Sec-Fetch-Site": "cross-site"}
        )
        assert (cross_site.status_code, error(cross_site)) == (403, "cross_origin"), path

    # None of it changed anything.
    session.expire_all()
    assert [item["name"] for item in admin_client.get("/api/bills").json()] == ["City Power"]
    assert session.get_one(Transaction, payment.id).subscription_id is None


def test_a_bill_is_made_from_a_payment_and_links_every_payment_like_it_past_and_future(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    other = add_account(session, "Rewards card")
    utilities = add_category(session, "Utilities", add_group(session, "Home"))
    old = TODAY - dt.timedelta(days=60)
    chosen = add_transaction(session, account, "-91.10", " City Power ", date=old)
    same = add_transaction(session, account, "-88.00", "CITY POWER", date=TODAY - dt.timedelta(30))
    add_transaction(session, account, "12.00", "City Power")
    add_transaction(session, other, "-91.10", "City Power")

    bill = create(
        admin_client,
        payload(account, category_id=str(utilities.id), seed_transaction_id=str(chosen.id)),
    )

    # It's a bill, and the payments it found were already there: both of this account's.
    assert (bill["kind"], bill["payee"], bill["payment_count"]) == ("bill", " City Power ", 2)
    assert bill["category_id"] == str(utilities.id)
    linked = admin_client.get("/api/transactions", params={"subscription_id": bill["id"]}).json()
    assert {item["id"] for item in linked["items"]} == {str(chosen.id), str(same.id)}
    assert {item["category_id"] for item in linked["items"]} == {str(utilities.id)}

    # The next one that comes in, however it does, is linked too, and settles the due date.
    due = bill["next_due_date"]
    payment = admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": "-101.25",
            "payee": "city power",
        },
    ).json()
    assert (payment["subscription_id"], payment["category_id"]) == (bill["id"], str(utilities.id))
    after = admin_client.get(f"/api/bills/{bill['id']}").json()
    assert after["payment_count"] == 3
    assert after["last_payment_on"] == TODAY.isoformat()
    assert after["next_due_date"] > due


def test_bills_and_subscriptions_are_listed_and_opened_apart(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    bill = create(admin_client, payload(account))
    subscription = create(
        admin_client, payload(account, name="Streamflix", payee="Streamflix"), "subscriptions"
    )
    assert (bill["kind"], subscription["kind"]) == ("bill", "subscription")

    assert [item["id"] for item in admin_client.get("/api/bills").json()] == [bill["id"]]
    assert [item["id"] for item in admin_client.get("/api/subscriptions").json()] == [
        subscription["id"]
    ]
    assert admin_client.get("/api/bills?active=false").json() == []

    # Each is only ever the other's missing, whatever is done with it.
    payment = add_transaction(session, account, "-5.00", "Somewhere")
    as_subscription = f"/api/subscriptions/{bill['id']}"
    as_bill = f"/api/bills/{subscription['id']}"
    missing = [
        admin_client.get(as_subscription),
        admin_client.patch(as_subscription, json={"name": "Taken over"}),
        admin_client.delete(as_subscription),
        admin_client.post(f"{as_subscription}/payments", json={"ids": [str(payment.id)]}),
        admin_client.delete(f"{as_subscription}/payments/{payment.id}"),
        admin_client.get(as_bill),
        admin_client.patch(as_bill, json={"name": "Taken over"}),
        admin_client.delete(as_bill),
    ]
    assert [(response.status_code, error(response)) for response in missing] == [
        (404, "not_found")
    ] * 8
    assert admin_client.get(as_subscription).json()["detail"]["message"] == (
        "That subscription doesn't exist anymore."
    )
    assert admin_client.get(as_bill).json()["detail"]["message"] == (
        "That bill doesn't exist anymore."
    )
    session.expire_all()
    assert session.get_one(Subscription, uuid.UUID(bill["id"])).name == "City Power"
    assert session.get_one(Subscription, uuid.UUID(subscription["id"])).kind == (
        RecurringKind.SUBSCRIPTION
    )


def test_an_id_that_is_not_a_uuid_is_turned_away_before_anything_is_looked_up(
    admin_client: TestClient,
) -> None:
    assert admin_client.get("/api/bills/1").status_code == 422
    assert admin_client.get("/api/bills/not-an-id").status_code == 422
    assert admin_client.patch("/api/bills/1", json={"name": "Power"}).status_code == 422
    assert admin_client.delete("/api/bills/1").status_code == 422
    assert admin_client.post("/api/bills/1/payments", json={"ids": ["1"]}).status_code == 422


def test_what_kind_a_payment_is_comes_from_where_it_is_made_and_never_changes(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    # The kind isn't something a request can say, on the way in or later.
    assert (
        admin_client.post("/api/bills", json=payload(account, kind="subscription")).status_code
        == 422
    )
    assert (
        admin_client.post("/api/subscriptions", json=payload(account, kind="bill")).status_code
        == 422
    )
    bill = create(admin_client, payload(account))
    assert (
        admin_client.patch(f"/api/bills/{bill['id']}", json={"kind": "subscription"}).status_code
        == 422
    )
    assert admin_client.get(f"/api/bills/{bill['id']}").json()["kind"] == "bill"


@pytest.mark.parametrize(
    ("first", "second"), [("bills", "subscriptions"), ("subscriptions", "bills")]
)
def test_a_payee_is_tracked_once_from_an_account_as_a_subscription_or_a_bill(
    admin_client: TestClient, session: Session, first: str, second: str
) -> None:
    account = add_account(session)
    other = add_account(session, "Rewards card")
    create(admin_client, payload(account, payee="Streamflix"), first)

    # A payment can only be one of them, so the same payee from the same account can't be both.
    clash = admin_client.post(f"/api/{second}", json=payload(account, payee=" STREAMFLIX "))
    assert (clash.status_code, error(clash)) == (409, "duplicate_rule")
    assert clash.json()["detail"]["message"] == (
        f"A {first.removesuffix('s')} already tracks this payee from this account."
    )
    # From another account it's a different payment, and a different name is another payee.
    create(admin_client, payload(other, payee="Streamflix"), second)
    separate = create(admin_client, payload(account, payee="Elsewhere"), second)
    moved = admin_client.patch(f"/api/{second}/{separate['id']}", json={"payee": "streamflix"})
    assert (moved.status_code, error(moved)) == (409, "duplicate_rule")


def test_the_problems_with_a_bills_payments_name_a_bill(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    other = add_account(session, "Rewards card")
    coming_in = add_transaction(session, account, "50.00", "Refund")
    elsewhere = add_transaction(session, other, "-50.00", "Power")
    bill = create(admin_client, payload(account))

    not_a_payment = admin_client.post(
        "/api/bills", json=payload(account, name="Water", seed_transaction_id=str(coming_in.id))
    )
    wrong_account = admin_client.post(
        "/api/bills", json=payload(account, name="Water", seed_transaction_id=str(elsewhere.id))
    )
    refund = admin_client.post(
        f"/api/bills/{bill['id']}/payments", json={"ids": [str(coming_in.id)]}
    )

    assert [error(item) for item in (not_a_payment, wrong_account, refund)] == [
        "not_payment",
        "account_mismatch",
        "not_payment",
    ]
    assert [
        item.json()["detail"]["message"] for item in (not_a_payment, wrong_account, refund)
    ] == [
        "Choose an outgoing transaction as a bill payment.",
        "The selected payment must come from the bill account.",
        "Only payments, money going out, can be linked to a bill.",
    ]


def test_payments_from_any_account_can_be_linked_to_a_bill_and_taken_off_again(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    card = add_account(session, "Rewards card")
    utilities = add_category(session, "Utilities", add_group(session, "Home"))
    bill = create(admin_client, payload(account, category_id=str(utilities.id)))
    near = TODAY - dt.timedelta(days=2)
    by_card = add_transaction(session, card, "-97.00", "CITYPWR*8841", date=near)

    linked = link(admin_client, bill, by_card.id, uuid.uuid4())

    assert linked["count"] == 1
    # The bill it was linked to is under `subscription`, since both are linked the same way.
    assert linked["subscription"]["kind"] == "bill"
    assert linked["subscription"]["payment_count"] == 1
    assert linked["subscription"]["last_payment_on"] == near.isoformat()
    session.expire_all()
    row = session.get_one(Transaction, by_card.id)
    assert (row.subscription_id, row.category_id) == (uuid.UUID(bill["id"]), utilities.id)

    unlinked = admin_client.delete(f"/api/bills/{bill['id']}/payments/{by_card.id}").json()
    assert (unlinked["kind"], unlinked["payment_count"]) == ("bill", 0)
    session.expire_all()
    row = session.get_one(Transaction, by_card.id)
    # It keeps the category the bill gave it.
    assert (row.subscription_id, row.category_id) == (None, utilities.id)


def test_a_bill_that_is_a_different_amount_every_month_is_expected_to_be_about_the_average(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    bill = create(admin_client, payload(account, amount="100.00", amount_varies=True))
    assert (bill["amount_varies"], bill["expected_amount"], bill["typical_amount"]) == (
        True,
        "100.00",
        None,
    )
    payments = [
        add_transaction(
            session, account, amount, "Elsewhere", date=TODAY - dt.timedelta(days=days)
        ).id
        for amount, days in (("-80.00", 70), ("-120.00", 40), ("-109.00", 10))
    ]

    updated = link(admin_client, bill, *payments)["subscription"]

    assert (updated["typical_amount"], updated["expected_amount"]) == ("103.00", "103.00")
    assert updated["last_payment_amount"] == "109.00"


def test_deleting_a_bill_keeps_the_history_and_loses_only_what_pointed_at_it(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    payment = add_transaction(session, account, "-96.40", "City Power")
    bill = create(admin_client, payload(account))
    assert bill["payment_count"] == 1
    automation = admin_client.post(
        "/api/automations",
        json={
            "name": "Power",
            "payees": ["power"],
            "match": "contains",
            "subscription_id": bill["id"],
        },
    ).json()
    budget = admin_client.post(
        "/api/budgets",
        json={"name": "Home", "period": "monthly", "amount": "500.00", "today": TODAY.isoformat()},
    ).json()
    counted = admin_client.post(
        f"/api/budgets/{budget['id']}/sources",
        json={"kind": "spending", "subscription_id": bill["id"]},
    )
    assert (counted.status_code, counted.json()["type"]) == (201, "bill")

    assert admin_client.delete(f"/api/bills/{bill['id']}").status_code == 204

    session.expire_all()
    # The payment stays, no longer linked. The automation stays, with less to do, and the
    # budget stops counting what is gone.
    assert session.get_one(Transaction, payment.id).subscription_id is None
    assert session.get_one(Automation, uuid.UUID(automation["id"])).subscription_id is None
    assert (
        session.scalar(
            select(func.count())
            .select_from(BudgetLink)
            .where(BudgetLink.budget_id == uuid.UUID(budget["id"]))
        )
        == 0
    )
