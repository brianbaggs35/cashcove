import datetime as dt
import uuid
from decimal import Decimal
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
    result: dict[str, Any] = response.json()
    return result


def test_signing_in_is_required_to_see_subscriptions(client: TestClient) -> None:
    assert error(client.get("/api/subscriptions")) == "not_signed_in"


def test_viewers_can_read_subscriptions_but_cannot_manage_them(
    viewer_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = Subscription(
        name="Streamflix",
        payee="Streamflix",
        amount=Decimal("14.99"),
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
            viewer_client.patch(f"/api/subscriptions/{subscription_id}", json={"name": "Changed"})
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
    same = add_transaction(session, account, "-15.49", "STREAMFLIX", category_id=category.id)
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
    assert session.get_one(Transaction, paused_payment.id).subscription_id is None
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
    assert (
        admin_client.get(
            "/api/transactions", params={"subscription_id": subscription["id"]}
        ).json()["total"]
        == 1
    )

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
    assert session.get_one(Transaction, old_payment.id).subscription_id is None
    linked = session.get_one(Transaction, new_payment.id)
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
    assert session.get_one(Transaction, old.id).category_id is None

    changed = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}",
        json={"seed_transaction_id": str(replacement.id)},
    ).json()
    assert changed["payee"] == "New channel"
    assert changed["payment_count"] == 1
    session.expire_all()
    assert session.get_one(Transaction, old.id).subscription_id is None
    assert session.get_one(Transaction, replacement.id).subscription_id == uuid.UUID(
        subscription["id"]
    )


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
    bad_closed = admin_client.post("/api/subscriptions", json=payload(closed, name="Closed"))
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
    assert session.get_one(Transaction, transaction.id).subscription_id is None
    assert session.scalar(select(Subscription).where(Subscription.id == subscription["id"])) is None


