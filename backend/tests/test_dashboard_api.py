import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api import dashboard as dashboard_api
from app.models import AccountType, AppSettings, CategoryKind
from app.models.app_settings import SINGLETON_ID
from tests.finance import TODAY, add_account, add_category, add_group, add_transaction
from tests.helpers import error
from tests.rates import FakeRates


def read(client: TestClient, today: dt.date = TODAY) -> dict[str, Any]:
    response = client.get("/api/dashboard", params={"today": today.isoformat()})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def september(day: int) -> dt.date:
    return dt.date(2026, 9, day)


# ---- Who can see it ---------------------------------------------------------------------------


def test_signing_in_is_required(client: TestClient) -> None:
    assert error(client.get("/api/dashboard")) == "not_signed_in"


def test_viewers_can_see_the_dashboard(viewer_client: TestClient, session: Session) -> None:
    add_transaction(session, add_account(session), "-12.00", date=september(3))

    assert read(viewer_client)["month"]["spent"] == "12.00"


def test_the_dashboard_is_read_only(admin_client: TestClient) -> None:
    assert admin_client.post("/api/dashboard", json={}).status_code == 405


@pytest.mark.parametrize("today", ["2026-13-01", "1969-12-31", "2200-01-01", "yesterday"])
def test_a_day_has_to_be_one_the_calendar_has(admin_client: TestClient, today: str) -> None:
    assert admin_client.get("/api/dashboard", params={"today": today}).status_code == 422


# ---- The month ------------------------------------------------------------------------------


def test_a_household_with_nothing_yet_has_zeros_for_every_month(admin_client: TestClient) -> None:
    result = read(admin_client)

    assert result["month"] == {
        "start": "2026-09-01",
        "end": "2026-09-30",
        "income": "0.00",
        "spent": "0.00",
    }
    assert (result["days"], result["days_gone"]) == (30, 20)
    assert result["previous"] == {"income": "0.00", "spent": "0.00"}
    assert [month["start"] for month in result["months"]] == [
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
    ]
    assert result["months"][-1] == result["month"]
    assert (result["daily"], result["categories"], result["payees"]) == ([], [], [])
    assert (result["uncategorized"], result["converted"], result["unavailable"]) == (0, [], [])


