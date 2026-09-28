import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.finance.budget import add_months, amount_at, months_between, year_start
from app.models import (
    Account,
    AppSettings,
    Budget,
    BudgetAmount,
    BudgetPeriod,
    Category,
    CategoryGroup,
    CategoryKind,
)
from app.models.app_settings import SINGLETON_ID
from tests.finance import add_account, add_category, add_group, add_transaction
from tests.helpers import error

SEPTEMBER = dt.date(2026, 9, 1)


def day(month: str, number: int = 15) -> dt.date:
    year, month_number = month.split("-")
    return dt.date(int(year), int(month_number), number)


@pytest.fixture
def checking(session: Session) -> Account:
    return add_account(session)


@pytest.fixture
def categories(session: Session) -> dict[str, Category]:
    """Income, two groups of spending, and transfers, which aren't budgeted."""
    income = add_group(session, "Income", CategoryKind.INCOME)
    food = add_group(session, "Food & drink")
    lifestyle = add_group(session, "lifestyle")
    transfers = add_group(session, "Transfers", CategoryKind.TRANSFER)
    return {
        name: add_category(session, name, group, emoji)
        for name, group, emoji in (
            ("Paycheck", income, "💼"),
            ("Groceries", food, "🛒"),
            ("restaurants", food, "🍽️"),
            ("Travel", lifestyle, "✈️"),
            ("Credit card payments", transfers, "💳"),
        )
    }


def spend(
    session: Session, account: Account, category: Category | None, amount: str, when: dt.date
) -> None:
    add_transaction(session, account, amount, date=when, category_id=category and category.id)


def budget(
    session: Session,
    category: Category,
    amounts: dict[str, str | None],
    *,
    period: BudgetPeriod = BudgetPeriod.MONTHLY,
    rollover_since: str | None = None,
) -> Budget:
    """A budget with amounts starting in the months given as "2026-09"."""
    row = Budget(
        category_id=category.id,
        period=period,
        rollover_since=day(rollover_since, 1) if rollover_since else None,
        amounts=[
            BudgetAmount(
                starts_on=day(month, 1), amount=None if amount is None else Decimal(amount)
            )
            for month, amount in amounts.items()
        ],
    )
    session.add(row)
    session.commit()
    return row


def set_general(session: Session, **general: Any) -> None:
    session.add(AppSettings(id=SINGLETON_ID, data={"general": general}))
    session.commit()


