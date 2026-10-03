import datetime as dt
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Subscription, Transaction
from tests.finance import TODAY, add_account, add_category, add_group, add_transaction
from tests.helpers import error


def payload(account: Account, **changes: Any) -> dict[str, Any]:
    return {
        "name": "Streamflix",
        "amount": "14.99",
        "frequency": "monthly",
        "account_id": str(account.id),
        "next_due_date": (TODAY + dt.timedelta(days=12)).isoformat(),
        **changes,
    }


def create(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/subscriptions", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_signing_in_is_required_to_see_subscriptions(client: TestClient) -> None:
    assert error(client.get("/api/subscriptions")) == "not_signed_in"


def test_viewers_can_read_subscriptions_but_cannot_manage_them(
    viewer_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = Subscription(
        name="Streamflix",
        payee="Streamflix",
        amount="14.99",
        frequency="monthly",
        account_id=account.id,
        next_due_date=TODAY,
        active=True,
    )
    session.add(subscription)
    session.commit()
    subscription_id = str(subscription.id)
    assert viewer_client.get("/api/subscriptions").json()[0]["id"] == subscription_id
    assert error(viewer_client.post("/api/subscriptions", json=payload(account))) == "admin_only"
    assert (
        error(
            viewer_client.patch(
                f"/api/subscriptions/{subscription_id}", json={"name": "Changed"}
            )
        )
        == "admin_only"
    )
    assert error(viewer_client.delete(f"/api/subscriptions/{subscription_id}")) == "admin_only"


def test_linking_a_payment_backfills_only_the_matching_outgoing_account_payee(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    other = add_account(session, "Rewards card")
    category = add_category(session, "Streaming", add_group(session, "Entertainment"))
    chosen = add_transaction(session, account, "-14.99", " Streamflix ")
    same = add_transaction(
        session, account, "-15.49", "STREAMFLIX", category_id=category.id
    )
    add_transaction(session, account, "14.99", "Streamflix")
    add_transaction(session, other, "-14.99", "Streamflix")

    subscription = create(
        admin_client,
        payload(account, category_id=str(category.id), seed_transaction_id=str(chosen.id)),
    )

    assert (subscription["payee"], subscription["payment_count"]) == (" Streamflix ", 2)
    assert subscription["category_id"] == str(category.id)
    linked = admin_client.get(
        "/api/transactions", params={"subscription_id": subscription["id"]}
    ).json()
    assert {item["id"] for item in linked["items"]} == {str(chosen.id), str(same.id)}
    assert {item["category_id"] for item in linked["items"]} == {str(category.id)}
    assert admin_client.get(f"/api/subscriptions/{subscription['id']}").json() == subscription


def test_creating_a_subscription_without_a_seed_uses_its_name_and_can_be_paused(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    old = add_transaction(session, account, "-8.00", "Other")
    paused_payment = add_transaction(session, account, "-8.00", "Paused stream")
    subscription = create(admin_client, payload(account, name=" Cloud Box "))
    assert (subscription["name"], subscription["payee"], subscription["payment_count"]) == (
        "Cloud Box",
        "Cloud Box",
        0,
    )

    paused = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"active": False}
    ).json()
    assert paused["active"] is False
    assert [item["id"] for item in admin_client.get("/api/subscriptions?active=false").json()] == [
        subscription["id"]
    ]
    assert admin_client.get("/api/subscriptions?active=true").json() == []
    same_matcher = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"notes": "Reminder"}
    ).json()
    assert same_matcher["notes"] == "Reminder"
    null_active = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"active": None}
    ).json()
    assert null_active["active"] is False
    changed_matcher = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"payee": "Paused stream"}
    ).json()
    assert changed_matcher["payment_count"] == 0
    session.expire_all()
    assert session.get(Transaction, paused_payment.id).subscription_id is None
    added = admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": "-8.00",
            "payee": "Cloud Box",
        },
    ).json()
    assert added["subscription_id"] is None
    assert old.subscription_id is None


def test_manual_transactions_match_and_are_categorized_automatically(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    category = add_category(session, "Entertainment", add_group(session, "Media"))
    subscription = create(
        admin_client, payload(account, category_id=str(category.id), payee="Streamflix")
    )

    payment = admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": "-16.49",
            "payee": "  STREAMFLIX ",
        },
    ).json()
    assert payment["subscription_id"] == subscription["id"]
    assert payment["category_id"] == str(category.id)
    assert admin_client.get(
        "/api/transactions", params={"subscription_id": subscription["id"]}
    ).json()["total"] == 1

    income = admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": "16.49",
            "payee": "Streamflix",
        },
    ).json()
    assert income["subscription_id"] is None

    response = admin_client.patch(
        f"/api/transactions/{payment['id']}", json={"notes": "Kept for the show"}
    )
    assert response.json()["subscription_id"] == subscription["id"]