def test_money_in_is_income_and_money_out_is_spending(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    card = add_account(session, "Rewards Visa", type=AccountType.CREDIT_CARD, balance="-300.00")
    add_transaction(session, checking, "2500.00", "Acme Payroll", date=september(1))
    add_transaction(session, checking, "-80.25", "Corner Market", date=september(2))
    add_transaction(session, card, "-19.75", "Streamflix", date=september(2))
    add_transaction(session, card, "5.00", "Refund", date=september(15))

    result = read(admin_client)

    assert (result["month"]["income"], result["month"]["spent"]) == ("2505.00", "100.00")
    assert result["daily"] == [
        {"day": "2026-09-01", "income": "2500.00", "spent": "0.00"},
        {"day": "2026-09-02", "income": "0.00", "spent": "100.00"},
        {"day": "2026-09-15", "income": "5.00", "spent": "0.00"},
    ]


def test_money_moving_between_the_households_own_accounts_is_neither(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    card = add_account(session, "Rewards Visa", type=AccountType.CREDIT_CARD, balance="-300.00")
    transfers = add_group(session, "Transfers", CategoryKind.TRANSFER)
    payment = add_category(session, "Credit card payments", transfers)
    add_transaction(session, checking, "-300.00", "Visa payment", category_id=payment.id)
    add_transaction(session, card, "300.00", "Payment thank you", category_id=payment.id)
    add_transaction(session, checking, "-40.00", "Corner Market", date=september(4))

    result = read(admin_client)

    assert (result["month"]["income"], result["month"]["spent"]) == ("0.00", "40.00")
    assert [item["amount"] for item in result["categories"]] == ["40.00"]


def test_only_the_days_of_the_month_count_towards_it(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    add_transaction(session, checking, "-10.00", "Late August", date=dt.date(2026, 8, 31))
    add_transaction(session, checking, "-20.00", "First day", date=september(1))
    add_transaction(session, checking, "-30.00", "Last day", date=september(30))
    add_transaction(session, checking, "-40.00", "Next month", date=dt.date(2026, 10, 1))

    assert read(admin_client)["month"]["spent"] == "50.00"


def test_the_last_day_of_the_month_has_every_day_gone(admin_client: TestClient) -> None:
    result = read(admin_client, dt.date(2026, 9, 30))

    assert (result["days"], result["days_gone"]) == (30, 30)


def test_the_first_day_of_the_month_has_one_day_gone(admin_client: TestClient) -> None:
    result = read(admin_client, dt.date(2026, 9, 1))

    assert (result["days"], result["days_gone"]) == (30, 1)


def test_the_months_year_by_year(admin_client: TestClient, session: Session) -> None:
    checking = add_account(session)
    add_transaction(session, checking, "-70.00", "Old", date=dt.date(2025, 12, 5))
    add_transaction(session, checking, "-5.00", "Too old", date=dt.date(2025, 11, 30))
    add_transaction(session, checking, "900.00", "Pay", date=dt.date(2026, 1, 20))

    result = read(admin_client, dt.date(2026, 2, 10))

    assert [(month["start"], month["end"]) for month in result["months"]] == [
        ("2025-09-01", "2025-09-30"),
        ("2025-10-01", "2025-10-31"),
        ("2025-11-01", "2025-11-30"),
        ("2025-12-01", "2025-12-31"),
        ("2026-01-01", "2026-01-31"),
        ("2026-02-01", "2026-02-28"),
    ]
    assert [(month["income"], month["spent"]) for month in result["months"]] == [
        ("0.00", "0.00"),
        ("0.00", "0.00"),
        ("0.00", "5.00"),
        ("0.00", "70.00"),
        ("900.00", "0.00"),
        ("0.00", "0.00"),
    ]


# ---- Compared with the month before ------------------------------------------------------------


def test_the_month_before_is_counted_over_the_same_number_of_days(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    add_transaction(session, checking, "-10.00", "Early", date=dt.date(2026, 8, 5))
    add_transaction(session, checking, "-20.00", "On the day", date=dt.date(2026, 8, 20))
    add_transaction(session, checking, "-300.00", "Later in August", date=dt.date(2026, 8, 21))
    add_transaction(session, checking, "800.00", "Pay", date=dt.date(2026, 8, 20))
    add_transaction(session, checking, "-60.00", "This month", date=september(3))

    result = read(admin_client)

    assert result["previous"] == {"income": "800.00", "spent": "30.00"}
    # August as a whole is what the history says it came to.
    assert result["months"][-2]["spent"] == "330.00"


def test_a_longer_month_is_compared_with_the_whole_of_a_shorter_one(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    add_transaction(session, checking, "-10.00", "Last day of February", date=dt.date(2026, 2, 28))
    add_transaction(session, checking, "-5.00", "March", date=dt.date(2026, 3, 1))

    result = read(admin_client, dt.date(2026, 3, 30))

    assert result["days_gone"] == 30
    assert result["previous"] == {"income": "0.00", "spent": "10.00"}


# ---- Where the money went -----------------------------------------------------------------------


def test_spending_is_by_category_with_the_biggest_first_and_none_for_no_category(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    food = add_category(session, "Groceries")
    fun = add_category(session, "Entertainment")
    add_transaction(session, checking, "-60.00", "Corner Market", category_id=food.id)
    add_transaction(session, checking, "-15.50", "Corner Market", category_id=food.id)
    add_transaction(session, checking, "-90.00", "Cinema", category_id=fun.id)
    add_transaction(session, checking, "-8.00", "Mystery")
    # Money in isn't spending, and neither is anything from another month.
    add_transaction(session, checking, "50.00", "Refund", category_id=food.id)
    add_transaction(session, checking, "-500.00", "Rent", date=dt.date(2026, 8, 28))

    result = read(admin_client)

    assert result["categories"] == [
        {"category_id": str(fun.id), "amount": "90.00", "count": 1},
        {"category_id": str(food.id), "amount": "75.50", "count": 2},
        {"category_id": None, "amount": "8.00", "count": 1},
    ]
    assert result["month"]["spent"] == "173.50"


def test_categories_with_the_same_amount_keep_a_steady_order(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    first = add_category(session, "First")
    second = add_category(session, "Second")
    add_transaction(session, checking, "-10.00", "One", category_id=first.id)
    add_transaction(session, checking, "-10.00", "Two", category_id=second.id)

    ids = [item["category_id"] for item in read(admin_client)["categories"]]

    assert ids == sorted(ids)


def test_payees_are_the_same_whatever_the_letter_case_and_the_most_spent_comes_first(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    add_transaction(session, checking, "-10.00", "Corner Market", date=september(1))
    add_transaction(session, checking, "-20.00", "CORNER MARKET ", date=september(2))
    add_transaction(session, checking, "-25.00", "Cinema", date=september(2))
    add_transaction(session, checking, "-25.00", "Bakery", date=september(3))

    result = read(admin_client)

    assert result["payees"] == [
        {"payee": "CORNER MARKET ", "amount": "30.00", "count": 2},
        {"payee": "Bakery", "amount": "25.00", "count": 1},
        {"payee": "Cinema", "amount": "25.00", "count": 1},
    ]


def test_only_the_top_payees_are_listed(admin_client: TestClient, session: Session) -> None:
    checking = add_account(session)
    for number in range(8):
        add_transaction(session, checking, f"-{10 + number}.00", f"Shop {number}")

    payees = read(admin_client)["payees"]

    assert [item["payee"] for item in payees] == [f"Shop {number}" for number in range(7, 2, -1)]


def test_the_transactions_with_no_category_are_counted_whenever_they_were(
    admin_client: TestClient, session: Session
) -> None:
    checking = add_account(session)
    food = add_category(session, "Groceries")
    add_transaction(session, checking, "-8.00", "Mystery", date=dt.date(2024, 1, 2))
    add_transaction(session, checking, "9.00", "Gift", date=september(2))
    add_transaction(session, checking, "-60.00", "Corner Market", category_id=food.id)

    assert read(admin_client)["uncategorized"] == 2


# ---- Other currencies ---------------------------------------------------------------------------


def test_accounts_in_other_currencies_count_at_each_days_rate(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    euros = add_account(session, "Euro account", currency="EUR")
    add_transaction(session, euros, "-100.00", "Cafe", date=september(10))
    add_transaction(session, euros, "-50.00", "Bistro", date=september(11))
    add_transaction(session, euros, "40.00", "Pay", date=september(12))
    add_transaction(session, add_account(session), "-10.00", "Cafe", date=september(10))
    rates.rate("EUR", {september(10): "1.10", september(11): "1.20", september(12): "1.00"})

    result = read(admin_client)

    assert (result["month"]["income"], result["month"]["spent"]) == ("40.00", "180.00")
    # The same payee in two currencies is one payee, in the household's.
    assert result["payees"] == [
        {"payee": "Cafe", "amount": "120.00", "count": 2},
        {"payee": "Bistro", "amount": "60.00", "count": 1},
    ]
    assert result["categories"] == [{"category_id": None, "amount": "180.00", "count": 3}]
    assert (result["converted"], result["unavailable"]) == (["EUR"], [])


def test_a_currency_without_rates_is_left_out_and_said_so(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    add_transaction(session, add_account(session, "Euro account", currency="EUR"), "-100.00")
    add_transaction(session, add_account(session, "Pound account", currency="GBP"), "-30.00")
    add_transaction(session, add_account(session), "-5.00")
    rates.rate("EUR", "1.10")

    result = read(admin_client)

    assert result["month"]["spent"] == "115.00"
    assert (result["converted"], result["unavailable"]) == (["EUR"], ["GBP"])


def test_the_households_own_currency_is_what_everything_is_counted_in(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    session.add(AppSettings(id=SINGLETON_ID, data={"general": {"currency": "EUR"}}))
    session.commit()
    add_transaction(session, add_account(session, "Euro account", currency="EUR"), "-100.00")
    add_transaction(session, add_account(session, "Dollar account"), "-110.00")
    rates.rate("USD", "0.80")

    result = read(admin_client)

    assert result["month"]["spent"] == "188.00"
    assert result["converted"] == ["USD"]


# ---- Today ---------------------------------------------------------------------------------------


def test_today_is_the_servers_day_unless_the_person_says_where_they_are(
    admin_client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        dashboard_api, "utcnow", lambda: dt.datetime(2026, 7, 14, 9, 0, tzinfo=dt.UTC)
    )
    add_transaction(session, add_account(session), "-12.00", date=dt.date(2026, 7, 2))

    result = admin_client.get("/api/dashboard").json()

    assert result["month"]["start"] == "2026-07-01"
    assert (result["days"], result["days_gone"], result["month"]["spent"]) == (31, 14, "12.00")
