"""Budgets. Everyone can see them; only admins change them."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.auth.deps import AdminAuth, CurrentAuth, Db
from app.finance.budget import (
    budget_configurations,
    budget_month,
    budget_year,
    category_history,
    change_budget,
    delete_budget,
    link_budget_subscription,
    link_budget_transaction,
    plan_budget,
    unlink_budget_subscription,
    unlink_budget_transaction,
)
from app.finance.exchange_rates import ExchangeRates
from app.schemas.budget import (
    BudgetChange,
    BudgetConfiguration,
    BudgetMonth,
    BudgetPlan,
    BudgetYear,
    CategoryHistory,
    Month,
    Year,
)

router = APIRouter(prefix="/budget", tags=["budget"])

MonthPath = Annotated[Month, Path(description="The month, like 2026-09.")]


@router.get("/configurations")
def read_configurations(
    month: Annotated[Month, Query(description="The month being configured, like 2026-09.")],
    auth: CurrentAuth,
    db: Db,
) -> list[BudgetConfiguration]:
    """Every category budget's settings and linked transactions for the requested month."""
    return budget_configurations(db, month)


@router.get("/months/{month}")
def read_month(month: MonthPath, auth: CurrentAuth, db: Db, rates: ExchangeRates) -> BudgetMonth:
    """Every income and spending category's budget for the month, and what came in or went
    out."""
    return budget_month(db, month, rates)


@router.put("/months/{month}")
def plan_month(
    month: MonthPath, body: BudgetPlan, auth: AdminAuth, db: Db, rates: ExchangeRates
) -> BudgetMonth:
    """Budgets several categories from the month on, or for the month only."""
    plan_budget(db, month, body)
    db.commit()
    return budget_month(db, month, rates)


@router.get("/years/{year}")
def read_year(
    year: Annotated[Year, Path(description="The year the budget year starts in.")],
    auth: CurrentAuth,
    db: Db,
    rates: ExchangeRates,
) -> BudgetYear:
    """The budget year that starts in `year`, month by month."""
    return budget_year(db, year, rates)


@router.get("/categories/{category_id}/history")
def read_history(
    category_id: uuid.UUID,
    month: Annotated[Month, Query(description="The last month, like 2026-09.")],
    auth: CurrentAuth,
    db: Db,
    rates: ExchangeRates,
) -> CategoryHistory:
    """What a category's budget was and what it came to, in each of the twelve months up to
    and including `month`."""
    return category_history(db, category_id, month, rates)


@router.put("/categories/{category_id}")
def budget_category(
    category_id: uuid.UUID, body: BudgetChange, auth: AdminAuth, db: Db, rates: ExchangeRates
) -> BudgetMonth:
    """Sets, changes or stops a category's budget. Returns the month it was changed from."""
    change_budget(db, category_id, body)
    db.commit()
    return budget_month(db, body.month, rates)


@router.delete("/categories/{category_id}", status_code=204)
def remove_budget(category_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Removes this category's complete budget history and its links."""
    delete_budget(db, category_id)
    db.commit()


@router.put(
    "/categories/{category_id}/transactions/{transaction_id}",
    status_code=204,
)
def link_transaction(
    category_id: uuid.UUID,
    transaction_id: uuid.UUID,
    auth: AdminAuth,
    db: Db,
) -> None:
    """Links an income or spending transaction directly to this category's budget."""
    link_budget_transaction(db, category_id, transaction_id)
    db.commit()


@router.delete(
    "/categories/{category_id}/transactions/{transaction_id}",
    status_code=204,
)
def unlink_transaction(
    category_id: uuid.UUID,
    transaction_id: uuid.UUID,
    auth: AdminAuth,
    db: Db,
) -> None:
    """Removes a transaction's direct budget link without changing its category."""
    unlink_budget_transaction(db, category_id, transaction_id)
    db.commit()


@router.put(
    "/categories/{category_id}/subscriptions/{subscription_id}",
    status_code=204,
)
def link_subscription(
    category_id: uuid.UUID,
    subscription_id: uuid.UUID,
    auth: AdminAuth,
    db: Db,
) -> None:
    """Links a recurring bill to this spending budget and routes its payments there."""
    link_budget_subscription(db, category_id, subscription_id)
    db.commit()


@router.delete(
    "/categories/{category_id}/subscriptions/{subscription_id}",
    status_code=204,
)
def unlink_subscription(
    category_id: uuid.UUID,
    subscription_id: uuid.UUID,
    auth: AdminAuth,
    db: Db,
) -> None:
    """Removes a recurring bill from the budget without changing the subscription."""
    unlink_budget_subscription(db, category_id, subscription_id)
    db.commit()
