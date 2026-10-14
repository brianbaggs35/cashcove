"""A subscription's or bill's own page: what it has cost, what is coming and what refers to it."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.finance.recurring_overview import HISTORY
from app.finance.subscriptions import UPCOMING_PAYMENTS, upcoming_dates
from app.models import Account, PaymentFrequency, RecurringKind, Subscription, Transaction
from tests.finance import TODAY, add_account, add_transaction, linked_account
from tests.helpers import error

KINDS = pytest.mark.parametrize("path", ["bills", "subscriptions"])
OTHER = {"bills": "subscriptions", "subscriptions": "bills"}


def payload(account: Account, **changes: Any) -> dict[str, Any]:
    return {
        "name": "City Power",
        "payee": "City Power",
        "amount": "96.40",
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


def overview(client: TestClient, path: str, item: dict[str, Any], **params: str) -> dict[str, Any]:
    response = client.get(f"/api/{path}/{item['id']}/overview", params=params)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def pay(
    session: Session,
    account: Account,
    amount: str,
    days_ago: int,
    payee: str = "City Power",
    **fields: Any,
) -> Transaction:
    return add_transaction(
        session, account, amount, payee, date=TODAY - dt.timedelta(days_ago), **fields
    )


def due(frequency: PaymentFrequency, on: dt.date) -> Subscription:
    return Subscription(
        name="Thing",
        kind=RecurringKind.SUBSCRIPTION,
        payee="Thing",
        amount=Decimal("5.00"),
        frequency=frequency,
        account_id=uuid.uuid4(),
        next_due_date=on,
    )


@KINDS
def test_signing_in_is_required_to_see_it_in_full(client: TestClient, path: str) -> None:
    assert error(client.get(f"/api/{path}/{uuid.uuid4()}/overview")) == "not_signed_in"


@KINDS
def test_viewers_can_see_it_in_full(viewer_client: TestClient, session: Session, path: str) -> None:
    account = add_account(session)
    item = Subscription(
        name="City Power",
        kind=RecurringKind.BILL if path == "bills" else RecurringKind.SUBSCRIPTION,
        payee="City Power",
        amount=Decimal("96.40"),
        frequency=PaymentFrequency.MONTHLY,
        account_id=account.id,
        next_due_date=TODAY,
    )
    session.add(item)
    session.commit()
    pay(session, account, "-90.00", 3, subscription_id=item.id)
    session.expire_all()

    full = overview(viewer_client, path, {"id": item.id}, today=TODAY.isoformat())

    # It is the same one the single read gives, as it is now.
    assert full["subscription"] == viewer_client.get(f"/api/{path}/{item.id}").json()
    assert full["subscription"]["payment_count"] == 1
    assert full["summary"]["total"] == "90.00"


@KINDS
def test_what_it_has_cost_is_added_up_from_the_payments_linked_to_it(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    other = add_account(session, "Rewards card")
    # Three payments over two years, one of them dated in the year before.
    pay(session, account, "-10.00", 5)
    pay(session, account, "-15.01", 40)
    pay(session, account, "-12.50", 300)
    # Not its payments: another payee, and money coming in from the same one.
    pay(session, account, "-99.00", 6, "Somebody else")
    add_transaction(session, account, "20.00", "City Power", date=TODAY)
    # And one from another account, which it takes only when linked by hand.
    add_transaction(session, other, "-7.00", "City Power", date=TODAY)
    item = create(admin_client, path, payload(account))

    full = overview(admin_client, path, item, today=TODAY.isoformat())

    assert full["subscription"]["payment_count"] == 3
    assert full["summary"] == {
        "total": "37.51",
        # 12.5033... paid on average, to the cent.
        "average": "12.50",
        "highest": "15.01",
        "lowest": "10.00",
        "first_on": str(TODAY - dt.timedelta(300)),
        # The 300 days back is in 2025, so it isn't this year's.
        "this_year": "25.01",
    }


@KINDS
def test_the_year_it_counts_is_the_one_the_person_is_in(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    for amount, on in [
        ("-10.00", "2025-12-31"),
        ("-20.00", "2026-01-01"),
        ("-40.00", "2026-12-31"),
    ]:
        add_transaction(session, account, amount, "City Power", date=dt.date.fromisoformat(on))
    add_transaction(session, account, "-80.00", "City Power", date=dt.date(2027, 1, 1))
    item = create(admin_client, path, payload(account))

    def this_year(today: str) -> str:
        return str(overview(admin_client, path, item, today=today)["summary"]["this_year"])

    assert this_year("2026-06-15") == "60.00"
    assert this_year("2025-06-15") == "10.00"
    assert this_year("2027-06-15") == "80.00"
    # Without a date, it is the server's own day.
    assert Decimal(str(overview(admin_client, path, item)["summary"]["this_year"])) >= 0


@KINDS
def test_one_with_no_payments_yet_has_nothing_to_add_up_but_still_a_schedule(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    full = overview(admin_client, path, item, today=TODAY.isoformat())

    assert full["summary"] == {
        "total": "0.00",
        "average": None,
        "highest": None,
        "lowest": None,
        "first_on": None,
        "this_year": "0.00",
    }
    assert full["history"] == []
    assert len(full["upcoming"]) == UPCOMING_PAYMENTS
    assert full["automations"] == []
    assert full["budgets"] == []


@KINDS
def test_the_chart_has_its_latest_payments_with_the_oldest_first(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    for days_ago in range(HISTORY + 3):
        pay(session, account, f"-{20 + days_ago}.00", days_ago)
    item = create(admin_client, path, payload(account))

    full = overview(admin_client, path, item, today=TODAY.isoformat())

    history = full["history"]
    assert len(history) == HISTORY
    assert full["subscription"]["payment_count"] == HISTORY + 3
    # The newest is today's, and the three oldest are left out.
    assert history[-1] == {"on": str(TODAY), "amount": "20.00"}
    assert history[0] == {
        "on": str(TODAY - dt.timedelta(HISTORY - 1)),
        "amount": f"{20 + HISTORY - 1}.00",
    }
    assert [point["on"] for point in history] == sorted(point["on"] for point in history)


@KINDS
def test_what_is_coming_is_counted_on_from_the_next_payment(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(
        admin_client, path, payload(account, next_due_date="2026-01-31", amount_varies=False)
    )

    upcoming = overview(admin_client, path, item, today=TODAY.isoformat())["upcoming"]

    # From the 31st each time, not from the 28th a short month before.
    assert [payment["due_on"] for payment in upcoming] == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
    ]
    assert {payment["amount"] for payment in upcoming} == {"96.40"}


@KINDS
def test_a_payment_that_changes_every_time_is_expected_to_be_about_the_average(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    pay(session, account, "-100.00", 40)
    pay(session, account, "-130.00", 10)
    item = create(admin_client, path, payload(account, amount_varies=True))

    full = overview(admin_client, path, item, today=TODAY.isoformat())

    assert full["subscription"]["expected_amount"] == "115.00"
    assert {payment["amount"] for payment in full["upcoming"]} == {"115.00"}


@pytest.mark.parametrize(
    ("frequency", "first", "expected"),
    [
        (
            PaymentFrequency.WEEKLY,
            "2026-09-21",
            ["09-21", "09-28", "10-05", "10-12", "10-19", "10-26"],
        ),
        (
            PaymentFrequency.BIWEEKLY,
            "2026-09-21",
            ["09-21", "10-05", "10-19", "11-02", "11-16", "11-30"],
        ),
        (
            PaymentFrequency.MONTHLY,
            "2026-09-21",
            ["09-21", "10-21", "11-21", "12-21", "2027-01-21", "2027-02-21"],
        ),
        (
            PaymentFrequency.QUARTERLY,
            "2026-09-21",
            ["09-21", "12-21", "2027-03-21", "2027-06-21", "2027-09-21"],
        ),
        (PaymentFrequency.SEMIANNUAL, "2026-09-21", ["09-21", "2027-03-21", "2027-09-21"]),
        (PaymentFrequency.ANNUAL, "2026-09-21", ["09-21", "2027-09-21"]),
        # A leap day keeps to the end of February, and one year on is the same day.
        (PaymentFrequency.ANNUAL, "2028-02-29", ["2028-02-29", "2029-02-28"]),
        # Already overdue, it is still the first of what is coming.
        (PaymentFrequency.ANNUAL, "2020-01-06", ["2020-01-06", "2021-01-06"]),
    ],
)
def test_it_lists_its_next_payments_up_to_a_year_on_and_never_too_many(
    frequency: PaymentFrequency, first: str, expected: list[str]
) -> None:
    days = upcoming_dates(due(frequency, dt.date.fromisoformat(first)))

    assert [str(day) for day in days] == [
        value if len(value) > 5 else f"{first[:4]}-{value}" for value in expected
    ]


@KINDS
def test_the_automations_and_budgets_that_refer_to_it_are_named(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    elsewhere = create(admin_client, OTHER[path], payload(account, name="Other", payee="Other"))
    for name, active, subscription in [
        ("Zeta rule", True, item),
        ("alpha rule", True, item),
        ("Paused rule", False, item),
        ("Not this one", True, elsewhere),
    ]:
        body = {"name": name, "payees": [name], "subscription_id": subscription["id"]}
        made = admin_client.post("/api/automations", json=body).json()
        if not active:
            admin_client.patch(f"/api/automations/{made['id']}", json={"active": False})
    for name, period, subscription in [
        ("Home", "monthly", item),
        ("bills, yearly", "yearly", item),
        ("Someone else's", "weekly", elsewhere),
    ]:
        budget = admin_client.post(
            "/api/budgets",
            json={"name": name, "period": period, "amount": "500", "today": TODAY.isoformat()},
        ).json()
        response = admin_client.post(
            f"/api/budgets/{budget['id']}/sources",
            json={"kind": "spending", "subscription_id": subscription["id"]},
        )
        assert response.status_code == 201, response.text

    full = overview(admin_client, path, item, today=TODAY.isoformat())

    # The ones at work first, then by name whatever the case.
    assert [(rule["name"], rule["active"]) for rule in full["automations"]] == [
        ("alpha rule", True),
        ("Zeta rule", True),
        ("Paused rule", False),
    ]
    assert [(budget["name"], budget["period"]) for budget in full["budgets"]] == [
        ("bills, yearly", "yearly"),
        ("Home", "monthly"),
    ]


@KINDS
def test_a_payment_linked_by_hand_from_another_account_is_counted(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    card = linked_account(session)
    item = create(admin_client, path, payload(account))
    payment = add_transaction(session, card, "-31.25", "Unrelated name", date=TODAY)
    admin_client.post(f"/api/{path}/{item['id']}/payments", json={"ids": [str(payment.id)]})

    full = overview(admin_client, path, item, today=TODAY.isoformat())

    assert full["summary"]["total"] == "31.25"
    assert full["history"] == [{"on": str(TODAY), "amount": "31.25"}]


@KINDS
def test_it_is_only_ever_found_as_what_it_is(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))

    wrong_kind = admin_client.get(f"/api/{OTHER[path]}/{item['id']}/overview")
    unknown = admin_client.get(f"/api/{path}/{uuid.uuid4()}/overview")

    assert [(r.status_code, error(r)) for r in (wrong_kind, unknown)] == [(404, "not_found")] * 2


@KINDS
def test_an_id_or_a_day_that_makes_no_sense_is_turned_away(
    admin_client: TestClient, session: Session, path: str
) -> None:
    account = add_account(session)
    item = create(admin_client, path, payload(account))
    base = f"/api/{path}/{item['id']}/overview"

    assert admin_client.get(f"/api/{path}/1/overview").status_code == 422
    assert admin_client.get(base, params={"today": "tomorrow"}).status_code == 422
    assert admin_client.get(base, params={"today": "1969-12-31"}).status_code == 422
    assert admin_client.get(base, params={"today": "2026-09-20"}).status_code == 200