def add_payment(
    client: TestClient, account: Account, payee: str, amount: str = "-14.99", **fields: Any
) -> dict[str, Any]:
    response = client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": amount,
            "payee": payee,
            **fields,
        },
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def link(client: TestClient, subscription: dict[str, Any], *ids: Any) -> dict[str, Any]:
    response = client.post(
        f"/api/subscriptions/{subscription['id']}/payments", json={"ids": [str(i) for i in ids]}
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_a_payment_that_arrives_settles_the_due_date_and_is_the_last_payment(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = create(
        admin_client, payload(account, name="Cloud Box", next_due_date=TODAY.isoformat())
    )
    assert subscription["last_payment_on"] is None

    payment = add_payment(admin_client, account, "Cloud Box")

    assert payment["subscription_id"] == subscription["id"]
    updated = admin_client.get(f"/api/subscriptions/{subscription['id']}").json()
    assert updated["next_due_date"] == TODAY.replace(month=10).isoformat()
    assert updated["last_payment_on"] == TODAY.isoformat()
    assert updated["payment_count"] == 1
    # The next payment settles the next due date, a month on.
    add_payment(admin_client, account, "Cloud Box")
    assert (
        admin_client.get(f"/api/subscriptions/{subscription['id']}").json()["next_due_date"]
        == TODAY.replace(month=10).isoformat()
    )


def test_old_payments_do_not_move_the_due_date(admin_client: TestClient, session: Session) -> None:
    account = add_account(session)
    long_ago = TODAY - dt.timedelta(days=60)
    old = add_transaction(session, account, "-3.99", "Cloud Box", date=long_ago)

    subscription = create(admin_client, payload(account, name="Cloud Box"))

    assert (subscription["payment_count"], subscription["last_payment_on"]) == (
        1,
        long_ago.isoformat(),
    )
    assert subscription["next_due_date"] == payload(account)["next_due_date"]
    assert old.subscription_id is not None


def test_viewers_cannot_link_or_unlink_payments(
    viewer_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = Subscription(
        name="Streamflix",
        payee="Streamflix",
        amount=Decimal("14.99"),
        frequency="monthly",
        account_id=account.id,
        next_due_date=TODAY,
        active=True,
    )
    session.add(subscription)
    session.commit()
    path = f"/api/subscriptions/{subscription.id}/payments"

    assert error(viewer_client.post(path, json={"ids": [str(uuid.uuid4())]})) == "admin_only"
    assert error(viewer_client.delete(f"{path}/{uuid.uuid4()}")) == "admin_only"


def test_payments_from_any_account_can_be_linked_to_a_subscription(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    card = add_account(session, "Rewards card")
    streaming = add_category(session, "Streaming", add_group(session, "Media"))
    other = add_category(session, "Fun", add_group(session, "Leisure"))
    subscription = create(admin_client, payload(account, category_id=str(streaming.id)))
    far = TODAY - dt.timedelta(days=45)
    by_card = add_transaction(session, card, "-14.99", "STREAMFLIX*123", date=far)
    by_hand = add_transaction(
        session, account, "-15.49", "Zelle to Sam", date=far, category_id=other.id
    )

    linked = link(admin_client, subscription, by_card.id, by_hand.id, uuid.uuid4())

    assert linked["count"] == 2
    assert (linked["subscription"]["payment_count"], linked["subscription"]["last_payment_on"]) == (
        2,
        far.isoformat(),
    )
    # They took its category, and a payment that old leaves the due date alone.
    assert linked["subscription"]["next_due_date"] == subscription["next_due_date"]
    session.expire_all()
    for row in (by_card, by_hand):
        row = session.get_one(Transaction, row.id)
        assert (row.subscription_id, row.category_id) == (
            uuid.UUID(subscription["id"]),
            streaming.id,
        )
    # Linking them again changes nothing, unless someone changed their category since.
    assert link(admin_client, subscription, by_card.id)["count"] == 0
    session.get_one(Transaction, by_hand.id).category_id = other.id
    session.commit()
    assert link(admin_client, subscription, by_card.id, by_hand.id)["count"] == 1
    # Nothing to link is fine.
    assert link(admin_client, subscription, uuid.uuid4())["count"] == 0


def test_payments_linked_to_a_subscription_without_a_category_keep_theirs(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    other = add_category(session, "Fun", add_group(session, "Leisure"))
    subscription = create(admin_client, payload(account))
    payment = add_transaction(
        session,
        account,
        "-14.99",
        "Zelle to Sam",
        date=TODAY - dt.timedelta(days=45),
        category_id=other.id,
    )

    assert link(admin_client, subscription, payment.id)["count"] == 1

    session.expire_all()
    assert session.get_one(Transaction, payment.id).category_id == other.id
    # Linked, it isn't a change to link it again.
    assert link(admin_client, subscription, payment.id)["count"] == 0


def test_a_recent_payment_linked_by_hand_settles_the_due_date(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = create(admin_client, payload(account))
    payment = add_transaction(session, account, "-14.99", "Zelle to Sam")

    linked = link(admin_client, subscription, payment.id)

    due = dt.date.fromisoformat(subscription["next_due_date"])
    assert (
        linked["subscription"]["next_due_date"]
        == dt.date(due.year, due.month + 1, due.day).isoformat()
    )


def test_only_payments_can_be_linked_to_a_subscription(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = create(admin_client, payload(account))
    payment = add_transaction(session, account, "-14.99", "Zelle to Sam")
    refund = add_transaction(session, account, "14.99", "Zelle from Sam")

    response = admin_client.post(
        f"/api/subscriptions/{subscription['id']}/payments",
        json={"ids": [str(payment.id), str(refund.id)]},
    )

    assert (response.status_code, error(response)) == (422, "not_payment")
    session.expire_all()
    assert session.get_one(Transaction, payment.id).subscription_id is None
    assert (
        error(
            admin_client.post(
                f"/api/subscriptions/{uuid.uuid4()}/payments", json={"ids": [str(payment.id)]}
            )
        )
        == "not_found"
    )
    empty = admin_client.post(f"/api/subscriptions/{subscription['id']}/payments", json={"ids": []})
    assert empty.status_code == 422


def test_a_payment_can_be_taken_off_a_subscription_and_keeps_its_category(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = add_category(session, "Streaming", add_group(session, "Media"))
    subscription = create(admin_client, payload(account, category_id=str(streaming.id)))
    other = create(admin_client, payload(account, name="Other", payee="Another"))
    payment = add_transaction(
        session, account, "-14.99", "Zelle to Sam", date=TODAY - dt.timedelta(days=45)
    )
    link(admin_client, subscription, payment.id)

    # Naming the wrong subscription takes nothing off the right one.
    wrong = admin_client.delete(f"/api/subscriptions/{other['id']}/payments/{payment.id}")
    assert wrong.status_code == 200
    assert admin_client.get(f"/api/subscriptions/{subscription['id']}").json()["payment_count"] == 1

    path = f"/api/subscriptions/{subscription['id']}/payments/{payment.id}"
    response = admin_client.delete(path)
    assert response.status_code == 200
    assert response.json()["payment_count"] == 0
    session.expire_all()
    row = session.get_one(Transaction, payment.id)
    assert (row.subscription_id, row.category_id) == (None, streaming.id)
    # Again, or for a payment that's gone, there's nothing to do.
    assert admin_client.delete(path).status_code == 200
    assert (
        admin_client.delete(
            f"/api/subscriptions/{subscription['id']}/payments/{uuid.uuid4()}"
        ).status_code
        == 200
    )
    assert error(
        admin_client.delete(f"/api/subscriptions/{uuid.uuid4()}/payments/{payment.id}")
    ) == ("not_found")


def test_resuming_a_subscription_catches_up_on_what_arrived_while_it_was_paused(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = create(admin_client, payload(account, name="Cloud Box"))
    admin_client.patch(f"/api/subscriptions/{subscription['id']}", json={"active": False})
    arrived = add_transaction(
        session, account, "-3.99", "Cloud Box", date=TODAY - dt.timedelta(days=45)
    )
    assert arrived.subscription_id is None

    resumed = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"active": True}
    ).json()

    assert resumed["payment_count"] == 1
    session.expire_all()
    assert session.get_one(Transaction, arrived.id).subscription_id == uuid.UUID(subscription["id"])


def test_changing_what_a_subscription_matches_keeps_payments_linked_by_hand(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    card = add_account(session, "Rewards card")
    far = TODAY - dt.timedelta(days=45)
    matched = add_transaction(session, account, "-4.00", "Old stream", date=far)
    subscription = create(admin_client, payload(account, name="Old stream"))
    by_hand = add_transaction(session, card, "-4.00", "Something else", date=far)
    link(admin_client, subscription, by_hand.id)

    updated = admin_client.patch(
        f"/api/subscriptions/{subscription['id']}", json={"payee": "New stream"}
    ).json()

    assert updated["payment_count"] == 1
    session.expire_all()
    assert session.get_one(Transaction, matched.id).subscription_id is None
    assert session.get_one(Transaction, by_hand.id).subscription_id == uuid.UUID(subscription["id"])


def test_subscriptions_list_how_many_payments_each_tracks(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    far = TODAY - dt.timedelta(days=45)
    add_transaction(session, account, "-3.99", "Cloud Box", date=far)
    add_transaction(session, account, "-3.99", "Cloud Box", date=far - dt.timedelta(days=30))
    busy = create(admin_client, payload(account, name="Cloud Box"))
    idle = create(admin_client, payload(account, name="Idle", payee="Nothing"))

    listed = {item["id"]: item for item in admin_client.get("/api/subscriptions").json()}

    assert (listed[busy["id"]]["payment_count"], listed[busy["id"]]["last_payment_on"]) == (
        2,
        far.isoformat(),
    )
    assert (listed[idle["id"]]["payment_count"], listed[idle["id"]]["last_payment_on"]) == (
        0,
        None,
    )


def test_a_category_chosen_for_a_subscriptions_payment_stays(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = add_category(session, "Streaming", add_group(session, "Media"))
    other = add_category(session, "Fun", add_group(session, "Leisure"))
    subscription = create(
        admin_client, payload(account, category_id=str(streaming.id), payee="Streamflix")
    )

    plain = add_payment(admin_client, account, "Streamflix")
    chosen = add_payment(admin_client, account, "Streamflix", category_id=str(other.id))
    assert (plain["category_id"], plain["subscription_id"]) == (
        str(streaming.id),
        subscription["id"],
    )
    assert (chosen["category_id"], chosen["subscription_id"]) == (
        str(other.id),
        subscription["id"],
    )

    edited = admin_client.patch(
        f"/api/transactions/{plain['id']}", json={"category_id": str(other.id)}
    ).json()
    assert (edited["category_id"], edited["subscription_id"]) == (
        str(other.id),
        subscription["id"],
    )
    cleared = admin_client.patch(
        f"/api/transactions/{plain['id']}", json={"category_id": None, "payee": "STREAMFLIX"}
    ).json()
    assert (cleared["category_id"], cleared["subscription_id"]) == (None, subscription["id"])


def test_editing_what_automations_match_a_transaction_by_sorts_it_again(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    card = add_account(session, "Rewards card")
    streaming = add_category(session, "Streaming", add_group(session, "Media"))
    subscription = create(
        admin_client, payload(account, category_id=str(streaming.id), payee="Streamflix")
    )

    typo = add_payment(admin_client, account, "Streamflx")
    elsewhere = add_payment(admin_client, card, "Streamflix")
    assert (typo["subscription_id"], elsewhere["subscription_id"]) == (None, None)

    fixed = admin_client.patch(
        f"/api/transactions/{typo['id']}", json={"payee": "Streamflix"}
    ).json()
    assert (fixed["subscription_id"], fixed["category_id"]) == (
        subscription["id"],
        str(streaming.id),
    )
    moved = admin_client.patch(
        f"/api/transactions/{elsewhere['id']}", json={"account_id": str(account.id)}
    ).json()
    assert moved["subscription_id"] == subscription["id"]

    # Other edits leave a payment's link alone, even when nothing matches it any more.
    renamed = admin_client.patch(
        f"/api/transactions/{typo['id']}", json={"notes": "Family plan"}
    ).json()
    assert renamed["subscription_id"] == subscription["id"]


def test_a_payment_changed_to_money_in_leaves_its_subscription(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = create(admin_client, payload(account, payee="Streamflix"))
    payment = add_payment(admin_client, account, "Streamflix")
    assert payment["subscription_id"] == subscription["id"]
    refund = add_payment(admin_client, account, "Streamflix", "14.99")
    assert refund["subscription_id"] is None

    into_refund = admin_client.patch(
        f"/api/transactions/{payment['id']}", json={"amount": "14.99"}
    ).json()
    assert into_refund["subscription_id"] is None
    into_payment = admin_client.patch(
        f"/api/transactions/{refund['id']}", json={"amount": "-14.99"}
    ).json()
    assert into_payment["subscription_id"] == subscription["id"]


def test_a_bill_that_changes_every_time_is_expected_to_be_about_what_recent_ones_were(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    power = create(
        admin_client, payload(account, name="Power", amount="100.00", amount_varies=True)
    )
    fixed = create(admin_client, payload(account, name="Streamflix", payee="Nothing"))
    assert (power["amount_varies"], fixed["amount_varies"]) == (True, False)
    # Nothing paid yet, so the amount it was set up with is all there is to go on.
    assert (power["typical_amount"], power["last_payment_amount"], power["expected_amount"]) == (
        None,
        None,
        "100.00",
    )

    # Seven bills, the oldest of which is more than the six that its typical amount comes from.
    ids: list[uuid.UUID] = []
    for index, amount in enumerate(
        ["-500.00", "-90.00", "-100.00", "-110.00", "-120.00", "-130.00", "-140.01"]
    ):
        bill = add_transaction(
            session,
            account,
            amount,
            "City Power",
            date=TODAY - dt.timedelta(days=400 - 30 * index),
        )
        ids.append(bill.id)
    link(admin_client, power, *ids)
    streams = [
        add_transaction(
            session, account, amount, "Streamflix", date=TODAY - dt.timedelta(days=days)
        ).id
        for amount, days in (("-14.99", 40), ("-15.49", 10))
    ]
    link(admin_client, fixed, *streams)

    updated = {item["id"]: item for item in admin_client.get("/api/subscriptions").json()}
    varying, steady = updated[power["id"]], updated[fixed["id"]]
    assert varying["payment_count"] == 7
    assert varying["last_payment_amount"] == "140.01"
    assert varying["typical_amount"] == "115.00"
    # A bill that changes is expected to be what recent ones averaged; one that doesn't, what it is.
    assert varying["expected_amount"] == "115.00"
    assert (steady["typical_amount"], steady["expected_amount"]) == ("15.24", "14.99")

    changed = admin_client.patch(f"/api/subscriptions/{power['id']}", json={"amount_varies": False})
    assert (changed.json()["amount_varies"], changed.json()["expected_amount"]) == (False, "100.00")