def get_month(client: TestClient, month: str = "2026-09") -> dict[str, Any]:
    response = client.get(f"/api/budget/months/{month}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def lines(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {line["name"]: line for group in body["groups"] for line in group["categories"]}


def stored_amounts(session: Session, category: Category) -> dict[str, str | None]:
    """A category's budget amounts as they're stored, by the month each starts."""
    session.expire_all()
    rows = session.scalars(
        select(BudgetAmount)
        .join(Budget)
        .where(Budget.category_id == category.id)
        .order_by(BudgetAmount.starts_on)
    )
    return {
        f"{row.starts_on:%Y-%m}": None if row.amount is None else str(row.amount) for row in rows
    }


def stored_budget(session: Session, category: Category) -> Budget | None:
    session.expire_all()
    return session.scalar(select(Budget).where(Budget.category_id == category.id))


def put_budget(client: TestClient, category: Category, **body: Any) -> dict[str, Any]:
    response = client.put(f"/api/budget/categories/{category.id}", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


# ---- Months --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("month", "count", "expected"),
    [
        (dt.date(2026, 9, 1), 0, dt.date(2026, 9, 1)),
        (dt.date(2026, 9, 1), 4, dt.date(2027, 1, 1)),
        (dt.date(2026, 1, 1), -1, dt.date(2025, 12, 1)),
        (dt.date(2026, 3, 1), -26, dt.date(2024, 1, 1)),
    ],
)
def test_adding_months_crosses_years(month: dt.date, count: int, expected: dt.date) -> None:
    assert add_months(month, count) == expected
    assert months_between(month, expected) == count


@pytest.mark.parametrize(
    ("month", "first_month", "expected"),
    [
        (dt.date(2026, 9, 1), 1, dt.date(2026, 1, 1)),
        (dt.date(2026, 9, 1), 7, dt.date(2026, 7, 1)),
        (dt.date(2026, 3, 1), 7, dt.date(2025, 7, 1)),
        (dt.date(2026, 12, 1), 12, dt.date(2026, 12, 1)),
    ],
)
def test_budget_years_start_in_the_chosen_month(
    month: dt.date, first_month: int, expected: dt.date
) -> None:
    assert year_start(month, first_month) == expected


def test_the_latest_amount_to_start_applies_whatever_the_order() -> None:
    amounts = [
        BudgetAmount(starts_on=dt.date(2026, 9, 1), amount=Decimal("650.00")),
        BudgetAmount(starts_on=dt.date(2026, 6, 1), amount=Decimal("600.00")),
    ]

    assert amount_at(amounts, dt.date(2026, 5, 1)) is None
    assert amount_at(amounts, dt.date(2026, 8, 1)) == Decimal("600.00")
    assert amount_at(amounts, dt.date(2027, 1, 1)) == Decimal("650.00")


# ---- A month's budget ----------------------------------------------------------------------


def test_signing_in_is_needed_to_see_the_budget(client: TestClient) -> None:
    assert error(client.get("/api/budget/months/2026-09")) == "not_signed_in"
    assert error(client.get("/api/budget/years/2026")) == "not_signed_in"


@pytest.mark.parametrize(
    "month", ["2026-13", "2026-9", "26-09", "1969-12", "2200-01", "2026-09-01"]
)
def test_months_are_checked(viewer_client: TestClient, month: str) -> None:
    response = viewer_client.get(f"/api/budget/months/{month}")

    assert response.status_code == 422
    assert "like 2026-09" in response.text


def test_a_household_without_categories_has_nothing_budgeted(viewer_client: TestClient) -> None:
    body = get_month(viewer_client)

    assert body == {
        "month": "2026-09",
        "currency": "USD",
        "year": 2026,
        "year_start": "2026-01",
        "year_end": "2026-12",
        "income": {"budgeted": "0.00", "carried": "0.00", "actual": "0.00"},
        "spending": {"budgeted": "0.00", "carried": "0.00", "actual": "0.00"},
        "groups": [],
        "uncategorized": {"received": "0.00", "spent": "0.00", "count": 0},
        "other_currencies": [],
    }


def test_everyone_sees_income_then_spending_and_no_transfers(
    viewer_client: TestClient, categories: dict[str, Category]
) -> None:
    body = get_month(viewer_client)

    assert [(group["name"], group["kind"]) for group in body["groups"]] == [
        ("Income", "income"),
        ("Food & drink", "expense"),
        ("lifestyle", "expense"),
    ]
    assert [line["name"] for line in body["groups"][1]["categories"]] == [
        "Groceries",
        "restaurants",
    ]
    assert body["groups"][1]["categories"][0] == {
        "category_id": str(categories["Groceries"].id),
        "name": "Groceries",
        "emoji": "🛒",
        "period": None,
        "amount": None,
        "rollover": False,
        "carried": "0.00",
        "actual": "0.00",
        "year_to_date": None,
        "average": "0.00",
        "count": 0,
    }


def test_the_month_counts_what_was_spent_and_received(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    groceries, paycheck = categories["Groceries"], categories["Paycheck"]
    spend(session, checking, groceries, "-84.12", day("2026-09", 1))
    spend(session, checking, groceries, "-40.00", day("2026-09", 30))
    # A refund takes off what was spent.
    spend(session, checking, groceries, "4.12", day("2026-09", 20))
    spend(session, checking, paycheck, "2400.00", day("2026-09", 13))
    add_transaction(
        session, checking, "-18.00", date=day("2026-09", 2), category_id=groceries.id, pending=True
    )
    # Other months, transfers and uncategorized transactions don't count toward categories.
    spend(session, checking, groceries, "-99.00", day("2026-08", 31))
    spend(session, checking, groceries, "-99.00", day("2026-10", 1))
    spend(session, checking, categories["Credit card payments"], "-300.00", day("2026-09"))
    spend(session, checking, None, "-45.00", day("2026-09", 3))
    spend(session, checking, None, "12.50", day("2026-09", 4))
    spend(session, checking, None, "-5.00", day("2026-09", 5))

    body = get_month(viewer_client)

    assert lines(body)["Groceries"]["actual"] == "138.00"
    assert lines(body)["Groceries"]["count"] == 4
    assert lines(body)["Paycheck"]["actual"] == "2400.00"
    assert lines(body)["restaurants"]["actual"] == "0.00"
    assert body["uncategorized"] == {"received": "12.50", "spent": "50.00", "count": 3}
    # Uncategorized transactions count toward what came in and went out, but no budget.
    assert body["income"]["actual"] == "2412.50"
    assert body["spending"]["actual"] == "188.00"


def test_only_the_households_currency_counts(
    viewer_client: TestClient, session: Session, checking: Account, categories: dict[str, Category]
) -> None:
    euros = add_account(session, "Paris account", currency="EUR")
    pounds = add_account(session, "London account", currency="GBP")
    groceries = categories["Groceries"]
    spend(session, checking, groceries, "-10.00", day("2026-09"))
    spend(session, euros, groceries, "-20.00", day("2026-09"))
    spend(session, pounds, None, "-30.00", day("2026-09"))
    spend(session, pounds, None, "-30.00", day("2026-08"))

    body = get_month(viewer_client)

    assert lines(body)["Groceries"]["actual"] == "10.00"
    assert body["uncategorized"]["count"] == 0
    assert body["other_currencies"] == ["EUR", "GBP"]
    assert get_month(viewer_client, "2026-08")["other_currencies"] == ["GBP"]


def test_the_households_currency_comes_from_its_settings(
    viewer_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    set_general(session, currency="EUR")
    euros = add_account(session, "Paris account", currency="EUR")
    dollars = add_account(session, "Chicago account")
    spend(session, euros, categories["Groceries"], "-20.00", day("2026-09"))
    spend(session, dollars, categories["Groceries"], "-10.00", day("2026-09"))

    body = get_month(viewer_client)

    assert body["currency"] == "EUR"
    assert lines(body)["Groceries"]["actual"] == "20.00"
    assert body["other_currencies"] == ["USD"]


def test_monthly_budgets_add_up_by_kind(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    budget(session, categories["Groceries"], {"2026-06": "600.00", "2026-09": "650.00"})
    budget(session, categories["restaurants"], {"2026-01": "150.00"})
    budget(session, categories["Paycheck"], {"2026-01": "4800.00"})
    spend(session, checking, categories["restaurants"], "-60.00", day("2026-09"))

    body = get_month(viewer_client)

    assert lines(body)["Groceries"]["period"] == "monthly"
    assert lines(body)["Groceries"]["amount"] == "650.00"
    assert lines(body)["restaurants"]["amount"] == "150.00"
    assert lines(body)["Paycheck"]["amount"] == "4800.00"
    assert body["spending"] == {"budgeted": "800.00", "carried": "0.00", "actual": "60.00"}
    assert body["income"]["budgeted"] == "4800.00"
    # Past months keep the budget they had.
    assert lines(get_month(viewer_client, "2026-07"))["Groceries"]["amount"] == "600.00"
    assert lines(get_month(viewer_client, "2026-05"))["Groceries"]["amount"] is None


def test_a_budget_stopped_from_a_month_on_is_still_monthly(
    viewer_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    budget(session, categories["Groceries"], {"2026-06": "600.00", "2026-08": None})

    line = lines(get_month(viewer_client))["Groceries"]

    assert (line["period"], line["amount"]) == ("monthly", None)


def test_yearly_budgets_count_the_year_so_far(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    travel = categories["Travel"]
    budget(session, travel, {"2026-01": "3000.00"}, period=BudgetPeriod.YEARLY)
    budget(session, categories["Groceries"], {"2026-01": "600.00"})
    spend(session, checking, travel, "-612.00", day("2026-02"))
    spend(session, checking, travel, "-486.20", day("2026-09"))
    spend(session, checking, travel, "-100.00", day("2026-10"))
    spend(session, checking, travel, "-100.00", day("2025-12"))

    body = get_month(viewer_client)

    assert lines(body)["Travel"] | {"category_id": None} == {
        "category_id": None,
        "name": "Travel",
        "emoji": "✈️",
        "period": "yearly",
        "amount": "3000.00",
        "rollover": False,
        "carried": "0.00",
        "actual": "486.20",
        "year_to_date": "1098.20",
        "average": "0.00",
        "count": 1,
    }
    # Each month counts a twelfth of a yearly budget.
    assert body["spending"]["budgeted"] == "850.00"
    # Before the budgets started, there was nothing to count.
    assert get_month(viewer_client, "2025-12")["spending"]["budgeted"] == "0.00"


def test_yearly_budgets_follow_the_budget_year(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    set_general(session, fiscal_year_start_month=7)
    travel = categories["Travel"]
    budget(
        session,
        travel,
        {"2025-07": "1000.00", "2026-07": "2000.00"},
        period=BudgetPeriod.YEARLY,
    )
    spend(session, checking, travel, "-100.00", day("2026-06"))
    spend(session, checking, travel, "-200.00", day("2026-07"))

    september = get_month(viewer_client)
    june = get_month(viewer_client, "2026-06")

    assert (september["year"], september["year_start"], september["year_end"]) == (
        2026,
        "2026-07",
        "2027-06",
    )
    assert (lines(september)["Travel"]["amount"], lines(september)["Travel"]["year_to_date"]) == (
        "2000.00",
        "200.00",
    )
    assert (june["year"], june["year_start"], june["year_end"]) == (2025, "2025-07", "2026-06")
    assert (lines(june)["Travel"]["amount"], lines(june)["Travel"]["year_to_date"]) == (
        "1000.00",
        "100.00",
    )


def test_rollover_carries_what_was_left_into_the_next_month(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    groceries = categories["Groceries"]
    budget(
        session,
        groceries,
        {"2026-05": "500.00", "2026-07": "600.00", "2026-08": None},
        rollover_since="2026-06",
    )
    spend(session, checking, groceries, "-999.00", day("2026-05"))
    spend(session, checking, groceries, "-420.00", day("2026-06"))
    spend(session, checking, groceries, "-650.00", day("2026-07"))
    # Nothing's budgeted in August, so what's spent comes off what rolls over.
    spend(session, checking, groceries, "-20.00", day("2026-08"))
    spend(session, checking, groceries, "-100.00", day("2026-09"))

    def carried(month: str) -> tuple[str, bool]:
        line = lines(get_month(viewer_client, month))["Groceries"]
        return line["carried"], line["rollover"]

    assert carried("2026-05") == ("0.00", True)
    assert carried("2026-06") == ("0.00", True)
    assert carried("2026-07") == ("80.00", True)
    assert carried("2026-08") == ("30.00", True)
    assert carried("2026-09") == ("10.00", True)
    body = get_month(viewer_client)
    assert body["spending"] == {"budgeted": "0.00", "carried": "10.00", "actual": "100.00"}


def test_only_monthly_spending_rolls_over(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    budget(session, categories["Paycheck"], {"2026-01": "4800.00"}, rollover_since="2026-01")
    budget(
        session,
        categories["Travel"],
        {"2026-01": "3000.00"},
        period=BudgetPeriod.YEARLY,
        rollover_since="2026-01",
    )

    body = get_month(viewer_client)

    for name in ("Paycheck", "Travel"):
        assert (lines(body)[name]["rollover"], lines(body)[name]["carried"]) == (False, "0.00")


def test_averages_look_back_three_months_since_transactions_started(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    groceries, paycheck = categories["Groceries"], categories["Paycheck"]
    spend(session, checking, groceries, "-300.00", day("2026-07"))
    spend(session, checking, groceries, "-200.00", day("2026-08"))
    spend(session, checking, groceries, "-100.00", day("2026-09"))
    spend(session, checking, paycheck, "1000.00", day("2026-08"))
    # More refunded than spent averages nothing.
    spend(session, checking, categories["restaurants"], "10.00", day("2026-08"))

    def averages(month: str) -> tuple[str, str, str]:
        found = lines(get_month(viewer_client, month))
        return (
            found["Groceries"]["average"],
            found["Paycheck"]["average"],
            found["restaurants"]["average"],
        )

    assert averages("2026-07") == ("0.00", "0.00", "0.00")
    assert averages("2026-08") == ("300.00", "0.00", "0.00")
    assert averages("2026-09") == ("250.00", "500.00", "0.00")
    assert averages("2026-10") == ("200.00", "333.33", "0.00")
    assert averages("2026-12") == ("33.33", "0.00", "0.00")


def test_averages_are_nothing_without_transactions(
    viewer_client: TestClient, categories: dict[str, Category]
) -> None:
    assert lines(get_month(viewer_client))["Groceries"]["average"] == "0.00"


def test_a_category_moved_to_transfers_drops_out_of_the_budget(
    viewer_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]
    budget(session, groceries, {"2026-01": "600.00"})
    transfers = session.scalar(select(CategoryGroup).where(CategoryGroup.name == "Transfers"))
    assert transfers is not None
    groceries.group = transfers
    session.commit()

    body = get_month(viewer_client)

    assert "Groceries" not in lines(body)
    assert body["spending"]["budgeted"] == "0.00"


def test_deleting_a_category_deletes_its_budget(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    budget(session, categories["Groceries"], {"2026-01": "600.00"})

    response = admin_client.delete(f"/api/categories/{categories['Groceries'].id}")

    assert response.status_code == 204
    session.expire_all()
    assert session.scalars(select(Budget)).all() == []
    assert session.scalars(select(BudgetAmount)).all() == []


# ---- A year --------------------------------------------------------------------------------


def get_year(client: TestClient, year: int = 2026) -> dict[str, Any]:
    response = client.get(f"/api/budget/years/{year}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def year_lines(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {line["name"]: line for group in body["groups"] for line in group["categories"]}


@pytest.mark.parametrize("year", ["1969", "2200", "next"])
def test_years_are_checked(viewer_client: TestClient, year: str) -> None:
    assert viewer_client.get(f"/api/budget/years/{year}").status_code == 422


def test_the_year_shows_each_month(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    set_general(session, fiscal_year_start_month=7)
    groceries, travel, paycheck = (
        categories["Groceries"],
        categories["Travel"],
        categories["Paycheck"],
    )
    budget(session, groceries, {"2026-07": "600.00", "2026-10": "650.00", "2027-05": None})
    budget(session, travel, {"2026-07": "1200.00"}, period=BudgetPeriod.YEARLY)
    budget(session, paycheck, {"2026-09": "5000.00"})
    spend(session, checking, groceries, "-420.00", day("2026-07"))
    spend(session, checking, groceries, "-80.00", day("2027-06"))
    spend(session, checking, travel, "-612.00", day("2026-08"))
    spend(session, checking, paycheck, "4800.00", day("2026-09"))
    spend(session, checking, None, "-45.00", day("2026-07"))
    spend(session, checking, None, "20.00", day("2026-12"))
    # Before and after the budget year.
    spend(session, checking, groceries, "-999.00", day("2026-06"))
    spend(session, checking, groceries, "-999.00", day("2027-07"))
    spend(session, add_account(session, "Paris", currency="EUR"), None, "-5.00", day("2026-08"))

    body = get_year(viewer_client)

    assert (body["year"], body["start"], body["end"], body["currency"]) == (
        2026,
        "2026-07",
        "2027-06",
        "USD",
    )
    assert [month["month"] for month in body["months"]][:2] == ["2026-07", "2026-08"]
    assert len(body["months"]) == 12
    found = year_lines(body)
    assert found["Groceries"]["period"] == "monthly"
    assert [cell["budgeted"] for cell in found["Groceries"]["months"]] == [
        "600.00",
        "600.00",
        "600.00",
        *["650.00"] * 7,
        None,
        None,
    ]
    assert found["Groceries"]["amount"] == "6350.00"
    assert found["Groceries"]["actual"] == "500.00"
    assert found["Groceries"]["months"][0] == {"budgeted": "600.00", "actual": "420.00"}
    assert found["Travel"]["amount"] == "1200.00"
    assert found["Travel"]["months"][1] == {"budgeted": None, "actual": "612.00"}
    assert (found["restaurants"]["period"], found["restaurants"]["amount"]) == (None, None)
    assert found["Paycheck"]["amount"] == "50000.00"
    assert body["income"] == {"budgeted": "50000.00", "actual": "4820.00"}
    assert body["spending"] == {"budgeted": "7550.00", "actual": "1157.00"}
    assert body["months"][0] == {
        "month": "2026-07",
        "income": {"budgeted": "0.00", "actual": "0.00"},
        "spending": {"budgeted": "700.00", "actual": "465.00"},
    }
    assert body["months"][11]["spending"] == {"budgeted": "100.00", "actual": "80.00"}
    assert body["uncategorized"]["count"] == 2
    assert body["uncategorized"]["months"][0] == {"received": "0.00", "spent": "45.00"}
    assert body["uncategorized"]["months"][5] == {"received": "20.00", "spent": "0.00"}
    assert (body["uncategorized"]["received"], body["uncategorized"]["spent"]) == (
        "20.00",
        "45.00",
    )
    assert body["other_currencies"] == ["EUR"]


def test_a_year_without_categories_is_empty(viewer_client: TestClient) -> None:
    body = get_year(viewer_client, 2025)

    assert (body["start"], body["end"], body["groups"]) == ("2025-01", "2025-12", [])
    assert body["spending"] == {"budgeted": "0.00", "actual": "0.00"}


# ---- One category's history ----------------------------------------------------------------


def test_a_categorys_last_twelve_months(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    groceries = categories["Groceries"]
    budget(session, groceries, {"2026-03": "600.00"})
    spend(session, checking, groceries, "-420.00", day("2025-10"))
    spend(session, checking, groceries, "-80.00", day("2026-09"))
    spend(session, checking, groceries, "-999.00", day("2025-09"))
    spend(session, checking, categories["restaurants"], "-60.00", day("2026-09"))

    response = viewer_client.get(
        f"/api/budget/categories/{groceries.id}/history", params={"month": "2026-09"}
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["category_id"], body["kind"]) == (str(groceries.id), "expense")
    assert [month["month"] for month in body["months"]] == [
        "2025-10",
        "2025-11",
        "2025-12",
        *[f"2026-{number:02d}" for number in range(1, 10)],
    ]
    assert body["months"][0] == {"month": "2025-10", "budgeted": None, "actual": "420.00"}
    assert body["months"][-1] == {"month": "2026-09", "budgeted": "600.00", "actual": "80.00"}
    assert body["months"][4]["budgeted"] is None
    assert body["months"][5]["budgeted"] == "600.00"


def test_yearly_and_income_history_has_no_monthly_budget(
    viewer_client: TestClient,
    session: Session,
    checking: Account,
    categories: dict[str, Category],
) -> None:
    paycheck = categories["Paycheck"]
    budget(session, paycheck, {"2026-01": "50000.00"}, period=BudgetPeriod.YEARLY)
    spend(session, checking, paycheck, "2400.00", day("2026-09"))

    response = viewer_client.get(
        f"/api/budget/categories/{paycheck.id}/history", params={"month": "2026-09"}
    )

    assert response.json()["kind"] == "income"
    assert response.json()["months"][-1] == {
        "month": "2026-09",
        "budgeted": None,
        "actual": "2400.00",
    }


def test_history_needs_a_budgetable_category_and_a_month(
    viewer_client: TestClient, categories: dict[str, Category]
) -> None:
    transfers = categories["Credit card payments"]

    missing = viewer_client.get(
        f"/api/budget/categories/{uuid.uuid4()}/history", params={"month": "2026-09"}
    )
    transfer = viewer_client.get(
        f"/api/budget/categories/{transfers.id}/history", params={"month": "2026-09"}
    )
    no_month = viewer_client.get(f"/api/budget/categories/{transfers.id}/history")

    assert error(missing) == "not_found"
    assert error(transfer) == "transfer_category"
    assert transfer.json()["detail"]["message"] == (
        "Credit card payments is for money moving between your own accounts, which isn't budgeted."
    )
    assert no_month.status_code == 422


# ---- Budgeting a category ------------------------------------------------------------------


def test_an_admin_budgets_a_category_from_a_month_on(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]

    body = put_budget(admin_client, groceries, month="2026-09", amount="600")

    assert body["month"] == "2026-09"
    assert lines(body)["Groceries"]["amount"] == "600.00"
    assert body["spending"]["budgeted"] == "600.00"
    assert stored_amounts(session, groceries) == {"2026-09": "600.00"}
    assert lines(get_month(admin_client, "2027-02"))["Groceries"]["amount"] == "600.00"
    assert lines(get_month(admin_client, "2026-08"))["Groceries"]["amount"] is None


def test_a_new_amount_replaces_later_ones_and_leaves_earlier_ones(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]
    budget(
        session,
        groceries,
        {"2026-01": "500.00", "2026-06": "550.00", "2026-10": "700.00", "2026-12": "900.00"},
    )

    put_budget(admin_client, groceries, month="2026-09", amount="650.00")

    assert stored_amounts(session, groceries) == {
        "2026-01": "500.00",
        "2026-06": "550.00",
        "2026-09": "650.00",
    }


def test_an_amount_for_one_month_leaves_the_rest(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries, restaurants = categories["Groceries"], categories["restaurants"]
    budget(session, groceries, {"2026-01": "500.00", "2026-12": "900.00"})

    put_budget(admin_client, groceries, month="2026-09", amount="650", scope="only")
    put_budget(admin_client, groceries, month="2026-11", amount="800", scope="only")
    put_budget(admin_client, restaurants, month="2026-09", amount="100", scope="only")

    assert stored_amounts(session, groceries) == {
        "2026-01": "500.00",
        "2026-09": "650.00",
        "2026-10": "500.00",
        "2026-11": "800.00",
        "2026-12": "900.00",
    }
    # Before, it had no budget, so after, it has none again.
    assert stored_amounts(session, restaurants) == {"2026-09": "100.00", "2026-10": None}


def test_amounts_that_change_nothing_are_not_kept(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]
    budget(session, groceries, {"2026-01": "500.00", "2026-09": "650.00"})

    put_budget(admin_client, groceries, month="2026-05", amount="500", scope="only")
    put_budget(admin_client, groceries, month="2026-09", amount="500")

    assert stored_amounts(session, groceries) == {"2026-01": "500.00"}


def test_stopping_a_budget_from_a_month_on_keeps_earlier_months(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]
    budget(session, groceries, {"2026-01": "500.00", "2026-10": "700.00"})

    body = put_budget(admin_client, groceries, month="2026-09", amount=None)

    assert (lines(body)["Groceries"]["period"], lines(body)["Groceries"]["amount"]) == (
        "monthly",
        None,
    )
    assert stored_amounts(session, groceries) == {"2026-01": "500.00", "2026-09": None}


def test_stopping_a_budget_for_one_month(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]
    budget(session, groceries, {"2026-01": "500.00"})

    put_budget(admin_client, groceries, month="2026-09", amount=None, scope="only")

    assert stored_amounts(session, groceries) == {
        "2026-01": "500.00",
        "2026-09": None,
        "2026-10": "500.00",
    }


def test_a_budget_with_nothing_left_budgeted_is_deleted(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]
    budget(session, groceries, {"2026-09": "500.00"}, rollover_since="2026-09")

    body = put_budget(admin_client, groceries, month="2026-08", amount=None)

    assert lines(body)["Groceries"]["period"] is None
    assert stored_budget(session, groceries) is None


def test_stopping_a_budget_that_isnt_there_changes_nothing(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    put_budget(admin_client, categories["Groceries"], month="2026-09", amount=None, rollover=True)

    assert stored_budget(session, categories["Groceries"]) is None


def test_a_yearly_budget_is_for_the_budget_year(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    set_general(session, fiscal_year_start_month=7)
    travel = categories["Travel"]

    body = put_budget(admin_client, travel, month="2026-09", period="yearly", amount="3000")
    put_budget(admin_client, travel, month="2028-02", period="yearly", amount="4000", scope="only")

    assert (lines(body)["Travel"]["period"], lines(body)["Travel"]["amount"]) == (
        "yearly",
        "3000.00",
    )
    assert body["spending"]["budgeted"] == "250.00"
    assert stored_amounts(session, travel) == {
        "2026-07": "3000.00",
        "2027-07": "4000.00",
        "2028-07": "3000.00",
    }


def test_switching_between_monthly_and_yearly_starts_the_budget_afresh(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    travel = categories["Travel"]
    budget(session, travel, {"2025-01": "100.00", "2026-01": "250.00"}, rollover_since="2025-06")

    put_budget(admin_client, travel, month="2026-09", period="yearly", amount="3000")

    stored = stored_budget(session, travel)
    assert stored is not None
    assert (stored.period, stored.rollover_since) == (BudgetPeriod.YEARLY, None)
    assert stored_amounts(session, travel) == {"2026-01": "3000.00"}

    put_budget(admin_client, travel, month="2026-01", period="monthly", amount="250")

    assert stored_amounts(session, travel) == {"2026-01": "250.00"}


def test_rollover_starts_from_the_month_it_was_turned_on(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]

    body = put_budget(admin_client, groceries, month="2026-06", amount="600", rollover=True)
    put_budget(admin_client, groceries, month="2026-09", amount="650", rollover=True)

    assert lines(body)["Groceries"]["rollover"] is True
    stored = stored_budget(session, groceries)
    assert stored is not None
    assert stored.rollover_since == dt.date(2026, 6, 1)

    put_budget(admin_client, groceries, month="2026-09", amount="650")

    stored = stored_budget(session, groceries)
    assert stored is not None
    assert stored.rollover_since is None


def test_only_monthly_spending_budgets_roll_over(
    admin_client: TestClient, categories: dict[str, Category]
) -> None:
    yearly = admin_client.put(
        f"/api/budget/categories/{categories['Travel'].id}",
        json={"month": "2026-09", "period": "yearly", "amount": "3000", "rollover": True},
    )
    income = admin_client.put(
        f"/api/budget/categories/{categories['Paycheck'].id}",
        json={"month": "2026-09", "amount": "4800", "rollover": True},
    )

    assert yearly.status_code == 422
    assert "Only monthly budgets can roll over" in yearly.text
    assert error(income) == "rollover_income"


@pytest.mark.parametrize(
    "body",
    [
        {"month": "2026-09", "amount": "-5"},
        {"month": "2026-09", "amount": "5.001"},
        {"month": "2026-09", "amount": "1000000000000"},
        {"month": "2026-09"},
        {"month": "September", "amount": "5"},
        {"month": "2026-09", "amount": "5", "scope": "always"},
        {"month": "2026-09", "amount": "5", "period": "weekly"},
        {"month": "2026-09", "amount": "5", "note": "extra"},
    ],
)
def test_budget_changes_are_checked(
    admin_client: TestClient, categories: dict[str, Category], body: dict[str, Any]
) -> None:
    response = admin_client.put(f"/api/budget/categories/{categories['Groceries'].id}", json=body)

    assert response.status_code == 422


def test_transfers_and_missing_categories_cant_be_budgeted(
    admin_client: TestClient, categories: dict[str, Category]
) -> None:
    body = {"month": "2026-09", "amount": "300"}

    transfer = admin_client.put(
        f"/api/budget/categories/{categories['Credit card payments'].id}", json=body
    )
    missing = admin_client.put(f"/api/budget/categories/{uuid.uuid4()}", json=body)

    assert error(transfer) == "transfer_category"
    assert error(missing) == "not_found"


def test_viewers_cannot_change_budgets(
    viewer_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = categories["Groceries"]

    single = viewer_client.put(
        f"/api/budget/categories/{groceries.id}", json={"month": "2026-09", "amount": "600"}
    )
    plan = viewer_client.put(
        "/api/budget/months/2026-09",
        json={"amounts": [{"category_id": str(groceries.id), "amount": "600"}]},
    )

    assert error(single) == "admin_only"
    assert error(plan) == "admin_only"
    assert stored_budget(session, groceries) is None


# ---- Budgeting a month ---------------------------------------------------------------------


def put_plan(client: TestClient, month: str, **body: Any) -> dict[str, Any]:
    response = client.put(f"/api/budget/months/{month}", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_an_admin_budgets_several_categories_at_once(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    set_general(session, fiscal_year_start_month=4)
    groceries, restaurants, travel, paycheck = (
        categories["Groceries"],
        categories["restaurants"],
        categories["Travel"],
        categories["Paycheck"],
    )
    budget(session, restaurants, {"2026-01": "150.00"})
    budget(session, travel, {"2026-04": "1200.00"}, period=BudgetPeriod.YEARLY)

    body = put_plan(
        admin_client,
        "2026-09",
        amounts=[
            {"category_id": str(groceries.id), "amount": "600"},
            {"category_id": str(restaurants.id), "amount": None},
            {"category_id": str(travel.id), "amount": "2400"},
            {"category_id": str(paycheck.id), "amount": "4800.00"},
        ],
    )

    assert body["month"] == "2026-09"
    assert body["spending"]["budgeted"] == "800.00"
    assert body["income"]["budgeted"] == "4800.00"
    assert stored_amounts(session, groceries) == {"2026-09": "600.00"}
    assert stored_amounts(session, restaurants) == {"2026-01": "150.00", "2026-09": None}
    assert stored_amounts(session, travel) == {"2026-04": "2400.00"}
    stored = stored_budget(session, travel)
    assert stored is not None
    assert stored.period == BudgetPeriod.YEARLY


def test_a_plan_for_one_month_leaves_the_rest(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries, restaurants = categories["Groceries"], categories["restaurants"]
    budget(session, groceries, {"2026-01": "500.00"})

    put_plan(
        admin_client,
        "2026-12",
        scope="only",
        amounts=[
            {"category_id": str(groceries.id), "amount": "900"},
            {"category_id": str(restaurants.id), "amount": None},
        ],
    )

    assert stored_amounts(session, groceries) == {
        "2026-01": "500.00",
        "2026-12": "900.00",
        "2027-01": "500.00",
    }
    assert stored_budget(session, restaurants) is None


@pytest.mark.parametrize(
    "amounts",
    [
        [],
        [{"category_id": "not-an-id", "amount": "5"}],
        [{"category_id": "{groceries}", "amount": "-5"}],
        [{"category_id": "{groceries}"}],
        [
            {"category_id": "{groceries}", "amount": "5"},
            {"category_id": "{groceries}", "amount": "6"},
        ],
    ],
)
def test_plans_are_checked(
    admin_client: TestClient, categories: dict[str, Category], amounts: list[dict[str, Any]]
) -> None:
    for item in amounts:
        item["category_id"] = item["category_id"].format(groceries=categories["Groceries"].id)

    response = admin_client.put("/api/budget/months/2026-09", json={"amounts": amounts})

    assert response.status_code == 422


def test_a_plan_says_when_a_category_cant_be_budgeted(
    admin_client: TestClient, session: Session, categories: dict[str, Category]
) -> None:
    groceries = {"category_id": str(categories["Groceries"].id), "amount": "600"}

    missing = admin_client.put(
        "/api/budget/months/2026-09",
        json={"amounts": [groceries, {"category_id": str(uuid.uuid4()), "amount": "5"}]},
    )
    transfer = admin_client.put(
        "/api/budget/months/2026-09",
        json={
            "amounts": [
                groceries,
                {"category_id": str(categories["Credit card payments"].id), "amount": "5"},
            ]
        },
    )

    assert error(missing) == "not_found"
    assert error(transfer) == "transfer_category"
    assert stored_budget(session, categories["Groceries"]) is None
