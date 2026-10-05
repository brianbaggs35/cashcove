import datetime as dt
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AppSettings,
    Automation,
    AutomationScope,
    Budget,
    BudgetAmount,
    BudgetExclusion,
    BudgetLink,
    BudgetPeriod,
    Category,
    CategoryKind,
    PaymentFrequency,
    RecurringKind,
    Subscription,
    Transaction,
)
from app.models.app_settings import SINGLETON_ID
from tests.finance import (
    TODAY,
    add_account,
    add_category,
    add_group,
    add_transaction,
    linked_account,
)
from tests.helpers import error
from tests.rates import FakeRates

SEPTEMBER = "2026-09-01"
IN_SEPTEMBER = dt.date(2026, 9, 1)


def set_general(session: Session, **general: Any) -> None:
    session.add(AppSettings(id=SINGLETON_ID, data={"general": general}))
    session.commit()


def day(days: int) -> dt.date:
    """A day in September 2026, counted from its 1st."""
    return IN_SEPTEMBER + dt.timedelta(days=days - 1)


def make_budget(client: TestClient, **changes: Any) -> dict[str, Any]:
    body = {
        "name": "Monthly",
        "period": "monthly",
        "amount": "2000.00",
        "today": TODAY.isoformat(),
        **changes,
    }
    response = client.post("/api/budgets", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def view(
    client: TestClient, budget: dict[str, Any], on: str | None = None, **params: Any
) -> dict[str, Any]:
    query = {"today": TODAY.isoformat(), **({"on": on} if on else {}), **params}
    response = client.get(f"/api/budgets/{budget['id']}/period", params=query)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def link(
    client: TestClient, budget: dict[str, Any], kind: str, *transactions: Transaction
) -> dict[str, Any]:
    response = client.post(
        f"/api/budgets/{budget['id']}/transactions",
        json={"ids": [str(item.id) for item in transactions], "kind": kind},
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def unlink(client: TestClient, budget: dict[str, Any], transaction: Transaction) -> None:
    response = client.delete(f"/api/budgets/{budget['id']}/transactions/{transaction.id}")
    assert response.status_code == 204, response.text


def count(
    client: TestClient, budget: dict[str, Any], kind: str, **target: uuid.UUID
) -> dict[str, Any]:
    response = client.post(
        f"/api/budgets/{budget['id']}/sources",
        json={"kind": kind, **{f"{name}_id": str(value) for name, value in target.items()}},
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def counted(
    client: TestClient, budget: dict[str, Any], on: str | None = None, **params: Any
) -> list[dict[str, Any]]:
    """What the budget counts in the period, newest first, as (payee, kind, via)."""
    query = {"today": TODAY.isoformat(), "page_size": 100, **({"on": on} if on else {}), **params}
    response = client.get(f"/api/budgets/{budget['id']}/transactions", params=query)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


def summary(items: list[dict[str, Any]]) -> list[tuple[str, str, str]]:
    return [(item["payee"], item["kind"], item["via"]) for item in items]


def amounts(body: dict[str, Any]) -> tuple[str, str, str, str]:
    """What a period came to: the amount, income, spending and what's left."""
    return body["amount"], body["income"], body["spent"], body["left"]


@dataclass
class Household:
    """A household's September 2026, with some of everything to count."""

    checking: Account
    card: Account
    paycheck: Category
    groceries: Category
    rent: Category
    subscriptions: Category
    transfers: Category
    salary: Transaction
    rent_payment: Transaction
    shop: Transaction
    card_payment: Transaction
    hardware: Transaction
    snacks: Transaction
    streaming: Transaction
    refund: Transaction
    netflix: Subscription


def household(session: Session) -> Household:
    checking = add_account(session)
    card = linked_account(session)
    income = add_group(session, "Income", CategoryKind.INCOME)
    paycheck = add_category(session, "Paycheck", income, "💼")
    food = add_group(session, "Food & drink")
    groceries = add_category(session, "Groceries", food)
    rent = add_category(session, "Rent & mortgage", add_group(session, "Housing"))
    subscriptions = add_category(session, "Subscriptions", add_group(session, "Bills"))
    transfers = add_category(
        session, "Credit card payments", add_group(session, "Transfers", CategoryKind.TRANSFER)
    )
    netflix = Subscription(
        name="Netflix",
        payee="Netflix",
        amount=Decimal("15.49"),
        frequency=PaymentFrequency.MONTHLY,
        account_id=card.id,
        next_due_date=dt.date(2026, 10, 5),
    )
    session.add(netflix)
    session.commit()
    streaming = add_transaction(
        session,
        card,
        "-15.49",
        "Netflix",
        date=day(5),
        category_id=subscriptions.id,
        subscription_id=netflix.id,
    )
    return Household(
        checking=checking,
        card=card,
        paycheck=paycheck,
        groceries=groceries,
        rent=rent,
        subscriptions=subscriptions,
        transfers=transfers,
        salary=add_transaction(
            session, checking, "2400.00", "Acme Corp", date=day(15), category_id=paycheck.id
        ),
        rent_payment=add_transaction(
            session, checking, "-1850.00", "Parkside", date=day(1), category_id=rent.id
        ),
        shop=add_transaction(
            session, checking, "-84.12", "Whole Foods", date=day(3), category_id=groceries.id
        ),
        card_payment=add_transaction(
            session,
            checking,
            "-300.00",
            "Tartan Bank",
            date=day(7),
            category_id=transfers.id,
        ),
        hardware=add_transaction(session, checking, "-12.00", "Hardware Hank", date=day(20)),
        snacks=add_transaction(
            session, card, "-40.00", "Trader Joes", date=day(10), category_id=groceries.id
        ),
        streaming=streaming,
        refund=add_transaction(
            session, card, "18.20", "Target", date=day(12), category_id=groceries.id
        ),
        netflix=netflix,
    )


# ---- Who can do what -----------------------------------------------------------------------


def test_signing_in_is_required(client: TestClient) -> None:
    assert error(client.get("/api/budgets")) == "not_signed_in"


def test_viewers_can_see_budgets_but_not_change_them(
    viewer_client: TestClient, session: Session
) -> None:
    budget = Budget(name="Monthly", period=BudgetPeriod.MONTHLY, starts_on=IN_SEPTEMBER)
    budget.amounts.append(BudgetAmount(starts_on=IN_SEPTEMBER, amount=Decimal("2000.00")))
    session.add(budget)
    session.commit()
    path = f"/api/budgets/{budget.id}"
    ids = {"ids": [str(uuid.uuid4())], "kind": "income"}
    source = {"kind": "spending", "account_id": str(uuid.uuid4())}
    params = {"today": TODAY.isoformat()}

    reads = [
        viewer_client.get("/api/budgets", params=params),
        viewer_client.get(f"{path}/period", params=params),
        viewer_client.get(f"{path}/history", params=params),
        viewer_client.get(f"{path}/transactions", params=params),
    ]
    assert [response.status_code for response in reads] == [200] * 4
    attempts = [
        viewer_client.post("/api/budgets", json={"name": "New", "period": "weekly", "amount": "5"}),
        viewer_client.patch(path, json={"name": "Changed"}),
        viewer_client.delete(path),
        viewer_client.post(f"{path}/transactions", json=ids),
        viewer_client.delete(f"{path}/transactions/{uuid.uuid4()}"),
        viewer_client.post(f"{path}/sources", json=source),
        viewer_client.delete(f"{path}/sources/{uuid.uuid4()}"),
    ]
    assert [error(response) for response in attempts] == ["admin_only"] * 7


def test_a_budget_that_is_gone_is_not_found(admin_client: TestClient) -> None:
    gone = f"/api/budgets/{uuid.uuid4()}"
    other = uuid.uuid4()
    attempts = [
        admin_client.get(f"{gone}/period"),
        admin_client.get(f"{gone}/history"),
        admin_client.get(f"{gone}/transactions"),
        admin_client.patch(gone, json={"name": "Changed"}),
        admin_client.delete(gone),
        admin_client.post(f"{gone}/transactions", json={"ids": [str(other)], "kind": "income"}),
        admin_client.delete(f"{gone}/transactions/{other}"),
        admin_client.post(f"{gone}/sources", json={"kind": "income", "account_id": str(other)}),
        admin_client.delete(f"{gone}/sources/{other}"),
    ]
    assert [error(response) for response in attempts] == ["not_found"] * 9


# ---- Making them ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("period", "starts_on", "ends_on"),
    [
        # Today, September 20th 2026, is a Sunday, which starts the household's weeks.
        ("weekly", "2026-09-20", "2026-09-26"),
        ("biweekly", "2026-09-20", "2026-10-03"),
        ("monthly", "2026-09-01", "2026-09-30"),
        ("yearly", "2026-01-01", "2026-12-31"),
    ],
)
def test_a_budget_is_in_the_period_it_usually_starts_with(
    admin_client: TestClient, period: str, starts_on: str, ends_on: str
) -> None:
    budget = make_budget(admin_client, name="  Spending  ", period=period, amount="150.5")

    assert budget["name"] == "Spending"
    assert (budget["period"], budget["starts_on"], budget["amount"]) == (
        period,
        starts_on,
        "150.50",
    )
    assert budget["current"] == {
        "start": starts_on,
        "end": ends_on,
        "amount": "150.50",
        "income": "0.00",
        "spent": "0.00",
    }


def test_weeks_start_on_the_first_day_of_the_week_the_household_chose(
    admin_client: TestClient, session: Session
) -> None:
    set_general(session, week_starts_on="monday")

    assert make_budget(admin_client, period="weekly")["starts_on"] == "2026-09-14"


@pytest.mark.parametrize(("first_month", "starts_on"), [(4, "2026-04-01"), (10, "2025-10-01")])
def test_years_start_in_the_month_the_budget_year_does(
    admin_client: TestClient, session: Session, first_month: int, starts_on: str
) -> None:
    set_general(session, fiscal_year_start_month=first_month)

    assert make_budget(admin_client, period="yearly")["starts_on"] == starts_on


def test_a_budget_can_start_on_any_day_of_the_month(admin_client: TestClient) -> None:
    budget = make_budget(admin_client, starts_on="2026-09-15")

    assert budget["starts_on"] == "2026-09-15"
    assert (budget["current"]["start"], budget["current"]["end"]) == ("2026-09-15", "2026-10-14")


def test_budgets_are_listed_by_how_often_they_repeat_and_then_in_the_order_made(
    admin_client: TestClient,
) -> None:
    yearly = make_budget(admin_client, name="Year", period="yearly")
    first = make_budget(admin_client, name="First month")
    weekly = make_budget(admin_client, name="Week", period="weekly")
    second = make_budget(admin_client, name="Second month")
    biweekly = make_budget(admin_client, name="Pay period", period="biweekly")

    listed = admin_client.get("/api/budgets", params={"today": TODAY.isoformat()}).json()

    assert [item["id"] for item in listed] == [
        weekly["id"],
        biweekly["id"],
        first["id"],
        second["id"],
        yearly["id"],
    ]


def test_budgets_say_how_the_period_they_are_in_is_going(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client, name="Everyday", amount="500")
    count(admin_client, budget, "income", category=things.paycheck.id)
    count(admin_client, budget, "spending", category=things.groceries.id)

    [listed] = admin_client.get("/api/budgets", params={"today": TODAY.isoformat()}).json()

    assert listed["current"] == {
        "start": "2026-09-01",
        "end": "2026-09-30",
        "amount": "500.00",
        "income": "2400.00",
        "spent": "105.92",
    }


def test_the_period_a_budget_is_in_follows_the_servers_date_unless_told_otherwise(
    admin_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    for module in ("app.api.budget", "app.finance.budget"):
        monkeypatch.setattr(f"{module}.utcnow", lambda: dt.datetime(2026, 11, 14, tzinfo=dt.UTC))
    response = admin_client.post(
        "/api/budgets", json={"name": "Monthly", "period": "monthly", "amount": "10"}
    )

    assert response.status_code == 201
    assert response.json()["starts_on"] == "2026-11-01"
    [listed] = admin_client.get("/api/budgets").json()
    assert listed["current"]["start"] == "2026-11-01"


@pytest.mark.parametrize(
    "changes",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"amount": "0"},
        {"amount": "-5.00"},
        {"amount": "10.005"},
        {"amount": "1000000000000"},
        {"period": "daily"},
        {"starts_on": "1969-12-31"},
        {"starts_on": "2200-01-01"},
        {"today": "tomorrow"},
        {"colour": "red"},
    ],
)
def test_a_budget_needs_a_name_a_period_and_an_amount_above_zero(
    admin_client: TestClient, changes: dict[str, Any]
) -> None:
    body = {"name": "Monthly", "period": "monthly", "amount": "100", **changes}

    assert admin_client.post("/api/budgets", json=body).status_code == 422


# ---- Changing them ----------------------------------------------------------------------


def stored_amounts(session: Session, budget: dict[str, Any]) -> dict[str, str]:
    session.expire_all()
    rows = session.scalars(
        select(BudgetAmount)
        .where(BudgetAmount.budget_id == uuid.UUID(budget["id"]))
        .order_by(BudgetAmount.starts_on)
    )
    return {str(row.starts_on): str(row.amount) for row in rows}


def test_a_budget_is_renamed(admin_client: TestClient) -> None:
    budget = make_budget(admin_client)

    response = admin_client.patch(f"/api/budgets/{budget['id']}", json={"name": " Home "})

    assert response.status_code == 200
    assert response.json()["name"] == "Home"
    assert response.json()["amount"] == "2000.00"


def test_a_new_amount_applies_from_the_period_it_is_set_in(
    admin_client: TestClient, session: Session
) -> None:
    budget = make_budget(admin_client)
    october = {"today": "2026-10-05"}

    response = admin_client.patch(
        f"/api/budgets/{budget['id']}", json={"amount": "2500", **october}
    )

    assert response.json()["amount"] == "2500.00"
    assert stored_amounts(session, budget) == {"2026-09-01": "2000.00", "2026-10-01": "2500.00"}
    # Periods that are over keep what they had, the one before the first amount included.
    assert view(admin_client, budget, "2026-08-10")["amount"] == "2000.00"
    assert view(admin_client, budget, "2026-09-10")["amount"] == "2000.00"
    assert view(admin_client, budget, "2026-10-10")["amount"] == "2500.00"
    # Changing it again in the same period replaces it.
    admin_client.patch(f"/api/budgets/{budget['id']}", json={"amount": "2600", **october})
    assert stored_amounts(session, budget) == {"2026-09-01": "2000.00", "2026-10-01": "2600.00"}


def test_the_day_periods_start_on_can_change(admin_client: TestClient) -> None:
    budget = make_budget(admin_client)

    response = admin_client.patch(
        f"/api/budgets/{budget['id']}", json={"starts_on": "2026-09-15", "today": "2026-09-20"}
    )

    assert response.json()["starts_on"] == "2026-09-15"
    assert response.json()["current"]["start"] == "2026-09-15"


def test_changing_how_often_a_budget_repeats_starts_its_amounts_over(
    admin_client: TestClient, session: Session
) -> None:
    budget = make_budget(admin_client)
    admin_client.patch(
        f"/api/budgets/{budget['id']}", json={"amount": "2500", "today": "2026-10-05"}
    )

    response = admin_client.patch(
        f"/api/budgets/{budget['id']}", json={"period": "weekly", "today": "2026-10-07"}
    )

    # Without an amount it keeps what the budget has now, from the day the new weeks start.
    assert response.json()["period"] == "weekly"
    assert response.json()["starts_on"] == "2026-10-04"
    assert response.json()["amount"] == "2500.00"
    assert stored_amounts(session, budget) == {"2026-10-04": "2500.00"}

    response = admin_client.patch(
        f"/api/budgets/{budget['id']}",
        json={"period": "yearly", "amount": "30000", "starts_on": "2026-04-01"},
    )

    assert (response.json()["starts_on"], response.json()["amount"]) == ("2026-04-01", "30000.00")
    assert stored_amounts(session, budget) == {"2026-04-01": "30000.00"}


def test_sending_the_period_a_budget_has_changes_nothing_about_it(
    admin_client: TestClient, session: Session
) -> None:
    budget = make_budget(admin_client)

    response = admin_client.patch(
        f"/api/budgets/{budget['id']}", json={"period": "monthly", "name": "Same"}
    )

    assert response.json()["name"] == "Same"
    assert stored_amounts(session, budget) == {"2026-09-01": "2000.00"}


def test_deleting_a_budget_deletes_what_counted_toward_it_but_nothing_else(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    other = make_budget(admin_client, name="Other")
    link(admin_client, budget, "spending", things.rent_payment)
    count(admin_client, budget, "spending", category=things.groceries.id)
    unlink(admin_client, budget, things.shop)
    link(admin_client, other, "spending", things.rent_payment)

    assert admin_client.delete(f"/api/budgets/{budget['id']}").status_code == 204

    session.expire_all()
    assert session.scalar(select(func.count()).select_from(BudgetLink)) == 1
    assert session.scalar(select(func.count()).select_from(BudgetExclusion)) == 0
    assert session.scalar(select(func.count()).select_from(Budget)) == 1
    assert session.get(Transaction, things.rent_payment.id) is not None
    assert [item["id"] for item in admin_client.get("/api/budgets").json()] == [other["id"]]


# ---- A period of a budget -----------------------------------------------------------------


def count_everything(client: TestClient, budget: dict[str, Any], things: Household) -> None:
    """Income by a category; spending by a category, a subscription, two accounts and one
    transaction on its own, which between them overlap a good deal."""
    count(client, budget, "income", category=things.paycheck.id)
    count(client, budget, "spending", category=things.groceries.id)
    count(client, budget, "spending", subscription=things.netflix.id)
    count(client, budget, "spending", account=things.card.id)
    link(client, budget, "spending", things.rent_payment)
    count(client, budget, "spending", account=things.checking.id)


def test_a_period_says_what_came_in_what_went_out_and_what_is_left(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count_everything(admin_client, budget, things)

    period = view(admin_client, budget)

    assert (period["start"], period["end"], period["current"]) == (
        "2026-09-01",
        "2026-09-30",
        True,
    )
    # Spending is the groceries (less the refund), Netflix, the rent and one more purchase.
    assert amounts(period) == ("2000.00", "2400.00", "1983.41", "16.59")
    assert period["saved"] == "416.59"
    assert (period["days"], period["days_gone"]) == (30, 20)
    # Twenty of the thirty days have gone, so this much is what an even pace would have spent.
    assert (period["expected"], period["projected"]) == ("1333.33", "2975.12")
    assert (period["transactions"], period["removed"]) == (7, 0)
    assert (period["previous"], period["next"]) == (None, None)
    assert (period["converted"], period["unavailable"]) == ([], [])
    assert period["budget"]["id"] == budget["id"]
    assert [(item["day"], item["income"], item["spent"]) for item in period["daily"]] == [
        ("2026-09-01", "0.00", "1850.00"),
        ("2026-09-03", "0.00", "84.12"),
        ("2026-09-05", "0.00", "15.49"),
        ("2026-09-10", "0.00", "40.00"),
        ("2026-09-12", "0.00", "-18.20"),
        ("2026-09-15", "2400.00", "0.00"),
        ("2026-09-20", "0.00", "12.00"),
    ]
    assert [
        (item["category_id"], item["amount"], item["count"]) for item in period["categories"]
    ] == [
        (str(things.rent.id), "1850.00", 1),
        (str(things.groceries.id), "105.92", 3),
        (str(things.subscriptions.id), "15.49", 1),
        (None, "12.00", 1),
    ]
    assert [
        (item["type"], item["name"], item["kind"], item["amount"], item["count"], item["active"])
        for item in period["sources"]
    ] == [
        ("category", "Paycheck", "income", "2400.00", 1, True),
        ("category", "Groceries", "spending", "105.92", 3, True),
        ("subscription", "Netflix", "spending", "15.49", 1, True),
        # Everything the card and the checking account had was counted by something else first,
        # except the one purchase with no category, and moving money between accounts.
        ("account", "Rewards Visa", "spending", "0.00", 0, True),
        ("account", "Everyday checking", "spending", "12.00", 1, True),
    ]


def test_a_period_that_is_over_or_has_not_begun_has_no_pace(
    admin_client: TestClient, session: Session
) -> None:
    household(session)
    budget = make_budget(admin_client)

    over = view(admin_client, budget, "2026-08-10")
    ahead = view(admin_client, budget, "2026-11-15")

    assert (over["start"], over["end"], over["current"]) == ("2026-08-01", "2026-08-31", False)
    assert (over["days"], over["days_gone"], over["expected"], over["projected"]) == (
        31,
        31,
        None,
        None,
    )
    assert (over["previous"], over["next"]) == (None, "2026-09-01")
    assert (ahead["start"], ahead["end"], ahead["current"]) == ("2026-11-01", "2026-11-30", False)
    assert (ahead["days"], ahead["days_gone"], ahead["expected"]) == (30, 0, None)
    assert (ahead["previous"], ahead["next"]) == ("2026-10-01", None)
    # The first day of a period that has just begun has nothing to go on yet.
    assert view(admin_client, budget, on="2026-09-01", today="2026-09-01")["projected"] == "0.00"


def test_the_first_period_to_look_at_is_the_one_with_the_first_transaction(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    add_transaction(session, things.checking, "-5.00", "Old", date=dt.date(2026, 6, 10))
    budget = make_budget(admin_client)

    assert view(admin_client, budget, "2026-07-20")["previous"] == "2026-06-01"
    assert view(admin_client, budget, "2026-06-20")["previous"] is None
    assert view(admin_client, budget, "2026-06-20")["next"] == "2026-07-01"


def test_a_budget_with_no_transactions_goes_back_to_the_period_it_was_made_for(
    admin_client: TestClient,
) -> None:
    budget = make_budget(admin_client)

    assert view(admin_client, budget)["previous"] is None
    assert view(admin_client, budget, "2026-10-20")["previous"] == "2026-09-01"


# ---- What counts --------------------------------------------------------------------------


def test_a_transaction_counts_once_through_the_first_thing_that_links_it(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    automation = Automation(
        name="Netflix",
        payees=["Netflix"],
        category_id=things.subscriptions.id,
        apply_to=AutomationScope.ALL,
        active=True,
    )
    session.add(automation)
    session.commit()
    layers: dict[str, dict[str, uuid.UUID]] = {
        "transaction": {},
        "automation": {"automation": automation.id},
        "subscription": {"subscription": things.netflix.id},
        "category": {"category": things.subscriptions.id},
        "account": {"account": things.card.id},
    }

    for index, via in enumerate(layers):
        budget = make_budget(admin_client, name=via)
        for later in list(layers)[index:]:
            if later == "transaction":
                link(admin_client, budget, "spending", things.streaming)
            else:
                count(admin_client, budget, "spending", **layers[later])
        [item] = [item for item in counted(admin_client, budget) if item["payee"] == "Netflix"]
        sources = {source["type"]: source["id"] for source in view(admin_client, budget)["sources"]}

        assert item["via"] == via
        assert item["source_id"] == sources.get(via)
        assert view(admin_client, budget)["spent"] != "0.00"


def test_an_accounts_money_in_and_out_count_as_income_and_spending_apart(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "income", account=things.checking.id)
    count(admin_client, budget, "spending", account=things.checking.id)

    period = view(admin_client, budget)

    # The rent, the groceries and the hardware went out, and the paycheck came in. Paying the
    # card was money moving between the household's own accounts, so it isn't spending.
    assert amounts(period) == ("2000.00", "2400.00", "1946.12", "53.88")
    assert "Tartan Bank" not in [item["payee"] for item in counted(admin_client, budget)]
    assert summary(counted(admin_client, budget, kind="income")) == [
        ("Acme Corp", "income", "account")
    ]


def test_an_account_that_counts_as_one_thing_leaves_the_other_direction_out(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", account=things.checking.id)

    assert amounts(view(admin_client, budget)) == ("2000.00", "0.00", "1946.12", "53.88")


def test_a_transaction_linked_by_itself_counts_as_what_it_was_linked_as(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    link(admin_client, budget, "income", things.shop)
    link(admin_client, budget, "spending", things.salary)

    period = view(admin_client, budget)

    # Linked the other way round, money out takes from the income and money in from the spending.
    assert (period["income"], period["spent"]) == ("-84.12", "-2400.00")
    assert summary(counted(admin_client, budget)) == [
        ("Acme Corp", "spending", "transaction"),
        ("Whole Foods", "income", "transaction"),
    ]


def test_an_automation_counts_what_it_sorts_now_and_what_arrives_later(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    automation = Automation(
        name="Paycheck",
        payees=["Acme Corp"],
        category_id=things.paycheck.id,
        apply_to=AutomationScope.ALL,
        active=True,
    )
    session.add(automation)
    session.commit()
    budget = make_budget(admin_client)
    count(admin_client, budget, "income", automation=automation.id)
    assert amounts(view(admin_client, budget))[1] == "2400.00"

    admin_client.post(
        "/api/transactions",
        json={
            "account_id": str(things.checking.id),
            "date": TODAY.isoformat(),
            "amount": "2450.00",
            "payee": "ACME CORP",
        },
    )

    period = view(admin_client, budget)
    assert period["income"] == "4850.00"
    assert period["sources"][0]["name"] == "Paycheck"
    assert (period["sources"][0]["amount"], period["sources"][0]["count"]) == ("4850.00", 2)


def test_an_automation_that_looks_at_text_and_amounts_counts_only_those(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    add_transaction(session, things.card, "-9.99", "STREAMFLIX*PLUS", date=day(6))
    add_transaction(session, things.card, "-2.99", "STREAMFLIX*BASIC", date=day(6))
    automation = Automation(
        name="Streaming",
        payees=["streamflix"],
        match="contains",
        min_amount=Decimal("5.00"),
        max_amount=Decimal("15.00"),
        category_id=things.subscriptions.id,
        apply_to=AutomationScope.ALL,
        active=True,
    )
    session.add(automation)
    session.commit()
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", automation=automation.id)

    assert summary(counted(admin_client, budget)) == [("STREAMFLIX*PLUS", "spending", "automation")]


def test_an_automation_for_the_future_counts_only_what_arrived_after_it(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    made = dt.datetime(2026, 9, 10, 12, tzinfo=dt.UTC)
    automation = Automation(
        name="Coffee",
        payees=["Blue Bottle"],
        category_id=things.groceries.id,
        apply_to=AutomationScope.FUTURE,
        active=True,
        created_at=made,
    )
    session.add(automation)
    add_transaction(
        session,
        things.card,
        "-4.50",
        "Blue Bottle",
        date=day(8),
        created_at=made - dt.timedelta(days=2),
    )
    add_transaction(
        session,
        things.card,
        "-5.25",
        "Blue Bottle",
        date=day(14),
        created_at=made + dt.timedelta(days=2),
    )
    session.commit()
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", automation=automation.id)

    [item] = counted(admin_client, budget)

    assert (item["payee"], item["amount"]) == ("Blue Bottle", "-5.25")


def test_a_paused_automation_or_subscription_counts_nothing_until_it_is_resumed(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    automation = Automation(
        name="Paycheck",
        payees=["Acme Corp"],
        category_id=things.paycheck.id,
        apply_to=AutomationScope.ALL,
        active=False,
    )
    session.add(automation)
    things.netflix.active = False
    session.commit()
    budget = make_budget(admin_client)
    count(admin_client, budget, "income", automation=automation.id)
    count(admin_client, budget, "spending", subscription=things.netflix.id)

    period = view(admin_client, budget)

    assert amounts(period) == ("2000.00", "0.00", "15.49", "1984.51")
    assert [(item["name"], item["active"]) for item in period["sources"]] == [
        ("Paycheck", False),
        ("Netflix", False),
    ]


# ---- Taking transactions off, and putting them back ----------------------------------------


def stored(session: Session, model: type[BudgetLink | BudgetExclusion]) -> int:
    session.expire_all()
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_taking_off_a_transaction_only_its_own_link_counts_forgets_it(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    link(admin_client, budget, "spending", things.rent_payment)

    unlink(admin_client, budget, things.rent_payment)

    assert (stored(session, BudgetLink), stored(session, BudgetExclusion)) == (0, 0)
    assert amounts(view(admin_client, budget)) == ("2000.00", "0.00", "0.00", "2000.00")
    assert counted(admin_client, budget, removed=True) == []


def test_taking_off_a_transaction_something_else_counts_remembers_it(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    category = count(admin_client, budget, "spending", category=things.groceries.id)

    unlink(admin_client, budget, things.shop)
    unlink(admin_client, budget, things.shop)

    period = view(admin_client, budget)
    # The others in the category still count: the 40.00 and the 18.20 refund.
    assert (period["spent"], period["transactions"], period["removed"]) == ("21.80", 2, 1)
    assert summary(counted(admin_client, budget)) == [
        ("Target", "spending", "category"),
        ("Trader Joes", "spending", "category"),
    ]
    [removed] = counted(admin_client, budget, removed=True)
    assert (removed["payee"], removed["via"], removed["source_id"]) == (
        "Whole Foods",
        "category",
        category["id"],
    )
    assert (stored(session, BudgetLink), stored(session, BudgetExclusion)) == (1, 1)


def test_a_transaction_with_its_own_link_and_a_source_comes_off_of_both(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", category=things.groceries.id)
    link(admin_client, budget, "income", things.shop)

    unlink(admin_client, budget, things.shop)

    assert stored(session, BudgetExclusion) == 1
    assert "Whole Foods" not in [item["payee"] for item in counted(admin_client, budget)]
    assert [item["kind"] for item in counted(admin_client, budget, removed=True)] == ["spending"]


def test_putting_a_transaction_back_that_something_counts_needs_no_link(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", category=things.groceries.id)
    unlink(admin_client, budget, things.shop)

    assert link(admin_client, budget, "spending", things.shop) == {"count": 1}

    assert (stored(session, BudgetLink), stored(session, BudgetExclusion)) == (1, 0)
    assert view(admin_client, budget)["spent"] == "105.92"
    assert view(admin_client, budget)["removed"] == 0


def test_putting_a_transaction_back_as_something_else_links_it(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", category=things.groceries.id)
    unlink(admin_client, budget, things.shop)

    link(admin_client, budget, "income", things.shop)

    assert (stored(session, BudgetLink), stored(session, BudgetExclusion)) == (2, 0)
    assert ("Whole Foods", "income", "transaction") in summary(counted(admin_client, budget))


def test_taking_off_a_transaction_nothing_counts_changes_nothing(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)

    unlink(admin_client, budget, things.hardware)

    assert (stored(session, BudgetLink), stored(session, BudgetExclusion)) == (0, 0)


def test_a_transaction_that_is_gone_cannot_be_taken_off_or_linked(
    admin_client: TestClient,
) -> None:
    budget = make_budget(admin_client)
    gone = uuid.uuid4()

    assert error(admin_client.delete(f"/api/budgets/{budget['id']}/transactions/{gone}")) == (
        "unknown_transaction"
    )
    response = admin_client.post(
        f"/api/budgets/{budget['id']}/transactions", json={"ids": [str(gone)], "kind": "income"}
    )
    assert (response.status_code, error(response)) == (404, "unknown_transaction")


def test_linking_is_repeatable_and_can_change_what_a_transaction_counts_as(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)

    assert link(admin_client, budget, "spending", things.shop, things.hardware) == {"count": 2}
    link(admin_client, budget, "spending", things.shop)
    assert stored(session, BudgetLink) == 2

    link(admin_client, budget, "income", things.shop)

    assert stored(session, BudgetLink) == 2
    assert summary(counted(admin_client, budget)) == [
        ("Hardware Hank", "spending", "transaction"),
        ("Whole Foods", "income", "transaction"),
    ]


def test_a_transaction_that_already_counts_that_way_needs_no_link_of_its_own(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", category=things.groceries.id)

    link(admin_client, budget, "spending", things.shop)
    assert stored(session, BudgetLink) == 1

    # Counting it the other way does need one, which then has the last word.
    link(admin_client, budget, "income", things.shop)
    assert stored(session, BudgetLink) == 2


@pytest.mark.parametrize(
    "body",
    [
        {"ids": [], "kind": "income"},
        {"ids": [str(uuid.uuid4())] * 501, "kind": "income"},
        {"ids": ["abc"], "kind": "income"},
        {"ids": [str(uuid.uuid4())], "kind": "profit"},
        {"ids": [str(uuid.uuid4())]},
        {"ids": [str(uuid.uuid4())], "kind": "income", "extra": True},
    ],
)
def test_linking_needs_transactions_and_what_they_count_as(
    admin_client: TestClient, body: dict[str, Any]
) -> None:
    budget = make_budget(admin_client)

    response = admin_client.post(f"/api/budgets/{budget['id']}/transactions", json=body)

    assert response.status_code == 422


# ---- Things that count --------------------------------------------------------------------


def test_accounts_categories_subscriptions_and_automations_count_toward_a_budget(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    automation = Automation(
        name="Paycheck",
        payees=["Acme Corp"],
        category_id=things.paycheck.id,
        apply_to=AutomationScope.ALL,
        active=True,
    )
    session.add(automation)
    session.commit()
    budget = make_budget(admin_client)

    added = [
        count(admin_client, budget, "spending", account=things.card.id),
        count(admin_client, budget, "income", category=things.paycheck.id),
        count(admin_client, budget, "spending", subscription=things.netflix.id),
        count(admin_client, budget, "income", automation=automation.id),
    ]

    assert [
        (item["type"], item["kind"], item["name"], item["target_id"], item["active"])
        for item in added
    ] == [
        ("account", "spending", "Rewards Visa", str(things.card.id), True),
        ("category", "income", "Paycheck", str(things.paycheck.id), True),
        ("subscription", "spending", "Netflix", str(things.netflix.id), True),
        ("automation", "income", "Paycheck", str(automation.id), True),
    ]
    assert all(uuid.UUID(item["id"]) for item in added)


def test_an_account_can_count_as_both_income_and_spending_but_not_twice(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "income", account=things.checking.id)
    count(admin_client, budget, "spending", account=things.checking.id)

    repeated = admin_client.post(
        f"/api/budgets/{budget['id']}/sources",
        json={"kind": "income", "account_id": str(things.checking.id)},
    )

    assert (repeated.status_code, error(repeated)) == (409, "already_counted")
    assert [item["kind"] for item in view(admin_client, budget)["sources"]] == [
        "income",
        "spending",
    ]


@pytest.mark.parametrize("target", ["category", "subscription", "automation"])
def test_a_category_subscription_or_automation_counts_only_once_for_a_budget(
    admin_client: TestClient, session: Session, target: str
) -> None:
    things = household(session)
    automation = Automation(
        name="Paycheck",
        payees=["Acme Corp"],
        category_id=things.paycheck.id,
        apply_to=AutomationScope.ALL,
        active=True,
    )
    session.add(automation)
    session.commit()
    ids = {
        "category": things.groceries.id,
        "subscription": things.netflix.id,
        "automation": automation.id,
    }
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", **{target: ids[target]})

    repeated = admin_client.post(
        f"/api/budgets/{budget['id']}/sources",
        json={"kind": "spending", f"{target}_id": str(ids[target])},
    )

    assert (repeated.status_code, error(repeated)) == (409, "already_counted")
    # It's another budget's, too.
    other = make_budget(admin_client, name="Other")
    count(admin_client, other, "spending", **{target: ids[target]})


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "income"},
        {"kind": "income", "account_id": str(uuid.uuid4()), "category_id": str(uuid.uuid4())},
        {"kind": "income", "subscription_id": str(uuid.uuid4())},
        {"kind": "spending", "account_id": "abc"},
        {"account_id": str(uuid.uuid4())},
        {"kind": "profit", "account_id": str(uuid.uuid4())},
    ],
)
def test_a_source_is_one_thing_and_a_subscription_is_only_ever_spending(
    admin_client: TestClient, body: dict[str, Any]
) -> None:
    budget = make_budget(admin_client)

    assert admin_client.post(f"/api/budgets/{budget['id']}/sources", json=body).status_code == 422


@pytest.mark.parametrize(
    ("target", "code"),
    [
        ("account", "unknown_account"),
        ("category", "unknown_category"),
        ("subscription", "unknown_subscription"),
        ("automation", "unknown_automation"),
    ],
)
def test_something_that_is_gone_cannot_count(
    admin_client: TestClient, target: str, code: str
) -> None:
    budget = make_budget(admin_client)

    response = admin_client.post(
        f"/api/budgets/{budget['id']}/sources",
        json={"kind": "spending", f"{target}_id": str(uuid.uuid4())},
    )

    assert (response.status_code, error(response)) == (422, code)


def test_a_source_can_stop_counting(admin_client: TestClient, session: Session) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    category = count(admin_client, budget, "spending", category=things.groceries.id)
    link(admin_client, budget, "spending", things.rent_payment)
    assert view(admin_client, budget)["spent"] == "1955.92"

    response = admin_client.delete(f"/api/budgets/{budget['id']}/sources/{category['id']}")

    assert response.status_code == 204
    assert view(admin_client, budget)["spent"] == "1850.00"
    assert view(admin_client, budget)["sources"] == []


def test_only_sources_can_be_removed_as_sources(admin_client: TestClient, session: Session) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    other = make_budget(admin_client, name="Other")
    category = count(admin_client, other, "spending", category=things.groceries.id)
    link(admin_client, budget, "spending", things.rent_payment)
    own_link = session.scalar(select(BudgetLink.id).where(BudgetLink.transaction_id.is_not(None)))

    attempts = [
        admin_client.delete(f"/api/budgets/{budget['id']}/sources/{own_link}"),
        admin_client.delete(f"/api/budgets/{budget['id']}/sources/{category['id']}"),
        admin_client.delete(f"/api/budgets/{budget['id']}/sources/{uuid.uuid4()}"),
    ]

    assert [error(response) for response in attempts] == ["not_found"] * 3
    assert stored(session, BudgetLink) == 2


def test_sources_are_listed_with_income_first(admin_client: TestClient, session: Session) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", category=things.groceries.id)
    count(admin_client, budget, "income", category=things.paycheck.id)
    count(admin_client, budget, "spending", account=things.card.id)

    sources = view(admin_client, budget)["sources"]

    assert [(item["kind"], item["name"]) for item in sources] == [
        ("income", "Paycheck"),
        ("spending", "Groceries"),
        ("spending", "Rewards Visa"),
    ]


# ---- Other currencies -------------------------------------------------------------------


def test_accounts_in_other_currencies_count_in_the_households_a_day_at_a_time(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    euros = add_account(session, "Euro account", currency="EUR")
    add_transaction(session, euros, "-100.00", "Cafe", date=day(10))
    add_transaction(session, euros, "-50.00", "Bistro", date=day(11))
    add_transaction(session, euros, "40.00", "Pay", date=day(12))
    rates.rate("EUR", {day(10): "1.10", day(11): "1.20", day(12): "1.00"})
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", account=euros.id)
    count(admin_client, budget, "income", account=euros.id)

    period = view(admin_client, budget)

    assert (period["income"], period["spent"]) == ("40.00", "170.00")
    assert (period["converted"], period["unavailable"]) == (["EUR"], [])
    assert [(item["payee"], item["amount"]) for item in counted(admin_client, budget)] == [
        ("Pay", "40.00"),
        ("Bistro", "-50.00"),
        ("Cafe", "-100.00"),
    ]


def test_currencies_without_a_rate_are_left_out_and_said_so(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    euros = add_account(session, "Euro account", currency="EUR")
    pounds = add_account(session, "Pound account", currency="GBP")
    add_transaction(session, euros, "-100.00", "Cafe", date=day(10))
    add_transaction(session, pounds, "-70.00", "Pub", date=day(10))
    rates.rate("EUR", "1.10")
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", account=euros.id)
    count(admin_client, budget, "spending", account=pounds.id)

    period = view(admin_client, budget)

    assert period["spent"] == "110.00"
    assert (period["converted"], period["unavailable"]) == (["EUR"], ["GBP"])


def test_nothing_in_another_currency_counts_when_the_rate_server_cannot_be_reached(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    euros = add_account(session, "Euro account", currency="EUR")
    add_transaction(session, euros, "-100.00", "Cafe", date=day(10))
    rates.unreachable = True
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", account=euros.id)

    period = view(admin_client, budget)

    assert (period["spent"], period["converted"], period["unavailable"]) == ("0.00", [], ["EUR"])


# ---- Bills still to come ----------------------------------------------------------------


def subscription(session: Session, account: Account, name: str, **fields: Any) -> Subscription:
    item = Subscription(
        name=name,
        payee=name,
        amount=fields.pop("amount", Decimal("10.00")),
        frequency=fields.pop("frequency", PaymentFrequency.MONTHLY),
        account_id=account.id,
        next_due_date=fields.pop("next_due_date", dt.date(2026, 9, 25)),
        **fields,
    )
    session.add(item)
    session.commit()
    return item


def test_the_bills_still_to_come_are_the_payments_due_before_the_period_ends(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    gym = subscription(
        session,
        things.checking,
        "Gym",
        frequency=PaymentFrequency.WEEKLY,
        next_due_date=dt.date(2026, 9, 22),
    )
    power = subscription(
        session, things.checking, "Power", amount=Decimal("100.00"), amount_varies=True
    )
    paused = subscription(session, things.checking, "Old magazine", active=False)
    unlinked = subscription(session, things.checking, "Not counted")
    for index, amount in enumerate(["-120.00", "-140.00"]):
        add_transaction(
            session,
            things.checking,
            amount,
            "Power",
            date=dt.date(2026, 8, 1 + index),
            subscription_id=power.id,
        )
    budget = make_budget(admin_client)
    for item in (gym, power, paused, things.netflix):
        count(admin_client, budget, "spending", subscription=item.id)

    period = view(admin_client, budget)

    # The gym is due twice more in September, and the power bill is what it usually comes to.
    # Netflix isn't due until next month, so it isn't in this period, and a paused one never is.
    assert [(item["name"], item["due_on"], item["amount"]) for item in period["upcoming"]] == [
        ("Gym", "2026-09-22", "10.00"),
        ("Power", "2026-09-25", "130.00"),
        ("Gym", "2026-09-29", "10.00"),
    ]
    assert unlinked.id not in [item["subscription_id"] for item in period["upcoming"]]
    # They're only for the period the person is in.
    assert view(admin_client, budget, "2026-08-10")["upcoming"] == []
    assert view(admin_client, budget, "2026-10-10")["upcoming"] == []


def test_bills_still_to_come_in_other_currencies_are_converted_or_left_out(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    euros = add_account(session, "Euro account", currency="EUR")
    pounds = add_account(session, "Pound account", currency="GBP")
    rates.rate("EUR", "1.10")
    abroad = subscription(session, euros, "Streamflix", amount=Decimal("20.00"))
    unknown = subscription(session, pounds, "Pub club", amount=Decimal("30.00"))
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", subscription=abroad.id)
    count(admin_client, budget, "spending", subscription=unknown.id)

    period = view(admin_client, budget)

    assert [(item["name"], item["amount"]) for item in period["upcoming"]] == [
        ("Streamflix", "22.00")
    ]


# ---- How it went, period by period ---------------------------------------------------------


def history(
    client: TestClient, budget: dict[str, Any], on: str | None = None, **params: Any
) -> dict[str, Any]:
    query = {"today": TODAY.isoformat(), **({"on": on} if on else {}), **params}
    response = client.get(f"/api/budgets/{budget['id']}/history", params=query)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_the_history_gives_what_each_of_the_latest_periods_came_to(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    add_transaction(
        session, things.checking, "1000.00", "Acme", date=dt.date(2026, 8, 15),
        category_id=things.paycheck.id,
    )  # fmt: skip
    for month, amount in ((8, "-50.00"), (7, "-30.00")):
        add_transaction(
            session, things.checking, amount, "Market", date=dt.date(2026, month, 2),
            category_id=things.groceries.id,
        )  # fmt: skip
    budget = make_budget(admin_client, today="2026-07-05")
    admin_client.patch(
        f"/api/budgets/{budget['id']}", json={"amount": "1800", "today": "2026-08-05"}
    )
    count(admin_client, budget, "income", category=things.paycheck.id)
    count(admin_client, budget, "spending", category=things.groceries.id)

    body = history(admin_client, budget, count=3)

    assert [
        (item["start"], item["end"], item["amount"], item["income"], item["spent"], item["current"])
        for item in body["periods"]
    ] == [
        ("2026-07-01", "2026-07-31", "2000.00", "0.00", "30.00", False),
        ("2026-08-01", "2026-08-31", "1800.00", "1000.00", "50.00", False),
        ("2026-09-01", "2026-09-30", "1800.00", "2400.00", "105.92", True),
    ]
    assert (body["converted"], body["unavailable"]) == ([], [])


def test_the_history_ends_with_the_period_asked_about_and_goes_back_before_the_budget(
    admin_client: TestClient,
) -> None:
    budget = make_budget(admin_client)

    body = history(admin_client, budget, on="2026-03-15")

    assert len(body["periods"]) == 12
    assert [body["periods"][0]["start"], body["periods"][-1]["start"]] == [
        "2025-04-01",
        "2026-03-01",
    ]
    assert not any(item["current"] for item in body["periods"])
    assert len(history(admin_client, budget)["periods"]) == 12


@pytest.mark.parametrize("count_of", [0, 61, -1])
def test_the_history_covers_at_least_one_and_at_most_sixty_periods(
    admin_client: TestClient, count_of: int
) -> None:
    budget = make_budget(admin_client)

    response = admin_client.get(f"/api/budgets/{budget['id']}/history", params={"count": count_of})

    assert response.status_code == 422


def test_weeks_have_their_own_history(admin_client: TestClient, session: Session) -> None:
    things = household(session)
    budget = make_budget(admin_client, period="weekly", amount="300")
    for days, amount in ((dt.date(2026, 9, 19), "-5.00"), (dt.date(2026, 9, 20), "-7.00")):
        add_transaction(session, things.checking, amount, "Week", date=days)
    add_transaction(session, things.checking, "-9.00", "Week", date=dt.date(2026, 9, 26))
    add_transaction(session, things.checking, "-11.00", "Week", date=dt.date(2026, 9, 27))
    count(admin_client, budget, "spending", account=things.checking.id)

    body = history(admin_client, budget, on="2026-09-27", count=3)

    assert [
        (item["start"], item["end"], item["spent"], item["current"]) for item in body["periods"]
    ] == [
        ("2026-09-13", "2026-09-19", "5.00", False),
        # The 12.00 for hardware that the household had that week is there too.
        ("2026-09-20", "2026-09-26", "28.00", True),
        ("2026-09-27", "2026-10-03", "11.00", False),
    ]


def test_years_have_their_own_history_in_the_household_currency(
    admin_client: TestClient, session: Session, rates: FakeRates
) -> None:
    euros = add_account(session, "Euro account", currency="EUR")
    add_transaction(session, euros, "-100.00", "Cafe", date=dt.date(2025, 12, 31))
    add_transaction(session, euros, "-100.00", "Cafe", date=dt.date(2026, 1, 1))
    rates.rate("EUR", "1.10")
    budget = make_budget(admin_client, period="yearly", amount="12000")
    count(admin_client, budget, "spending", account=euros.id)

    body = history(admin_client, budget, count=2)

    assert [(item["start"], item["spent"]) for item in body["periods"]] == [
        ("2025-01-01", "110.00"),
        ("2026-01-01", "110.00"),
    ]
    assert body["converted"] == ["EUR"]


# ---- Listing what counts ---------------------------------------------------------------------


def test_what_counts_is_listed_newest_first_with_what_counts_it(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count_everything(admin_client, budget, things)

    items = counted(admin_client, budget)

    assert summary(items) == [
        ("Hardware Hank", "spending", "account"),
        ("Acme Corp", "income", "category"),
        ("Target", "spending", "category"),
        ("Trader Joes", "spending", "category"),
        ("Netflix", "spending", "subscription"),
        ("Whole Foods", "spending", "category"),
        ("Parkside", "spending", "transaction"),
    ]
    assert items[0]["id"] == str(things.hardware.id)
    assert (items[0]["date"], items[0]["amount"], items[0]["account_id"]) == (
        "2026-09-20",
        "-12.00",
        str(things.checking.id),
    )
    assert (items[1]["category_id"], items[3]["category_id"]) == (
        str(things.paycheck.id),
        str(things.groceries.id),
    )
    assert counted(admin_client, budget, "2026-08-10") == []


def test_the_list_can_be_paged_and_narrowed_to_income_or_spending(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count_everything(admin_client, budget, things)
    params: dict[str, Any] = {"today": TODAY.isoformat(), "page_size": 3}

    pages = [
        admin_client.get(f"/api/budgets/{budget['id']}/transactions", params={**params, "page": n})
        for n in (1, 2, 3, 4)
    ]

    assert [response.json()["total"] for response in pages] == [7] * 4
    assert [len(response.json()["items"]) for response in pages] == [3, 3, 1, 0]
    assert [item["payee"] for item in pages[2].json()["items"]] == ["Parkside"]
    assert summary(counted(admin_client, budget, kind="income")) == [
        ("Acme Corp", "income", "category")
    ]
    assert len(counted(admin_client, budget, kind="spending")) == 6


@pytest.mark.parametrize(
    "params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"kind": "profit"}]
)
def test_the_list_needs_a_sensible_page_and_kind(
    admin_client: TestClient, params: dict[str, Any]
) -> None:
    budget = make_budget(admin_client)

    response = admin_client.get(f"/api/budgets/{budget['id']}/transactions", params=params)

    assert response.status_code == 422


def test_the_list_follows_the_servers_date_unless_told_otherwise(
    admin_client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    things = household(session)
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", account=things.checking.id)
    monkeypatch.setattr("app.api.budget.utcnow", lambda: dt.datetime(2026, 9, 12, tzinfo=dt.UTC))

    response = admin_client.get(f"/api/budgets/{budget['id']}/transactions")

    assert response.status_code == 200
    assert response.json()["total"] == 3


def test_a_bill_counts_toward_a_budget_like_a_subscription_and_is_told_apart(
    admin_client: TestClient, session: Session
) -> None:
    things = household(session)
    power = subscription(
        session,
        things.checking,
        "Power",
        kind=RecurringKind.BILL,
        amount=Decimal("100.00"),
        next_due_date=dt.date(2026, 9, 25),
    )
    add_transaction(
        session, things.checking, "-120.00", "Power", date=day(3), subscription_id=power.id
    )
    # A subscription of the same budget is counted the same way, and is a subscription still.
    budget = make_budget(admin_client)
    count(admin_client, budget, "spending", subscription=things.netflix.id)

    source = count(admin_client, budget, "spending", subscription=power.id)

    assert (source["type"], source["name"], source["target_id"]) == ("bill", "Power", str(power.id))
    period = view(admin_client, budget)
    assert [
        (item["type"], item["name"], item["amount"], item["count"]) for item in period["sources"]
    ] == [
        ("subscription", "Netflix", "15.49", 1),
        ("bill", "Power", "120.00", 1),
    ]
    # What it paid counts as spending, and what it has still to pay this period is expected.
    assert ("Power", "spending", "subscription") in summary(counted(admin_client, budget))
    assert [(item["name"], item["kind"], item["due_on"]) for item in period["upcoming"]] == [
        ("Power", "bill", "2026-09-25")
    ]
    # A bill's payments are money out, so it can't count as income.
    income = admin_client.post(
        f"/api/budgets/{budget['id']}/sources",
        json={"kind": "income", "subscription_id": str(power.id)},
    )
    assert income.status_code == 422
    assert "subscription or bill" in income.text