def test_changing_a_matcher_detaches_old_payments_and_tracks_the_new_account(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    other = add_account(session, "Streaming card")
    old_category = add_category(session, "Old type", add_group(session, "Old group"))
    new_category = add_category(session, "New type", add_group(session, "New group"))
    old_payment = add_transaction(
        session, account, "-4.00", "Old stream", category_id=old_category.id
    )
    new_payment = add_transaction(session, other, "-4.00", "New stream")
    subscription = create(
        admin_client,
        payload(account, name="Old stream", category_id=str(old_category.id)),
    )

    updated = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}",
        json={
            "account_id": str(other.id),
            "payee": "New stream",
            "category_id": str(new_category.id),
            "notes": "Family plan",
        },
    ).json()

    assert updated["account_id"] == str(other.id)
    assert updated["payee"] == "New stream"
    assert updated["notes"] == "Family plan"
    assert updated["payment_count"] == 1
    session.expire_all()
    assert session.get(Transaction, old_payment.id).subscription_id is None
    linked = session.get(Transaction, new_payment.id)
    assert linked.subscription_id == uuid.UUID(subscription["id"])
    assert linked.category_id == new_category.id


def test_updating_category_clears_it_on_linked_transactions_and_seed_can_change_matcher(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    old = add_transaction(session, account, "-12.00", "Old channel")
    replacement = add_transaction(session, account, "-12.00", "New channel")
    category = add_category(session, "Channel", add_group(session, "Video"))
    subscription = create(
        admin_client, payload(account, name="Old channel", category_id=str(category.id))
    )

    cleared = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"category_id": None, "notes": None}
    ).json()
    assert cleared["category_id"] is None
    session.expire_all()
    assert session.get(Transaction, old.id).category_id is None

    changed = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}",
        json={"seed_transaction_id": str(replacement.id)},
    ).json()
    assert changed["payee"] == "New channel"
    assert changed["payment_count"] == 1
    session.expire_all()
    assert session.get(Transaction, old.id).subscription_id is None
    assert session.get(Transaction, replacement.id).subscription_id == uuid.UUID(subscription["id"])


def test_duplicate_invalid_missing_and_closed_subscription_inputs_are_rejected(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    closed = add_account(
        session, "Closed account", closed_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC)
    )
    existing = create(admin_client, payload(account, payee="Duplicate"))
    duplicate = admin_client.post(
        "/api/subscriptions", json=payload(account, name="Duplicate", payee=" duplicate ")
    )
    assert (duplicate.status_code, error(duplicate)) == (409, "duplicate_rule")
    bad_account = admin_client.post(
        "/api/subscriptions", json=payload(account, account_id=str(uuid.uuid4()))
    )
    assert error(bad_account) == "unknown_account"
    bad_closed = admin_client.post(
        "/api/subscriptions", json=payload(closed, name="Closed")
    )
    assert error(bad_closed) == "closed_account"
    bad_category = admin_client.post(
        "/api/subscriptions",
        json=payload(account, name="Wrong category", category_id=str(uuid.uuid4())),
    )
    assert error(bad_category) == "unknown_category"
    invalid = admin_client.post("/api/subscriptions", json=payload(account, amount="0"))
    assert invalid.status_code == 422
    strict = admin_client.post(
        "/api/subscriptions", json=payload(account, unexpected="not allowed")
    )
    assert strict.status_code == 422

    for seed, expected in [
        (str(uuid.uuid4()), "transaction_not_found"),
    ]:
        response = admin_client.post(
            "/api/subscriptions", json=payload(account, seed_transaction_id=seed)
        )
        assert error(response) == expected

    incoming = add_transaction(session, account, "10.00", "Paycheck")
    wrong_direction = admin_client.post(
        "/api/subscriptions",
        json=payload(account, seed_transaction_id=str(incoming.id)),
    )
    assert error(wrong_direction) == "not_payment"
    different_account = add_account(session, "Different account")
    outgoing = add_transaction(session, different_account, "-10.00", "Other")
    mismatch = admin_client.post(
        "/api/subscriptions", json=payload(account, seed_transaction_id=str(outgoing.id))
    )
    assert error(mismatch) == "account_mismatch"

    collision = admin_client.patch(
        f"/api/subscriptions/{existing['id']}", json={"payee": "New payee"}
    )
    assert collision.status_code == 200
    other_sub = create(admin_client, payload(account, payee="Reserved"))
    conflict = admin_client.patch(
        f"/api/subscriptions/{existing['id']}", json={"payee": "reserved"}
    )
    assert error(conflict) == "duplicate_rule"
    assert admin_client.get(f"/api/subscriptions/{uuid.uuid4()}").status_code == 404

    missing_update = admin_client.patch(
        f"/api/subscriptions/{uuid.uuid4()}", json={"name": "Missing"}
    )
    assert error(missing_update) == "not_found"
    assert error(admin_client.delete(f"/api/subscriptions/{uuid.uuid4()}")) == "not_found"
    assert other_sub["id"] != existing["id"]


def test_subscription_deletion_unlinks_but_keeps_transaction_history(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    transaction = add_transaction(session, account, "-3.99", "Cloud Box")
    subscription = create(admin_client, payload(account, name="Cloud Box"))
    assert transaction.subscription_id == uuid.UUID(subscription["id"])

    response = admin_client.delete(f"/api/subscriptions/{subscription['id']}")

    assert response.status_code == 204
    session.expire_all()
    assert session.get(Transaction, transaction.id).subscription_id is None
    assert session.scalar(select(Subscription).where(Subscription.id == subscription["id"])) is None
