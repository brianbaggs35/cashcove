"""Archiving subscriptions and bills: putting one away without deleting it or what it tracked,
and bringing it back out as it was."""

import datetime as dt
import uuid
from typing import Any

import httpx2 as httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.finance import subscriptions
from app.models import Account, RecurringKind, Subscription
from tests.finance import TODAY, add_account, add_transaction
from tests.helpers import error
from tests.test_ending_subscriptions import (
    KINDS,
    OTHER,
    add_item,
    cancelled,
    create,
    fetch,
    payload,
    reactivated,
)

ENDS = TODAY + dt.timedelta(days=30)
ENDED = TODAY - dt.timedelta(days=3)


def archive(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> httpx.Response:
    return client.post(f"/api/{path}/{item['id']}/archiving", json=body)


def archived(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = archive(client, path, item, **body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def unarchive(client: TestClient, path: str, item: dict[str, Any]) -> httpx.Response:
    return client.post(f"/api/{path}/{item['id']}/unarchiving")


def unarchived(client: TestClient, path: str, item: dict[str, Any]) -> dict[str, Any]:
    response = unarchive(client, path, item)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def update(client: TestClient, path: str, item: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = client.patch(f"/api/{path}/{item['id']}", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


# ---- Putting it away -----------------------------------------------------------------------


@KINDS
def test_one_that_isnt_archived_says_so(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))

    assert item["archived_on"] is None
    assert fetch(admin_client, path, item)["archived_on"] is None


@KINDS
def test_archiving_keeps_it_with_everything_it_tracked(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account, payee="Streamflix"))
    add_transaction(session, account, "-14.99", "Streamflix")
    admin_client.post(f"/api/{path}/{item['id']}/payments", json={"ids": []})

    result = archived(admin_client, path, item, today=TODAY.isoformat())

    assert result["archived_on"] == TODAY.isoformat()
    assert result["name"] == "Streamflix"
    assert result["payment_count"] == fetch(admin_client, path, item)["payment_count"]
    assert [row["id"] for row in admin_client.get(f"/api/{path}").json()] == [item["id"]]
    assert fetch(admin_client, path, item)["archived_on"] == TODAY.isoformat()


@KINDS
def test_archiving_one_that_is_still_tracked_pauses_it(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    assert item["active"] is True

    result = archived(admin_client, path, item, today=TODAY.isoformat())

    assert (result["active"], result["archived_on"]) == (False, TODAY.isoformat())


@KINDS
def test_archiving_one_that_was_cancelled_but_hasnt_ended_leaves_it_matching_until_then(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    cancelled(admin_client, path, item, cancelled_on=TODAY.isoformat(), ends_on=ENDS.isoformat())

    result = archived(admin_client, path, item, today=TODAY.isoformat())

    # It has stopped, so it isn't paused: a last payment that comes late is still its own.
    assert (result["active"], result["cancelled_on"], result["ends_on"]) == (
        True,
        TODAY.isoformat(),
        ENDS.isoformat(),
    )


@KINDS
def test_archiving_one_that_has_stopped_or_is_paused_changes_nothing_else(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    over = create(admin_client, path, payload(account, name="Over", payee="Over"))
    cancelled(admin_client, path, over, cancelled_on=ENDED.isoformat(), ends_on=ENDED.isoformat())
    paused = create(admin_client, path, payload(account, name="Paused", payee="Paused"))
    update(admin_client, path, paused, active=False)

    stopped = archived(admin_client, path, over, today=TODAY.isoformat())
    waiting = archived(admin_client, path, paused, today=TODAY.isoformat())

    # One that ended is still counted as active, which is how it matches a late last payment.
    assert (stopped["active"], stopped["ends_on"]) == (True, ENDED.isoformat())
    assert (waiting["active"], waiting["ends_on"]) == (False, None)


@KINDS
def test_the_day_it_is_for_the_person_says_whether_it_has_ended(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    before = create(
        admin_client,
        path,
        payload(account, name="Before", payee="Before", ends_on=ENDS.isoformat()),
    )
    after = create(
        admin_client, path, payload(account, name="After", payee="After", ends_on=ENDS.isoformat())
    )

    early = archived(admin_client, path, before, today=TODAY.isoformat())
    late = archived(admin_client, path, after, today=ENDS.isoformat())

    # One that is to end is paused to put it away, unless by then it has ended.
    assert (early["active"], late["active"]) == (False, True)


@KINDS
def test_without_a_day_it_is_archived_today_where_the_server_is(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))

    result = archived(admin_client, path, item)

    assert result["archived_on"] == dt.datetime.now(dt.UTC).date().isoformat()


@KINDS
def test_one_that_is_archived_cant_be_archived_again(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    archived(admin_client, path, item, today=TODAY.isoformat())

    again = archive(admin_client, path, item, today=ENDS.isoformat())

    assert (again.status_code, error(again)) == (409, "already_archived")
    assert fetch(admin_client, path, item)["archived_on"] == TODAY.isoformat()


# ---- Bringing it back ----------------------------------------------------------------------


@KINDS
def test_unarchiving_brings_it_back_as_it_was(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    paused = create(admin_client, path, payload(account, name="Paused", payee="Paused"))
    update(admin_client, path, paused, active=False)
    over = create(admin_client, path, payload(account, name="Over", payee="Over"))
    cancelled(admin_client, path, over, cancelled_on=ENDED.isoformat(), ends_on=ENDED.isoformat())
    for item in (paused, over):
        archived(admin_client, path, item, today=TODAY.isoformat())

    waiting = unarchived(admin_client, path, paused)
    stopped = unarchived(admin_client, path, over)

    assert (waiting["archived_on"], waiting["active"], waiting["cancelled_on"]) == (
        None,
        False,
        None,
    )
    assert (stopped["archived_on"], stopped["cancelled_on"]) == (None, ENDED.isoformat())


@KINDS
def test_a_tracked_one_comes_back_paused_and_waits_to_be_resumed(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    archived(admin_client, path, item, today=TODAY.isoformat())

    result = unarchived(admin_client, path, item)

    assert (result["archived_on"], result["active"]) == (None, False)


@KINDS
def test_one_that_isnt_archived_cant_be_unarchived(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))

    refused = unarchive(admin_client, path, item)

    assert (refused.status_code, error(refused)) == (409, "not_archived")


@KINDS
def test_resuming_one_takes_it_out_of_the_archive(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    archived(admin_client, path, item, today=TODAY.isoformat())

    result = update(admin_client, path, item, active=True)

    assert (result["archived_on"], result["active"]) == (None, True)


@KINDS
def test_reactivating_one_takes_it_out_of_the_archive(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    cancelled(admin_client, path, item, cancelled_on=ENDED.isoformat(), ends_on=ENDED.isoformat())
    archived(admin_client, path, item, today=TODAY.isoformat())

    result = reactivated(admin_client, path, item, today=TODAY.isoformat())

    assert (result["archived_on"], result["ends_on"], result["active"]) == (None, None, True)


@KINDS
def test_giving_one_that_ended_a_new_end_takes_it_out_of_the_archive(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session), ends_on=ENDED.isoformat()))
    archived(admin_client, path, item, today=TODAY.isoformat())

    result = update(
        admin_client, path, item, ends_on=(dt.date.today() + dt.timedelta(days=90)).isoformat()
    )

    assert result["archived_on"] is None


@KINDS
def test_changes_that_leave_it_put_away_leave_it_archived(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    paused = create(admin_client, path, payload(account, name="Paused", payee="Paused"))
    archived(admin_client, path, paused, today=TODAY.isoformat())
    over = create(
        admin_client, path, payload(account, name="Over", payee="Over", ends_on=ENDED.isoformat())
    )
    archived(admin_client, path, over, today=TODAY.isoformat())

    renamed = update(admin_client, path, paused, name="Renamed")
    still_paused = update(admin_client, path, paused, active=False)
    ends_again = update(admin_client, path, over, ends_on=ENDED.isoformat())

    assert renamed["archived_on"] == still_paused["archived_on"] == TODAY.isoformat()
    assert ends_again["archived_on"] == TODAY.isoformat()


@KINDS
def test_an_archived_one_still_tracks_its_payee(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    archived(admin_client, path, item, today=TODAY.isoformat())

    again = admin_client.post(f"/api/{path}", json=payload(account))

    assert (again.status_code, error(again)) == (409, "duplicate_rule")
    assert again.json()["detail"]["message"] == (
        f"An archived {path.removesuffix('s')} already tracks this payee from this account. "
        "Unarchive it, or delete it, to track this payee again."
    )


def test_an_archived_one_that_was_cancelled_says_both_when_its_payee_is_taken(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    item = create(admin_client, "subscriptions", payload(account))
    cancelled(
        admin_client,
        "subscriptions",
        item,
        cancelled_on=ENDED.isoformat(),
        ends_on=ENDED.isoformat(),
    )
    archived(admin_client, "subscriptions", item, today=TODAY.isoformat())

    again = admin_client.post("/api/subscriptions", json=payload(account))

    assert again.json()["detail"]["message"].startswith("An archived cancelled subscription")


def test_an_archived_one_is_said_to_be_when_it_is_described(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    item = add_item(session, account, RecurringKind.SUBSCRIPTION)
    assert subscriptions.standing(item, TODAY) == "active"
    item.archived_on = TODAY
    item.active = False
    assert subscriptions.standing(item, TODAY) == "archived, paused"
    item.active = True
    item.ends_on = ENDED
    item.cancelled_on = ENDED
    assert subscriptions.standing(item, TODAY) == f"archived, cancelled, ended {ENDED}"


# ---- Whose it is to do ---------------------------------------------------------------------


@KINDS
def test_only_the_right_kind_of_it_can_be_archived_or_unarchived(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))
    refused = [
        admin_client.post(f"/api/{OTHER[path]}/{item['id']}/{action}", json={})
        for action in ("archiving", "unarchiving")
    ] + [
        admin_client.post(f"/api/{path}/{uuid.uuid4()}/{action}", json={})
        for action in ("archiving", "unarchiving")
    ]

    assert [(response.status_code, error(response)) for response in refused] == [
        (404, "not_found")
    ] * 4
    assert fetch(admin_client, path, item)["archived_on"] is None
    for action in ("archiving", "unarchiving"):
        assert admin_client.post(f"/api/{path}/not-an-id/{action}", json={}).status_code == 422


@KINDS
def test_an_archive_that_says_more_than_it_may_is_refused(
    admin_client: TestClient, session: Session, path: str
) -> None:
    item = create(admin_client, path, payload(add_account(session)))

    extra = archive(admin_client, path, item, forever=True)
    bad_day = archive(admin_client, path, item, today="not a day")

    assert [response.status_code for response in (extra, bad_day)] == [422, 422]
    assert fetch(admin_client, path, item)["archived_on"] is None


@KINDS
def test_viewers_cannot_archive_or_unarchive(
    viewer_client: TestClient, session: Session, path: str
) -> None:
    item = add_item(session, add_account(session), RecurringKind(path.removesuffix("s")))
    base = f"/api/{path}/{item.id}"

    refused = [
        viewer_client.post(f"{base}/archiving", json={}),
        viewer_client.post(f"{base}/unarchiving"),
    ]

    assert [(r.status_code, error(r)) for r in refused] == [(403, "admin_only")] * 2
    session.expire_all()
    assert session.get_one(Subscription, item.id).archived_on is None


@KINDS
def test_nobody_signed_out_can_archive_or_unarchive(
    client: TestClient, session: Session, path: str
) -> None:
    item = add_item(session, add_account(session), RecurringKind(path.removesuffix("s")))
    base = f"/api/{path}/{item.id}"

    refused = [client.post(f"{base}/archiving", json={}), client.post(f"{base}/unarchiving")]

    assert [(r.status_code, error(r)) for r in refused] == [(401, "not_signed_in")] * 2
    session.expire_all()
    assert session.get_one(Subscription, item.id).archived_on is None


def test_archived_ones_are_listed_with_the_rest_for_the_page_to_sort(
    admin_client: TestClient, session: Session
) -> None:
    account: Account = add_account(session)
    kept = create(admin_client, "subscriptions", payload(account, name="Kept", payee="Kept"))
    away = create(admin_client, "subscriptions", payload(account, name="Away", payee="Away"))
    archived(admin_client, "subscriptions", away, today=TODAY.isoformat())

    listed = {
        row["name"]: row["archived_on"] for row in admin_client.get("/api/subscriptions").json()
    }

    assert listed == {"Kept": None, "Away": TODAY.isoformat()}
    assert kept["archived_on"] is None


def test_archiving_is_the_only_pause_that_needs_no_say_in_the_list_filter(
    admin_client: TestClient, session: Session
) -> None:
    account = add_account(session)
    item = create(admin_client, "bills", payload(account))
    archived(admin_client, "bills", item, today=TODAY.isoformat())

    paused = admin_client.get("/api/bills", params={"active": "false"}).json()
    tracked = admin_client.get("/api/bills", params={"active": "true"}).json()

    assert [row["id"] for row in paused] == [item["id"]]
    assert tracked == []
