"""Subscriptions and bills that end: a day they end on, cancelling one instead of deleting it, which
keeps it and everything it tracked, and reactivating one that has stopped."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.finance import subscriptions
from app.models import (
    Account,
    Automation,
    BudgetLink,
    PaymentFrequency,
    RecurringKind,
    Subscription,
    Transaction,
)
from tests.finance import TODAY, add_account, add_transaction
from tests.helpers import error

KINDS = pytest.mark.parametrize("path", ["subscriptions", "bills"])
OTHER = {"bills": "subscriptions", "subscriptions": "bills"}
ENDS = TODAY + dt.timedelta(days=30)


def payload(account: Account, **changes: Any) -> dict[str, Any]:
    return {
        "name": "Streamflix",
        "amount": "14.99",
        "frequency": "monthly",
        "account_id": str(account.id),
        "next_due_date": (TODAY + dt.timedelta(days=12)).isoformat(),
        **changes,
    }


def create(client: TestClient, path: str, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(f"/api/{path}", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def add_item(session: Session, account: Account, kind: RecurringKind) -> Subscription:
    item = Subscription(
        name="Streamflix",
        kind=kind,
        payee="Streamflix",
        amount=Decimal("14.99"),
        frequency=PaymentFrequency.MONTHLY,
        account_id=account.id,
        next_due_date=TODAY,
    )
    session.add(item)
    session.commit()
    return item


def cancel(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> httpx.Response:
    return client.post(f"/api/{path}/{item['id']}/cancellation", json=body)


def cancelled(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = cancel(client, path, item, **body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def reactivate(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> httpx.Response:
    return client.post(f"/api/{path}/{item['id']}/reactivation", json=body)


def reactivated(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = reactivate(client, path, item, **body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def fetch(client: TestClient, path: str, item: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = client.get(f"/api/{path}/{item['id']}").json()
    return result


def ends(item: dict[str, Any]) -> tuple[str | None, str | None]:
    return item["cancelled_on"], item["ends_on"]


# ---- The day it ends -----------------------------------------------------------------------


@KINDS
def test_one_that_carries_on_has_no_end_and_one_can_be_made_with_one(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)

    carrying_on = create(admin_client, path, payload(account))
    ending = create(admin_client, path, payload(account, name="Trial", ends_on=ENDS.isoformat()))

    assert ends(carrying_on) == (None, None)
    assert ends(ending) == (None, ENDS.isoformat())
    assert ends(fetch(admin_client, path, ending)) == (None, ENDS.isoformat())


@KINDS
def test_the_day_it_ends_can_be_set_moved_and_taken_away(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    url = f"/api/{path}/{item['id']}"

    set_it = admin_client.patch(url, json={"ends_on": ENDS.isoformat()}).json()
    # Leaving it out of a change leaves it as it is.
    renamed = admin_client.patch(url, json={"name": "Renamed"}).json()
    moved = admin_client.patch(url, json={"ends_on": "2027-01-31"}).json()
    taken_away = admin_client.patch(url, json={"ends_on": None}).json()

    assert ends(set_it) == (None, ENDS.isoformat())
    assert ends(renamed) == (None, ENDS.isoformat())
    assert ends(moved) == (None, "2027-01-31")
    assert ends(taken_away) == (None, None)


@KINDS
@pytest.mark.parametrize("day", ["1969-12-31", "2200-01-01", "tomorrow", [], {"on": "2027-01-01"}])
def test_a_day_it_ends_that_is_not_a_sensible_date_is_refused(
    admin_client: TestClient, session: Session, path: str, day: object
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    made = admin_client.post(f"/api/{path}", json=payload(account, name="Other", ends_on=day))
    changed = admin_client.patch(f"/api/{path}/{item['id']}", json={"ends_on": day})
    cancelled_with = cancel(admin_client, path, item, ends_on=day)

    assert [response.status_code for response in (made, changed, cancelled_with)] == [422] * 3
    assert ends(fetch(admin_client, path, item)) == (None, None)


@KINDS
def test_the_day_it_was_cancelled_can_only_be_set_by_cancelling(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    made = admin_client.post(
        f"/api/{path}", json=payload(account, name="Other", cancelled_on=TODAY.isoformat())
    )
    changed = admin_client.patch(
        f"/api/{path}/{item['id']}", json={"cancelled_on": TODAY.isoformat()}
    )

    assert [response.status_code for response in (made, changed)] == [422, 422]
    assert ends(fetch(admin_client, path, item)) == (None, None)


# ---- Cancelling ----------------------------------------------------------------------------


@KINDS
def test_cancelling_keeps_it_and_everything_it_tracked(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    add_transaction(session, account, "-14.99", "Streamflix")
    add_transaction(session, account, "-14.99", "Streamflix")
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    assert item["payment_count"] == 2

    done = cancelled(
        admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat()
    )

    assert ends(done) == (TODAY.isoformat(), ENDS.isoformat())
    assert (done["id"], done["name"], done["payment_count"], done["active"]) == (
        item["id"],
        "Streamflix",
        2,
        True,
    )
    assert fetch(admin_client, path, item) == done
    assert [listed["id"] for listed in admin_client.get(f"/api/{path}").json()] == [item["id"]]
    linked = admin_client.get("/api/transactions", params={"subscription_id": item["id"]}).json()
    assert linked["total"] == 2


@KINDS
def test_cancelling_without_a_day_it_ends_ends_it_on_the_day_it_was_cancelled(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    done = cancelled(admin_client, path, item, cancelled_on="2026-09-18")

    assert ends(done) == ("2026-09-18", "2026-09-18")


@KINDS
def test_cancelling_without_saying_anything_is_cancelling_today_where_the_server_is(
    admin_client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    monkeypatch.setattr(
        subscriptions, "utcnow", lambda: dt.datetime(2026, 9, 21, 23, 30, tzinfo=dt.UTC)
    )

    done = cancelled(admin_client, path, item)

    assert ends(done) == ("2026-09-21", "2026-09-21")


@KINDS
def test_it_can_be_cancelled_for_a_day_it_ended_before(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    done = cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on="2026-08-01")

    assert ends(done) == (TODAY.isoformat(), "2026-08-01")


@KINDS
def test_cancelling_one_that_has_a_term_replaces_the_day_it_would_have_ended(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, ends_on="2027-06-30"))

    done = cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat())

    assert ends(done) == (TODAY.isoformat(), TODAY.isoformat())


@KINDS
def test_cancelling_twice_is_refused_and_changes_nothing(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    first = cancelled(
        admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat()
    )

    again = cancel(admin_client, path, item, cancelled_on="2026-10-01", ends_on="2026-12-01")

    assert (again.status_code, error(again)) == (409, "already_stopped")
    assert again.json()["detail"]["message"] == (
        f"This {path.removesuffix('s')} is already cancelled or has ended."
    )
    assert fetch(admin_client, path, item) == first


@KINDS
def test_one_that_has_ended_on_its_own_cannot_be_cancelled(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, ends_on="2026-09-01"))

    refused = cancel(admin_client, path, item, cancelled_on=TODAY.isoformat())

    assert (refused.status_code, error(refused)) == (409, "already_stopped")
    assert ends(fetch(admin_client, path, item)) == (None, "2026-09-01")
    # It hasn't ended where it is, a day earlier, so there it can still be cancelled.
    early = cancelled(admin_client, path, item, cancelled_on="2026-08-31", ends_on="2026-08-31")
    assert ends(early) == ("2026-08-31", "2026-08-31")


@KINDS
def test_a_cancellation_that_says_more_than_it_may_is_refused(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    refused = [
        cancel(admin_client, path, item, active=False),
        cancel(admin_client, path, item, cancelled_on="not a day"),
        cancel(admin_client, path, item, ends_on=None, cancelled_on=[]),
    ]

    assert [response.status_code for response in refused] == [422] * 3
    assert ends(fetch(admin_client, path, item)) == (None, None)


@KINDS
def test_payments_are_still_matched_to_one_that_has_been_cancelled(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())

    last = admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": "-14.99",
            "payee": "Streamflix",
        },
    ).json()

    assert last["subscription_id"] == item["id"]
    assert fetch(admin_client, path, item)["payment_count"] == 1


@KINDS
def test_a_cancelled_one_can_be_paused_and_resumed_like_any_other(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())
    url = f"/api/{path}/{item['id']}"

    paused = admin_client.patch(url, json={"active": False}).json()
    resumed = admin_client.patch(url, json={"active": True}).json()

    assert (paused["active"], resumed["active"]) == (False, True)
    assert ends(paused) == ends(resumed) == (TODAY.isoformat(), ENDS.isoformat())


# ---- Reactivating --------------------------------------------------------------------------


@KINDS
def test_a_cancelled_one_is_reactivated_and_works_like_a_regular_one(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    add_transaction(session, account, "-14.99", "Streamflix")
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())

    response = reactivate(admin_client, path, item, today=TODAY.isoformat())

    assert response.status_code == 200, response.text
    back = response.json()
    assert ends(back) == (None, None)
    assert back["active"] is True
    # Its next payment hasn't gone by, so it is still the next, and everything it tracked is there.
    assert (back["payment_count"], back["next_due_date"]) == (1, item["next_due_date"])
    assert fetch(admin_client, path, item) == back
    # It is a regular one again: the payments to come aren't cut short, and a new payment is its.
    page = admin_client.get(
        f"/api/{path}/{item['id']}/overview", params={"today": TODAY.isoformat()}
    ).json()
    assert len(page["upcoming"]) == 6
    payment = admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(account.id),
            "date": TODAY.isoformat(),
            "amount": "-14.99",
            "payee": "Streamflix",
        },
    ).json()
    assert payment["subscription_id"] == item["id"]
    assert fetch(admin_client, path, item)["payment_count"] == 2


@KINDS
@pytest.mark.parametrize(
    ("frequency", "due", "expected"),
    [
        ("weekly", "2026-09-01", "2026-09-22"),
        ("biweekly", "2026-08-01", "2026-09-26"),
        ("monthly", "2026-01-31", "2026-09-30"),
        ("bimonthly", "2026-01-15", "2026-11-15"),
        ("quarterly", "2025-12-05", "2026-12-05"),
        ("semiannual", "2025-03-10", "2027-03-10"),
        ("annual", "2024-03-05", "2027-03-05"),
        # Today is not before today, so it comes back due today; yesterday's is a cycle on.
        ("monthly", "2026-09-20", "2026-09-20"),
        ("monthly", "2026-09-19", "2026-10-19"),
    ],
)
def test_reactivating_picks_its_next_payment_up_on_its_old_schedule_not_already_late(
    admin_client: TestClient, session: Session, path: str, frequency: str, due: str, expected: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, frequency=frequency, next_due_date=due))
    cancelled(admin_client, path, item, cancelled_on=due, ends_on=due)

    back = reactivated(admin_client, path, item, today=TODAY.isoformat())

    assert (back["next_due_date"], ends(back)) == (expected, (None, None))


@KINDS
def test_reactivating_can_say_when_the_next_payment_is_due(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, next_due_date="2026-03-05"))
    cancelled(admin_client, path, item, cancelled_on="2026-03-05", ends_on="2026-03-05")

    back = reactivated(
        admin_client, path, item, next_due_date="2026-12-01", today=TODAY.isoformat()
    )

    assert back["next_due_date"] == "2026-12-01"


@KINDS
def test_reactivating_uses_todays_date_where_the_server_is_when_it_is_not_told(
    admin_client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, next_due_date="2026-08-05"))
    cancelled(admin_client, path, item, cancelled_on="2026-08-05", ends_on="2026-08-05")
    monkeypatch.setattr(
        subscriptions, "utcnow", lambda: dt.datetime(2026, 9, 21, 2, 0, tzinfo=dt.UTC)
    )

    back = reactivated(admin_client, path, item)

    assert back["next_due_date"] == "2026-10-05"


@KINDS
def test_one_that_ended_on_its_own_is_reactivated_the_same_way(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(
        admin_client, path, payload(account, next_due_date="2026-09-01", ends_on="2026-09-01")
    )
    assert ends(item) == (None, "2026-09-01")

    back = reactivated(admin_client, path, item, today=TODAY.isoformat())

    assert (ends(back), back["next_due_date"]) == ((None, None), "2026-10-01")


@KINDS
def test_one_that_is_paused_as_well_is_tracked_again_and_catches_up(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    admin_client.patch(f"/api/{path}/{item['id']}", json={"active": False})
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())
    # Arrived while nothing was being matched.
    late = add_transaction(session, account, "-14.99", "Streamflix")
    assert fetch(admin_client, path, item)["payment_count"] == 0

    back = reactivated(admin_client, path, item, today=TODAY.isoformat())

    assert (back["active"], back["payment_count"]) == (True, 1)
    session.expire_all()
    assert session.get_one(Transaction, late.id).subscription_id == uuid.UUID(item["id"])


@KINDS
def test_reactivating_one_that_is_not_stopped_is_refused_and_changes_nothing(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    carrying_on = create(admin_client, path, payload(account, name="Carrying on", payee="One"))
    ending = create(
        admin_client,
        path,
        payload(account, name="Ending", payee="Two", ends_on=ENDS.isoformat()),
    )

    refusals = [
        reactivate(admin_client, path, carrying_on, today=TODAY.isoformat()),
        reactivate(admin_client, path, ending, today=TODAY.isoformat()),
    ]

    for response in refusals:
        assert (response.status_code, error(response)) == (409, "not_stopped")
        assert response.json()["detail"]["message"] == (
            f"This {path.removesuffix('s')} hasn't been cancelled or ended, "
            "so there is nothing to reactivate."
        )
    # A term that was set and hasn't run out is not stopped, and stays.
    assert ends(fetch(admin_client, path, ending)) == (None, ENDS.isoformat())
    assert ends(fetch(admin_client, path, carrying_on)) == (None, None)


@KINDS
def test_reactivating_one_paid_from_a_closed_account_says_to_choose_another(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())
    account.closed_at = dt.datetime(2026, 9, 1, tzinfo=dt.UTC)
    session.commit()

    refused = reactivate(admin_client, path, item, today=TODAY.isoformat())

    assert (refused.status_code, error(refused)) == (409, "closed_account")
    assert refused.json()["detail"]["message"] == (
        f"This {path.removesuffix('s')} is paid from an account that is closed. "
        "Choose an open account for it in Edit, then reactivate it."
    )
    assert ends(fetch(admin_client, path, item)) == (TODAY.isoformat(), ENDS.isoformat())


@KINDS
@pytest.mark.parametrize(
    "body",
    [{"active": True}, {"next_due_date": "2200-01-01"}, {"next_due_date": "soon"}, {"today": []}],
)
def test_a_reactivation_that_says_more_than_it_may_is_refused(
    admin_client: TestClient, session: Session, path: str, body: dict[str, Any]
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())

    refused = reactivate(admin_client, path, item, **body)

    assert refused.status_code == 422
    assert ends(fetch(admin_client, path, item)) == (TODAY.isoformat(), ENDS.isoformat())


@KINDS
def test_it_can_be_cancelled_again_after_it_was_reactivated(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat())
    reactivated(admin_client, path, item, today=TODAY.isoformat())

    again = cancelled(admin_client, path, item, cancelled_on="2026-10-01", ends_on="2026-11-01")

    assert ends(again) == ("2026-10-01", "2026-11-01")


# ---- Changing one that is cancelled --------------------------------------------------------


@KINDS
def test_the_day_a_cancelled_one_ends_can_be_moved_but_not_taken_away(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())
    url = f"/api/{path}/{item['id']}"

    moved = admin_client.patch(url, json={"ends_on": "2026-12-25"}).json()
    refused = admin_client.patch(url, json={"ends_on": None, "name": "Renamed"})
    renamed = admin_client.patch(url, json={"name": "Renamed"}).json()

    assert ends(moved) == (TODAY.isoformat(), "2026-12-25")
    assert (refused.status_code, error(refused)) == (422, "cancelled_needs_end")
    assert refused.json()["detail"]["message"] == (
        f"A cancelled {path.removesuffix('s')} needs the day it ends. "
        "Reactivate it to take the end date away."
    )
    # Nothing in the refused change was made, not even the name.
    assert (renamed["name"], renamed["ends_on"]) == ("Renamed", "2026-12-25")
    unnamed = fetch(admin_client, path, item)
    assert unnamed["name"] == "Renamed"


@KINDS
def test_a_cancelled_one_still_holds_its_payee_and_says_how_to_track_it_again(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    kind = path.removesuffix("s")
    same = payload(account, name="Again", payee="streamflix")
    plain = f"A {kind} already tracks this payee from this account."
    reactivate_advice = (
        f"A cancelled {kind} already tracks this payee from this account. "
        "Reactivate it, or delete it, to track this payee again."
    )

    def refusal(on: str) -> tuple[int, str, str]:
        response = admin_client.post(f"/api/{on}", json=same)
        return response.status_code, error(response), response.json()["detail"]["message"]

    assert refusal(path) == (409, "duplicate_rule", plain)
    cancelled(admin_client, path, item, ends_on=ENDS.isoformat())
    assert refusal(path) == (409, "duplicate_rule", reactivate_advice)
    # As the other kind, it is the same payment, so the same goes.
    assert refusal(OTHER[path]) == (409, "duplicate_rule", reactivate_advice)
    assert reactivate(admin_client, path, item, today=TODAY.isoformat()).status_code == 200
    assert refusal(path) == (409, "duplicate_rule", plain)


@KINDS
def test_a_cancelled_one_can_still_be_deleted_and_its_history_stays(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    payment = add_transaction(session, account, "-14.99", "Streamflix")
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    cancelled(admin_client, path, item, ends_on=ENDS.isoformat())

    assert admin_client.delete(f"/api/{path}/{item['id']}").status_code == 204

    session.expire_all()
    assert session.get_one(Transaction, payment.id).subscription_id is None


# ---- Cancelling is not deleting ------------------------------------------------------------


@KINDS
def test_cancelling_keeps_all_of_it_and_deleting_takes_all_of_it_away(
    admin_client: TestClient, session: Session, path: str
) -> None:
    """Cancelling is for looking back on it later: it, its payments and what refers to it stay,
    and its page shows them. Deleting is for getting rid of it: only the bank's own payments
    stay, and they no longer belong to it."""
    account = add_account(session)
    kept_payment = add_transaction(session, account, "-14.99", "Kept")
    gone_payment = add_transaction(session, account, "-14.99", "Gone")
    budget = admin_client.post(
        "/api/budgets",
        json={"name": "Home", "period": "monthly", "amount": "500.00", "today": TODAY.isoformat()},
    ).json()
    items: dict[str, tuple[dict[str, Any], str]] = {}
    for name in ("Kept", "Gone"):
        item = create(
            admin_client,
            path,
            payload(account, name=name, payee=name, notes="Family plan", amount_varies=True),
        )
        automation = admin_client.post(
            "/api/automations",
            json={
                "name": f"{name} payments",
                "payees": [name.lower()],
                "match": "contains",
                "subscription_id": item["id"],
            },
        ).json()
        counted = admin_client.post(
            f"/api/budgets/{budget['id']}/sources",
            json={"kind": "spending", "subscription_id": item["id"]},
        )
        assert counted.status_code == 201, counted.text
        items[name] = (item, automation["id"])
    kept, kept_automation = items["Kept"]
    gone, gone_automation = items["Gone"]

    cancelled(admin_client, path, kept, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())
    assert admin_client.delete(f"/api/{path}/{gone['id']}").status_code == 204

    # What was cancelled is all still there, for anyone who looks at it later, on its own page.
    page = admin_client.get(
        f"/api/{path}/{kept['id']}/overview", params={"today": TODAY.isoformat()}
    ).json()
    assert page["subscription"]["notes"] == "Family plan"
    assert page["subscription"]["amount_varies"] is True
    assert page["subscription"]["payment_count"] == 1
    assert [point["amount"] for point in page["history"]] == ["14.99"]
    assert page["summary"]["total"] == "14.99"
    assert [automation["id"] for automation in page["automations"]] == [kept_automation]
    assert [counting["id"] for counting in page["budgets"]] == [budget["id"]]
    linked = admin_client.get("/api/transactions", params={"subscription_id": kept["id"]}).json()
    assert [item["id"] for item in linked["items"]] == [str(kept_payment.id)]
    session.expire_all()
    assert session.get_one(Transaction, kept_payment.id).subscription_id == uuid.UUID(kept["id"])
    assert session.get_one(Automation, uuid.UUID(kept_automation)).subscription_id == uuid.UUID(
        kept["id"]
    )

    # What was deleted is gone, and the one thing left is the bank's own payment, set free.
    assert admin_client.get(f"/api/{path}/{gone['id']}").status_code == 404
    assert session.get(Subscription, uuid.UUID(gone["id"])) is None
    assert session.get_one(Transaction, gone_payment.id).subscription_id is None
    assert session.get_one(Automation, uuid.UUID(gone_automation)).subscription_id is None
    counted_by = dict(
        session.execute(
            select(BudgetLink.subscription_id, func.count())
            .where(BudgetLink.budget_id == uuid.UUID(budget["id"]))
            .group_by(BudgetLink.subscription_id)
        ).all()
    )
    assert counted_by == {uuid.UUID(kept["id"]): 1}


# ---- Whose it is to do ---------------------------------------------------------------------


@KINDS
def test_only_the_right_kind_of_it_can_be_cancelled_or_reactivated(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    refused = [
        admin_client.post(f"/api/{OTHER[path]}/{item['id']}/{action}", json={})
        for action in ("cancellation", "reactivation")
    ] + [
        admin_client.post(f"/api/{path}/{uuid.uuid4()}/{action}", json={})
        for action in ("cancellation", "reactivation")
    ]

    assert [(response.status_code, error(response)) for response in refused] == [
        (404, "not_found")
    ] * 4
    assert ends(fetch(admin_client, path, item)) == (None, None)
    for action in ("cancellation", "reactivation"):
        malformed = admin_client.post(f"/api/{path}/not-an-id/{action}", json={})
        assert malformed.status_code == 422


@KINDS
def test_viewers_cannot_cancel_or_reactivate(
    viewer_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = add_item(session, account, RecurringKind(path.removesuffix("s")))
    base = f"/api/{path}/{item.id}"

    refused = [
        viewer_client.post(f"{base}/cancellation", json={}),
        viewer_client.post(f"{base}/reactivation", json={}),
    ]

    assert [(r.status_code, error(r)) for r in refused] == [(403, "admin_only")] * 2
    session.expire_all()
    assert session.get_one(Subscription, item.id).ends_on is None


@KINDS
def test_nobody_signed_out_can_cancel_or_reactivate(
    client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = add_item(session, account, RecurringKind(path.removesuffix("s")))
    base = f"/api/{path}/{item.id}"

    refused = [
        client.post(f"{base}/cancellation", json={}),
        client.post(f"{base}/reactivation", json={}),
    ]

    assert [(r.status_code, error(r)) for r in refused] == [(401, "not_signed_in")] * 2
    session.expire_all()
    assert session.get_one(Subscription, item.id).ends_on is None


# ---- The database --------------------------------------------------------------------------


def test_the_database_will_not_keep_a_cancelled_one_that_has_no_end(session: Session) -> None:
    account = add_account(session)
    session.add(
        Subscription(
            name="Streamflix",
            kind=RecurringKind.SUBSCRIPTION,
            payee="Streamflix",
            amount=Decimal("14.99"),
            frequency=PaymentFrequency.MONTHLY,
            account_id=account.id,
            next_due_date=TODAY,
            cancelled_on=TODAY,
            ends_on=None,
        )
    )

    with pytest.raises(IntegrityError, match="cancelled_has_an_end"):
        session.commit()
    session.rollback()
