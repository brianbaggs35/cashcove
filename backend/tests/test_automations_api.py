import datetime as dt
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Account, Automation, BudgetLink, Category, Transaction
from tests.finance import TODAY, add_account, add_category, add_group, add_transaction
from tests.helpers import error


def create_subscription(client: TestClient, account: Account, **changes: Any) -> dict[str, Any]:
    body = {
        "name": "Streamflix",
        "payee": "Streamflix plan",
        "amount": "14.99",
        "frequency": "monthly",
        "account_id": str(account.id),
        "next_due_date": (TODAY + dt.timedelta(days=12)).isoformat(),
        **changes,
    }
    response = client.post("/api/subscriptions", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def payload(**changes: Any) -> dict[str, Any]:
    return {"name": "Streaming", "payees": ["Streamflix"], **changes}


def create(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/automations", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def patch(client: TestClient, automation: dict[str, Any], **changes: Any) -> dict[str, Any]:
    response = client.patch(f"/api/automations/{automation['id']}", json=changes)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def category(session: Session, name: str = "Streaming", kind_group: str = "Media") -> Category:
    return add_category(session, name, add_group(session, kind_group))


def reload(session: Session, transaction: Transaction) -> Transaction:
    session.expire_all()
    return session.get_one(Transaction, transaction.id)


def post_payment(
    client: TestClient, account: Account, payee: str, amount: str = "-9.99", **fields: Any
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


# ---- Who can do what -----------------------------------------------------------------------


def test_signing_in_is_required(client: TestClient) -> None:
    assert error(client.get("/api/automations")) == "not_signed_in"


def test_viewers_can_see_automations_but_not_change_them(
    viewer_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    automation = Automation(
        name="Streaming",
        payees=["Streamflix"],
        category_id=streaming.id,
        apply_to="future",
        active=True,
    )
    session.add(automation)
    session.commit()
    path = f"/api/automations/{automation.id}"

    assert [item["id"] for item in viewer_client.get("/api/automations").json()] == [
        str(automation.id)
    ]
    assert viewer_client.get(path).json()["name"] == "Streaming"
    attempts = [
        viewer_client.post("/api/automations", json=payload(category_id=str(streaming.id))),
        viewer_client.post("/api/automations/preview", json={"payees": ["Streamflix"]}),
        viewer_client.patch(path, json={"name": "Changed"}),
        viewer_client.delete(path),
    ]
    assert [error(response) for response in attempts] == ["admin_only"] * 4


# ---- Creating one --------------------------------------------------------------------------


def test_an_automation_covering_the_past_sorts_every_matching_transaction(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    card = add_account(session, "Rewards card")
    streaming = category(session)
    other = category(session, "Shopping", "Stores")
    mixed_case = add_transaction(session, checking, "-15.49", "STREAMFLIX", category_id=other.id)
    padded = add_transaction(session, card, "-14.99", "  streamflix ")
    refund = add_transaction(session, card, "14.99", "Streamflix")
    already = add_transaction(session, card, "-14.99", "Streamflix", category_id=streaming.id)
    unrelated = add_transaction(session, checking, "-3.00", "Corner Market")

    saved = create(admin_client, payload(category_id=str(streaming.id)))

    assert saved["applied"] == 3
    assert saved["matching_count"] == 4
    assert (saved["active"], saved["apply_to"], saved["payees"]) == (True, "all", ["Streamflix"])
    for sorted_transaction in (mixed_case, padded, refund):
        assert reload(session, sorted_transaction).category_id == streaming.id
    assert reload(session, already).category_id == streaming.id
    assert reload(session, unrelated).category_id is None
    assert admin_client.get(f"/api/automations/{saved['id']}").json() == {
        key: value for key, value in saved.items() if key != "applied"
    }


def test_an_automation_covering_only_the_future_leaves_what_is_there_alone(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    old = add_transaction(session, account, "-14.99", "Streamflix")

    saved = create(admin_client, payload(category_id=str(streaming.id), apply_to="future"))

    assert (saved["applied"], saved["matching_count"]) == (0, 1)
    assert reload(session, old).category_id is None
    new = post_payment(admin_client, account, "streamflix")
    assert new["category_id"] == str(streaming.id)


def test_an_automation_can_be_limited_to_one_account(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    card = add_account(session, "Rewards card")
    streaming = category(session)
    on_card = add_transaction(session, card, "-14.99", "Streamflix")
    on_checking = add_transaction(session, checking, "-14.99", "Streamflix")

    saved = create(admin_client, payload(category_id=str(streaming.id), account_id=str(card.id)))

    assert (saved["applied"], saved["matching_count"]) == (1, 1)
    assert reload(session, on_card).category_id == streaming.id
    assert reload(session, on_checking).category_id is None
    assert post_payment(admin_client, checking, "Streamflix")["category_id"] is None
    assert post_payment(admin_client, card, "Streamflix")["category_id"] == str(streaming.id)


def test_an_automation_links_payments_to_a_subscription_and_settles_its_due_date(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    video = category(session, "Video")
    subscription = create_subscription(admin_client, account, category_id=str(video.id))
    due = TODAY + dt.timedelta(days=12)
    payment = add_transaction(session, account, "-14.99", "Streamflix", date=TODAY)
    older = add_transaction(
        session, account, "-14.99", "Streamflix", date=TODAY - dt.timedelta(days=30)
    )
    refund = add_transaction(session, account, "14.99", "Streamflix", date=TODAY)

    saved = create(admin_client, payload(subscription_id=subscription["id"]))

    assert saved["applied"] == 2
    for linked in (payment, older):
        row = reload(session, linked)
        assert (row.subscription_id, row.category_id) == (
            uuid.UUID(subscription["id"]),
            video.id,
        )
    assert reload(session, refund).subscription_id is None
    assert reload(session, refund).category_id is None
    result = admin_client.get(f"/api/subscriptions/{subscription['id']}").json()
    assert result["payment_count"] == 2
    assert result["last_payment_on"] == TODAY.isoformat()
    # The payment on TODAY is within half a month of the due date, so it settled it.
    assert result["next_due_date"] == (due + dt.timedelta(days=31)).isoformat()


def test_an_automations_own_category_beats_its_subscriptions(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    video = category(session, "Video")
    fun = category(session, "Fun", "Leisure")
    subscription = create_subscription(admin_client, account, category_id=str(video.id))
    payment = add_transaction(session, account, "-14.99", "Streamflix")

    create(admin_client, payload(category_id=str(fun.id), subscription_id=subscription["id"]))

    row = reload(session, payment)
    assert (row.subscription_id, row.category_id) == (uuid.UUID(subscription["id"]), fun.id)
    new = post_payment(admin_client, account, "Streamflix")
    assert (new["subscription_id"], new["category_id"]) == (subscription["id"], str(fun.id))


def test_a_paused_subscription_gets_no_payments_from_an_automation(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    video = category(session, "Video")
    subscription = create_subscription(admin_client, account, payee="Another payee")
    admin_client.patch(f"/api/subscriptions/{subscription['id']}", json={"active": False})
    payment = add_transaction(session, account, "-14.99", "Streamflix")

    saved = create(
        admin_client, payload(category_id=str(video.id), subscription_id=subscription["id"])
    )

    assert saved["applied"] == 1
    row = reload(session, payment)
    assert (row.subscription_id, row.category_id) == (None, video.id)
    new = post_payment(admin_client, account, "Streamflix")
    assert (new["subscription_id"], new["category_id"]) == (None, str(video.id))


def test_the_same_payee_written_twice_counts_once(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)

    saved = create(
        admin_client,
        payload(payees=["Streamflix", " streamflix", "Hulu"], category_id=str(streaming.id)),
    )

    assert saved["payees"] == ["Streamflix", "Hulu"]


def test_an_automation_needs_something_to_do_and_something_to_match(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    no_action = admin_client.post("/api/automations", json=payload())
    assert no_action.status_code == 422
    assert "Choose a category, a subscription, a bill or a budget" in no_action.text
    for body in (
        payload(category_id=str(streaming.id), payees=[]),
        payload(category_id=str(streaming.id), payees=[f"Payee {n}" for n in range(51)]),
        payload(category_id=str(streaming.id), name=" "),
        payload(category_id=str(streaming.id), apply_to="sometimes"),
        payload(category_id=str(streaming.id), unexpected=True),
    ):
        assert admin_client.post("/api/automations", json=body).status_code == 422


def test_an_automation_cannot_point_at_what_does_not_exist(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    missing = str(uuid.uuid4())
    cases = {
        "unknown_account": payload(category_id=str(streaming.id), account_id=missing),
        "unknown_category": payload(category_id=missing),
        "unknown_subscription": payload(category_id=str(streaming.id), subscription_id=missing),
    }
    for code, body in cases.items():
        response = admin_client.post("/api/automations", json=body)
        assert (response.status_code, error(response)) == (422, code)


def test_automations_that_overlap_are_allowed_and_the_older_one_wins(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    older_category = category(session, "Older")
    newer_category = category(session, "Newer", "Other")
    mine = add_transaction(session, account, "-14.99", "Streamflix")
    extra = add_transaction(session, account, "-3.00", "Streamflix Extra")
    older = create(admin_client, payload(category_id=str(older_category.id)))
    assert (older["applied"], reload(session, mine).category_id) == (1, older_category.id)

    # The newer one sorts what the older one doesn't, and leaves what it does to it.
    newer = create(
        admin_client,
        payload(
            name="Anything Streamflix",
            payees=["streamflix"],
            match="contains",
            category_id=str(newer_category.id),
        ),
    )

    assert newer["applied"] == 1
    assert reload(session, mine).category_id == older_category.id
    assert reload(session, extra).category_id == newer_category.id
    # Arriving, it's the same: the older one wins where both would.
    arrived = post_payment(admin_client, account, "Streamflix")
    assert arrived["category_id"] == str(older_category.id)
    assert post_payment(admin_client, account, "Streamflix Premium")["category_id"] == str(
        newer_category.id
    )
    # Pausing the older one lets the newer one have what they shared, once it's sorted again.
    patch(admin_client, older, active=False)
    assert post_payment(admin_client, account, "Streamflix")["category_id"] == str(
        newer_category.id
    )
    resorted = patch(admin_client, newer, apply_to="future")
    assert resorted["applied"] == 0


def test_a_subscriptions_link_goes_to_the_older_automation_that_gives_one(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    older_subscription = create_subscription(admin_client, account, name="Older", payee="Nobody")
    newer_subscription = create_subscription(admin_client, account, name="Newer", payee="Nothing")
    payment = add_transaction(session, account, "-14.99", "Streamflix")
    create(admin_client, payload(subscription_id=older_subscription["id"]))
    assert reload(session, payment).subscription_id == uuid.UUID(older_subscription["id"])

    newer = create(
        admin_client,
        payload(name="Newer", subscription_id=newer_subscription["id"], match="contains"),
    )
    # The older automation keeps what it linked.
    assert newer["applied"] == 0
    assert reload(session, payment).subscription_id == uuid.UUID(older_subscription["id"])

    # Once its subscription is paused it isn't linking anything, so the newer one has it.
    admin_client.patch(f"/api/subscriptions/{older_subscription['id']}", json={"active": False})
    again = patch(
        admin_client,
        newer,
        name="Newer, again",
        subscription_id=newer_subscription["id"],
        payees=["flix"],
    )
    assert again["applied"] == 1
    assert reload(session, payment).subscription_id == uuid.UUID(newer_subscription["id"])


# ---- Reading them ---------------------------------------------------------------------------


def test_automations_list_active_ones_first_then_newest(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    older = create(admin_client, payload(name="Old", payees=["A"], category_id=str(streaming.id)))
    paused = create(
        admin_client, payload(name="Paused", payees=["B"], category_id=str(streaming.id))
    )
    newer = create(admin_client, payload(name="New", payees=["C"], category_id=str(streaming.id)))
    patch(admin_client, paused, active=False)

    listed = admin_client.get("/api/automations").json()

    assert [item["name"] for item in listed] == ["New", "Old", "Paused"]
    assert [item["id"] for item in listed[:2]] == [newer["id"], older["id"]]
    assert admin_client.get(f"/api/automations/{uuid.uuid4()}").status_code == 404


def test_preview_says_what_would_be_sorted_and_which_automations_overlap(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    subscription = create_subscription(admin_client, account, payee="Elsewhere")
    add_transaction(session, account, "-14.99", "Streamflix")
    add_transaction(session, account, "-12.99", "streamflix ")
    add_transaction(session, account, "-5.00", "Other")
    existing = create(
        admin_client,
        payload(payees=["Streamflix"], category_id=str(streaming.id), apply_to="future"),
    )
    linking = create(
        admin_client,
        payload(name="Linking", payees=["streamflix"], subscription_id=subscription["id"]),
    )

    preview = admin_client.post(
        "/api/automations/preview",
        json={"payees": ["Streamflix", "Hulu"], "category": True, "subscription": True},
    ).json()
    assert preview["matching"] == 2
    assert preview["overlaps"] == [
        {"automation_id": existing["id"], "automation_name": "Streaming", "count": 2},
        {"automation_id": linking["id"], "automation_name": "Linking", "count": 2},
    ]
    # Only what it would give can overlap, and not with the automation being changed.
    only_category = admin_client.post(
        "/api/automations/preview",
        json={"payees": ["Streamflix"], "category": True, "automation_id": existing["id"]},
    ).json()
    assert only_category["overlaps"] == []
    nothing = admin_client.post("/api/automations/preview", json={"payees": ["Streamflix"]}).json()
    assert nothing["overlaps"] == []
    elsewhere = admin_client.post(
        "/api/automations/preview",
        json={"payees": ["Streamflix"], "category": True, "account_id": str(uuid.uuid4())},
    ).json()
    assert (elsewhere["matching"], elsewhere["overlaps"]) == (0, [])
    # How it matches decides what it finds.
    contains = admin_client.post(
        "/api/automations/preview",
        json={"payees": ["stream"], "match": "contains", "category": True},
    ).json()
    assert (contains["matching"], len(contains["overlaps"])) == (2, 1)
    wrong = admin_client.post(
        "/api/automations/preview",
        json={"payees": ["Streamflix"], "min_amount": "20.00", "max_amount": "10.00"},
    )
    assert wrong.status_code == 422


# ---- Changing them --------------------------------------------------------------------------


def test_renaming_an_automation_does_not_sort_anything_again(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    other = category(session, "Shopping", "Stores")
    transaction = add_transaction(session, account, "-14.99", "Streamflix")
    saved = create(admin_client, payload(category_id=str(streaming.id)))
    transaction.category_id = other.id
    session.commit()

    renamed = patch(admin_client, saved, name="Streaming TV")

    assert (renamed["name"], renamed["applied"]) == ("Streaming TV", 0)
    assert reload(session, transaction).category_id == other.id


def test_changing_what_an_automation_gives_sorts_what_is_there_again(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    fun = category(session, "Fun", "Leisure")
    transaction = add_transaction(session, account, "-14.99", "Streamflix")
    saved = create(admin_client, payload(category_id=str(streaming.id)))

    changed = patch(admin_client, saved, category_id=str(fun.id))

    assert changed["applied"] == 1
    assert reload(session, transaction).category_id == fun.id


def test_adding_payees_only_sorts_the_new_ones(admin_client: TestClient, session: Session) -> None:
    account = add_account(session)
    streaming = category(session)
    other = category(session, "Shopping", "Stores")
    old = add_transaction(session, account, "-14.99", "Streamflix")
    new = add_transaction(session, account, "-9.99", "Hulu")
    saved = create(admin_client, payload(category_id=str(streaming.id)))
    old.category_id = other.id
    session.commit()

    added = patch(admin_client, saved, payees=["Streamflix", "Hulu"])
    assert (added["applied"], added["payees"]) == (1, ["Streamflix", "Hulu"])
    assert reload(session, new).category_id == streaming.id
    assert reload(session, old).category_id == other.id

    # Taking one out sorts nothing.
    assert patch(admin_client, saved, payees=["Hulu"])["applied"] == 0


def test_covering_the_past_later_sorts_what_is_there(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    transaction = add_transaction(session, account, "-14.99", "Streamflix")
    saved = create(admin_client, payload(category_id=str(streaming.id), apply_to="future"))
    assert reload(session, transaction).category_id is None

    changed = patch(admin_client, saved, apply_to="all")
    assert (changed["applied"], changed["apply_to"]) == (1, "all")
    assert reload(session, transaction).category_id == streaming.id

    # Going back to the future only leaves it as it is.
    back = patch(admin_client, saved, apply_to="future")
    assert (back["applied"], back["apply_to"]) == (0, "future")


def test_a_paused_automation_sorts_nothing_until_it_is_resumed(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    saved = create(admin_client, payload(category_id=str(streaming.id)))
    paused = patch(admin_client, saved, active=False)
    assert (paused["active"], paused["applied"]) == (False, 0)

    arrived = post_payment(admin_client, account, "Streamflix")
    assert arrived["category_id"] is None
    # Changing what a paused automation does sorts nothing either.
    assert patch(admin_client, saved, name="Still paused")["applied"] == 0

    resumed = patch(admin_client, saved, active=True)
    assert (resumed["active"], resumed["applied"]) == (True, 1)
    assert reload(session, session.get_one(Transaction, uuid.UUID(arrived["id"]))).category_id == (
        streaming.id
    )


def test_an_automation_can_move_to_another_account_or_to_every_account(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    card = add_account(session, "Rewards card")
    streaming = category(session)
    on_card = add_transaction(session, card, "-14.99", "Streamflix")
    saved = create(
        admin_client, payload(category_id=str(streaming.id), account_id=str(checking.id))
    )
    assert saved["applied"] == 0

    moved = patch(admin_client, saved, account_id=str(card.id))
    assert moved["applied"] == 1
    assert reload(session, on_card).category_id == streaming.id

    everywhere = patch(admin_client, saved, account_id=None)
    assert (everywhere["account_id"], everywhere["applied"]) == (None, 0)


def test_an_automation_keeps_something_to_do(admin_client: TestClient, session: Session) -> None:
    account = add_account(session)
    streaming = category(session)
    subscription = create_subscription(admin_client, account)
    saved = create(
        admin_client, payload(category_id=str(streaming.id), subscription_id=subscription["id"])
    )

    only_subscription = patch(admin_client, saved, category_id=None)
    assert only_subscription["category_id"] is None
    only_category = patch(admin_client, saved, category_id=str(streaming.id), subscription_id=None)
    assert only_category["subscription_id"] is None
    nothing = admin_client.patch(f"/api/automations/{saved['id']}", json={"category_id": None})
    assert (nothing.status_code, error(nothing)) == (422, "no_action")


def test_changes_to_an_automation_are_checked(admin_client: TestClient, session: Session) -> None:
    streaming = category(session)
    saved = create(admin_client, payload(category_id=str(streaming.id)))
    path = f"/api/automations/{saved['id']}"
    missing = str(uuid.uuid4())

    assert error(admin_client.patch(path, json={"category_id": missing})) == "unknown_category"
    assert error(admin_client.patch(path, json={"account_id": missing})) == "unknown_account"
    assert error(admin_client.patch(path, json={"subscription_id": missing})) == (
        "unknown_subscription"
    )
    assert admin_client.patch(path, json={"payees": []}).status_code == 422
    assert error(admin_client.patch(f"/api/automations/{missing}", json={"name": "A"})) == (
        "not_found"
    )


# ---- Removing them --------------------------------------------------------------------------


def test_deleting_an_automation_keeps_what_it_sorted(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    transaction = add_transaction(session, account, "-14.99", "Streamflix")
    saved = create(admin_client, payload(category_id=str(streaming.id)))

    response = admin_client.delete(f"/api/automations/{saved['id']}")

    assert response.status_code == 204
    assert reload(session, transaction).category_id == streaming.id
    assert admin_client.get("/api/automations").json() == []
    assert error(admin_client.delete(f"/api/automations/{saved['id']}")) == "not_found"
    assert post_payment(admin_client, account, "Streamflix", "-1.00")["category_id"] is None


def test_what_an_automation_points_at_can_go_away(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    streaming = category(session)
    subscription = create_subscription(admin_client, checking)
    scoped = create(
        admin_client,
        payload(
            name="Scoped",
            payees=["Hulu"],
            category_id=str(streaming.id),
            account_id=str(checking.id),
            subscription_id=subscription["id"],
        ),
    )

    admin_client.delete(f"/api/subscriptions/{subscription['id']}")
    session.delete(streaming)
    session.commit()
    session.expire_all()
    left = session.get_one(Automation, uuid.UUID(scoped["id"]))
    assert (left.category_id, left.subscription_id) == (None, None)
    # With nothing to give it does nothing, so a payment isn't touched.
    assert post_payment(admin_client, checking, "Hulu")["category_id"] is None

    session.delete(session.get_one(Account, checking.id))
    session.commit()
    session.expire_all()
    assert session.get(Automation, uuid.UUID(scoped["id"])) is None


# ---- Sorting what arrives -------------------------------------------------------------------


def test_the_oldest_automation_wins_what_it_gives_and_the_others_fill_the_rest(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    first_category = category(session, "First")
    second_category = category(session, "Second", "Other")
    subscription = create_subscription(admin_client, account, payee="Elsewhere")
    first = Automation(
        name="First",
        payees=["Streamflix"],
        category_id=first_category.id,
        apply_to="future",
        created_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC),
    )
    second = Automation(
        name="Second",
        payees=["Streamflix"],
        category_id=second_category.id,
        subscription_id=uuid.UUID(subscription["id"]),
        apply_to="future",
        created_at=dt.datetime(2026, 2, 1, tzinfo=dt.UTC),
    )
    # Two admins naming a payee at the same moment can end up with both.
    session.add_all([first, second])
    session.commit()

    arrived = post_payment(admin_client, account, "Streamflix")

    assert arrived["category_id"] == str(first_category.id)
    assert arrived["subscription_id"] == subscription["id"]
    refund = post_payment(admin_client, account, "Streamflix", "5.00")
    assert (refund["category_id"], refund["subscription_id"]) == (str(first_category.id), None)


def test_an_automation_comes_before_a_subscriptions_own_matching(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    video = category(session, "Video")
    fun = category(session, "Fun", "Leisure")
    subscription = create_subscription(
        admin_client, account, payee="Streamflix", category_id=str(video.id)
    )
    other = create_subscription(admin_client, account, name="Other", payee="Different")
    create(
        admin_client,
        payload(subscription_id=other["id"], category_id=str(fun.id), apply_to="future"),
    )

    arrived = post_payment(admin_client, account, "Streamflix")

    assert arrived["subscription_id"] == other["id"]
    assert arrived["category_id"] == str(fun.id)
    assert subscription["id"] != other["id"]


def test_sorting_a_payment_already_linked_to_the_subscription_changes_nothing(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    subscription = create_subscription(admin_client, account, payee="Elsewhere")
    create(
        admin_client,
        payload(subscription_id=subscription["id"], apply_to="future"),
    )
    payment = add_transaction(
        session, account, "-14.99", "Hulu", date=TODAY - dt.timedelta(days=45)
    )
    response = admin_client.post(
        f"/api/subscriptions/{subscription['id']}/payments", json={"ids": [str(payment.id)]}
    )
    assert response.status_code == 200
    before = admin_client.get(f"/api/subscriptions/{subscription['id']}").json()

    renamed = admin_client.patch(f"/api/transactions/{payment.id}", json={"payee": "Streamflix"})

    assert renamed.json()["subscription_id"] == subscription["id"]
    assert admin_client.get(f"/api/subscriptions/{subscription['id']}").json() == before


# ---- Looking in the payee and in what the bank called it ----------------------------------


def test_text_is_found_in_the_payee_or_in_what_the_bank_called_it(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    described = add_transaction(
        session, account, "-15.49", "Netflix", original_description="NETFLIX.COM 866-579-7172 CA"
    )
    named = add_transaction(session, account, "-9.99", "NETFLIX Premium")
    other = add_transaction(
        session, account, "-4.00", "Hulu", original_description="HULU 877-8244858"
    )

    saved = create(
        admin_client,
        payload(payees=["netflix.com"], match="contains", category_id=str(streaming.id)),
    )

    assert (saved["applied"], saved["matching_count"]) == (1, 1)
    assert reload(session, described).category_id == streaming.id
    assert reload(session, named).category_id is None
    assert reload(session, other).category_id is None
    # What arrives later is read the same way, however it came.
    assert post_payment(admin_client, account, "Netflix.com Premium")["category_id"] == str(
        streaming.id
    )
    assert post_payment(admin_client, account, "Netflix Premium")["category_id"] is None


@pytest.mark.parametrize(
    ("match", "text", "payee", "found"),
    [
        ("exact", "Whole Foods", "  whole   FOODS ", True),
        ("exact", "Whole Foods", "Whole Foods Market", False),
        ("starts_with", "AMZN Mktp", "amzn mktp us*2k4tt3y81", True),
        ("starts_with", "AMZN Mktp", "Paid AMZN Mktp", False),
        ("contains", "mktp us", "AMZN Mktp US*2K4TT3Y81", True),
        ("contains", "mktp us", "AMZN Marketplace", False),
        # What would be wildcards or patterns in the database or in a pattern are plain text.
        ("contains", "100%", "100% Pure", True),
        ("contains", "100%", "1000 Pure", False),
        ("contains", "pure_coffee", "Pure_Coffee Co", True),
        ("contains", "pure_coffee", "Pure Coffee Co", False),
        ("starts_with", "(sf) cafe", "(SF) Cafe #1", True),
        ("starts_with", "(sf) cafe", "SF Cafe #1", False),
        ("contains", "us*2k", "AMZN US*2K4", True),
        ("contains", "us*2k", "AMZN USS2K4", False),
        ("exact", "a.b", "A.B", True),
        ("exact", "a.b", "AxB", False),
    ],
)
def test_a_payee_is_compared_the_same_way_in_the_database_and_as_it_arrives(
    admin_client: TestClient,
    session: Session,
    match: str,
    text: str,
    payee: str,
    found: bool,
) -> None:
    account = add_account(session)
    streaming = category(session)
    existing = add_transaction(session, account, "-5.00", payee)

    saved = create(admin_client, payload(payees=[text], match=match, category_id=str(streaming.id)))

    assert saved["applied"] == int(found)
    assert (reload(session, existing).category_id == streaming.id) is found
    arrived = post_payment(admin_client, account, payee)
    assert (arrived["category_id"] == str(streaming.id)) is found


def test_changing_how_an_automation_looks_sorts_what_it_now_finds(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    exact = add_transaction(session, account, "-5.00", "Streamflix")
    longer = add_transaction(session, account, "-6.00", "Streamflix Plus")
    saved = create(admin_client, payload(category_id=str(streaming.id)))
    assert reload(session, longer).category_id is None

    wider = patch(admin_client, saved, match="starts_with")

    assert (wider["applied"], wider["match"]) == (1, "starts_with")
    assert reload(session, longer).category_id == streaming.id
    assert reload(session, exact).category_id == streaming.id


# ---- How much it was for ------------------------------------------------------------------


def test_an_automation_can_be_for_one_amount_when_a_payee_bills_several_subscriptions(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    icloud = create_subscription(admin_client, account, name="iCloud", payee="Nobody")
    music = create_subscription(admin_client, account, name="Music", payee="Nothing")
    small = add_transaction(session, account, "-2.99", "Apple.com/bill")
    big = add_transaction(session, account, "-10.99", "Apple.com/bill")
    other = add_transaction(session, account, "-5.00", "Apple.com/bill")

    first = create(
        admin_client,
        payload(
            name="iCloud",
            payees=["Apple.com/bill"],
            min_amount="2.99",
            max_amount="2.99",
            subscription_id=icloud["id"],
        ),
    )
    second = create(
        admin_client,
        payload(
            name="Music",
            payees=["Apple.com/bill"],
            min_amount="10.99",
            max_amount="10.99",
            subscription_id=music["id"],
        ),
    )

    assert (first["applied"], first["matching_count"]) == (1, 1)
    assert (second["applied"], second["matching_count"]) == (1, 1)
    assert reload(session, small).subscription_id == uuid.UUID(icloud["id"])
    assert reload(session, big).subscription_id == uuid.UUID(music["id"])
    assert reload(session, other).subscription_id is None
    # New ones are told apart the same way.
    assert (
        post_payment(admin_client, account, "Apple.com/bill", "-2.99")["subscription_id"]
        == (icloud["id"])
    )
    assert (
        post_payment(admin_client, account, "Apple.com/bill", "-10.99")["subscription_id"]
        == (music["id"])
    )
    assert post_payment(admin_client, account, "Apple.com/bill", "-7.00")["subscription_id"] is None
    assert (first["min_amount"], first["max_amount"]) == ("2.99", "2.99")


def test_an_automation_for_a_bill_that_changes_every_month_leaves_the_amount_open(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    utilities = category(session, "Utilities")
    bills = [
        add_transaction(session, account, amount, "City Power & Light")
        for amount in ("-88.10", "-142.30", "-96.40")
    ]

    saved = create(
        admin_client, payload(payees=["City Power & Light"], category_id=str(utilities.id))
    )

    assert saved["applied"] == 3
    assert [reload(session, bill).category_id for bill in bills] == [utilities.id] * 3
    assert post_payment(admin_client, account, "City Power & Light", "-210.55")["category_id"] == (
        str(utilities.id)
    )
    assert (saved["min_amount"], saved["max_amount"]) == (None, None)


@pytest.mark.parametrize(
    ("low", "high", "found"),
    [
        (None, None, [2, 5, 9, 15, 30]),
        ("5.00", None, [5, 9, 15, 30]),
        (None, "9.00", [2, 5, 9]),
        ("5.00", "9.00", [5, 9]),
        ("9.00", "9.00", [9]),
    ],
)
def test_amounts_count_whichever_way_the_money_went(
    admin_client: TestClient,
    session: Session,
    low: str | None,
    high: str | None,
    found: list[int],
) -> None:
    account = add_account(session)
    streaming = category(session)
    rows = {
        2: add_transaction(session, account, "-2.00", "Streamflix"),
        5: add_transaction(session, account, "5.00", "Streamflix"),
        9: add_transaction(session, account, "-9.00", "Streamflix"),
        15: add_transaction(session, account, "15.00", "Streamflix"),
        30: add_transaction(session, account, "-30.00", "Streamflix"),
    }

    saved = create(
        admin_client,
        payload(category_id=str(streaming.id), min_amount=low, max_amount=high),
    )

    assert saved["applied"] == len(found)
    assert {size for size, row in rows.items() if reload(session, row).category_id} == set(found)
    for size in rows:
        arrived = post_payment(admin_client, account, "Streamflix", f"-{size}.00")
        assert (arrived["category_id"] is not None) is (size in found)


def test_the_amounts_an_automation_is_for_can_change_or_be_taken_away(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    streaming = category(session)
    small = add_transaction(session, account, "-2.00", "Streamflix")
    big = add_transaction(session, account, "-20.00", "Streamflix")
    saved = create(
        admin_client, payload(category_id=str(streaming.id), min_amount="1.00", max_amount="5.00")
    )
    assert (saved["applied"], reload(session, big).category_id) == (1, None)

    wider = patch(admin_client, saved, max_amount="25.00")
    assert (wider["applied"], wider["max_amount"]) == (1, "25.00")
    assert reload(session, big).category_id == streaming.id

    # A name alone leaves the amounts as they are.
    renamed = patch(admin_client, saved, name="Renamed")
    assert (renamed["min_amount"], renamed["max_amount"]) == ("1.00", "25.00")

    open_ended = patch(admin_client, saved, min_amount=None, max_amount=None)
    assert (open_ended["min_amount"], open_ended["max_amount"]) == (None, None)
    assert reload(session, small).category_id == streaming.id


def test_the_smallest_amount_cannot_be_more_than_the_largest(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    body = payload(category_id=str(streaming.id), min_amount="10.00", max_amount="5.00")
    created = admin_client.post("/api/automations", json=body)
    assert created.status_code == 422
    assert "can't be more than the largest" in created.text

    saved = create(admin_client, payload(category_id=str(streaming.id), min_amount="1.00"))
    changed = admin_client.patch(
        f"/api/automations/{saved['id']}", json={"min_amount": "10.00", "max_amount": "5.00"}
    )
    assert (changed.status_code, error(changed)) == (422, "amount_range")
    just_min = admin_client.patch(f"/api/automations/{saved['id']}", json={"max_amount": "0.50"})
    assert error(just_min) == "amount_range"


# ---- Counting toward budgets ----------------------------------------------------------------


def make_budget(client: TestClient, name: str = "Monthly") -> dict[str, Any]:
    response = client.post(
        "/api/budgets",
        json={"name": name, "period": "monthly", "amount": "2000", "today": TODAY.isoformat()},
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def test_an_automation_can_count_what_it_sorts_toward_a_budget_and_do_nothing_else(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    add_transaction(session, account, "2400.00", "Acme Corp", date=TODAY)
    monthly = make_budget(admin_client)

    created = create(
        admin_client,
        {
            "name": "Paycheck",
            "payees": ["Acme Corp"],
            "counts": [{"budget_id": monthly["id"], "kind": "income"}],
        },
    )

    counts = [{"budget_id": monthly["id"], "kind": "income"}]
    assert (created["category_id"], created["subscription_id"], created["counts"]) == (
        None,
        None,
        counts,
    )
    assert admin_client.get("/api/automations").json()[0]["counts"] == counts
    assert admin_client.get(f"/api/automations/{created['id']}").json()["counts"] == counts
    period = admin_client.get(
        f"/api/budgets/{monthly['id']}/period", params={"today": TODAY.isoformat()}
    ).json()
    assert (period["income"], period["sources"][0]["name"]) == ("2400.00", "Paycheck")


def test_the_budgets_an_automation_counts_toward_can_change(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    monthly, yearly = make_budget(admin_client), make_budget(admin_client, "Yearly")
    first = {"budget_id": monthly["id"], "kind": "income"}
    second = {"budget_id": yearly["id"], "kind": "spending"}
    automation = create(admin_client, payload(category_id=str(streaming.id), counts=[first]))

    both = patch(admin_client, automation, counts=[{**first, "kind": "spending"}, second])
    assert both["counts"] == [{**first, "kind": "spending"}, second]
    assert patch(admin_client, automation, counts=[second])["counts"] == [second]
    # Leaving them out keeps them, and an empty list takes them all away.
    assert patch(admin_client, automation, name="Renamed")["counts"] == [second]
    assert patch(admin_client, automation, counts=[])["counts"] == []
    assert session.query(BudgetLink).count() == 0


def test_an_automation_that_counts_toward_budgets_can_go_without_a_category(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    monthly = make_budget(admin_client)
    counts = [{"budget_id": monthly["id"], "kind": "spending"}]
    automation = create(admin_client, payload(category_id=str(streaming.id), counts=counts))

    assert patch(admin_client, automation, category_id=None)["counts"] == counts

    response = admin_client.patch(f"/api/automations/{automation['id']}", json={"counts": []})
    assert (response.status_code, error(response)) == (422, "no_action")


def test_the_budgets_an_automation_counts_toward_have_to_exist_once_each(
    admin_client: TestClient, session: Session
) -> None:
    streaming = category(session)
    monthly = make_budget(admin_client)
    gone = {"budget_id": str(uuid.uuid4()), "kind": "income"}
    twice = [
        {"budget_id": monthly["id"], "kind": "income"},
        {"budget_id": monthly["id"], "kind": "spending"},
    ]
    automation = create(admin_client, payload(category_id=str(streaming.id)))

    attempts = [
        admin_client.post("/api/automations", json=payload(counts=[gone])),
        admin_client.post(
            "/api/automations", json=payload(category_id=str(streaming.id), counts=twice)
        ),
        admin_client.patch(f"/api/automations/{automation['id']}", json={"counts": [gone]}),
        admin_client.patch(f"/api/automations/{automation['id']}", json={"counts": twice}),
    ]

    assert [error(response) for response in attempts] == [
        "unknown_budget",
        "duplicate_budget",
        "unknown_budget",
        "duplicate_budget",
    ]
    too_many = [{"budget_id": monthly["id"], "kind": "income"}] * 21
    assert (
        admin_client.post(
            "/api/automations", json=payload(category_id=str(streaming.id), counts=too_many)
        ).status_code
        == 422
    )


def test_counting_stops_with_the_automation_or_the_budget(
    admin_client: TestClient, session: Session
) -> None:
    monthly, yearly = make_budget(admin_client), make_budget(admin_client, "Yearly")
    streaming = category(session)
    first = create(
        admin_client,
        payload(
            category_id=str(streaming.id), counts=[{"budget_id": monthly["id"], "kind": "income"}]
        ),
    )
    second = create(
        admin_client,
        payload(
            name="Other",
            payees=["Hulu"],
            counts=[{"budget_id": yearly["id"], "kind": "spending"}],
        ),
    )

    assert admin_client.delete(f"/api/automations/{first['id']}").status_code == 204
    assert session.query(BudgetLink).count() == 1
    assert admin_client.delete(f"/api/budgets/{yearly['id']}").status_code == 204

    assert session.query(BudgetLink).count() == 0
    assert admin_client.get(f"/api/automations/{second['id']}").json()["counts"] == []


# ---- Bills ---------------------------------------------------------------------------------


def create_bill(client: TestClient, account: Account, **changes: Any) -> dict[str, Any]:
    body = {
        "name": "City Power",
        "payee": "City Power",
        "amount": "96.40",
        "amount_varies": True,
        "frequency": "monthly",
        "account_id": str(account.id),
        "next_due_date": (TODAY + dt.timedelta(days=12)).isoformat(),
        **changes,
    }
    response = client.post("/api/bills", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def test_an_automation_links_a_bills_payments_from_any_account_whatever_they_are_called(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    card = add_account(session, "Rewards card")
    utilities = category(session, "Utilities", "Home")
    bill = create_bill(admin_client, checking, category_id=str(utilities.id))
    # Each account writes the same company differently, and neither is the bill's own payee.
    by_card = add_transaction(
        session,
        card,
        "-101.25",
        "City Power",
        original_description="CITYPWR*8841 AUSTIN TX",
        date=TODAY - dt.timedelta(days=45),
    )
    by_bank = add_transaction(
        session, checking, "-88.10", "CITYPWR ONLINE", date=TODAY - dt.timedelta(days=15)
    )
    refund = add_transaction(session, card, "12.00", "CITYPWR refund")

    saved = create(
        admin_client,
        payload(
            name="Electricity", payees=["citypwr"], match="contains", subscription_id=bill["id"]
        ),
    )

    # Money out was linked to the bill and took its category; money in wasn't.
    assert saved["applied"] >= 2
    for linked in (by_card, by_bank):
        row = reload(session, linked)
        assert (row.subscription_id, row.category_id) == (uuid.UUID(bill["id"]), utilities.id)
    assert reload(session, refund).subscription_id is None
    result = admin_client.get(f"/api/bills/{bill['id']}").json()
    assert (result["kind"], result["payment_count"]) == ("bill", 2)
    assert result["last_payment_on"] == (TODAY - dt.timedelta(days=15)).isoformat()

    # The next one to come in is linked as it arrives, however it gets there.
    coming = post_payment(admin_client, card, "CITYPWR*9912", "-97.00")
    assert (coming["subscription_id"], coming["category_id"]) == (bill["id"], str(utilities.id))
    after = admin_client.get(f"/api/bills/{bill['id']}").json()
    assert after["payment_count"] == 3
    assert after["next_due_date"] > bill["next_due_date"]
    # And the automation says which bill it links to.
    listed = admin_client.get("/api/automations").json()
    assert [item["subscription_id"] for item in listed] == [bill["id"]]


def test_an_existing_automation_can_be_pointed_at_a_bill_and_sorts_what_is_there(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    bill = create_bill(admin_client, account, payee="Somewhere else")
    payment = add_transaction(session, account, "-90.00", "City Power")
    automation = create(
        admin_client,
        payload(name="Power", payees=["City Power"], category_id=str(category(session).id)),
    )
    assert reload(session, payment).subscription_id is None

    saved = patch(admin_client, automation, subscription_id=bill["id"])

    assert saved["subscription_id"] == bill["id"]
    assert reload(session, payment).subscription_id == uuid.UUID(bill["id"])
