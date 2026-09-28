"""Budgets. Everyone can see them; only admins change them."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.auth.deps import AdminAuth, CurrentAuth, Db
from app.finance.budget import (
    budget_month,
    budget_year,
    category_history,
    change_budget,
    plan_budget,
)
from app.schemas.budget import (
    BudgetChange,
    BudgetMonth,
    BudgetPlan,
    BudgetYear,
    CategoryHistory,
    Month,
    Year,
)

router = APIRouter(prefix="/budget", tags=["budget"])

MonthPath = Annotated[Month, Path(description="The month, like 2026-09.")]


@router.get("/months/{month}")
def read_month(month: MonthPath, auth: CurrentAuth, db: Db) -> BudgetMonth:
    """Every income and spending category's budget for the month, and what came in or went
    out."""
    return budget_month(db, month)


@router.put("/months/{month}")
def plan_month(month: MonthPath, body: BudgetPlan, auth: AdminAuth, db: Db) -> BudgetMonth:
    """Budgets several categories from the month on, or for the month only."""
    plan_budget(db, month, body)
    db.commit()
    return budget_month(db, month)


@router.get("/years/{year}")
def read_year(
    year: Annotated[Year, Path(description="The year the budget year starts in.")],
    auth: CurrentAuth,
    db: Db,
) -> BudgetYear:
    """The budget year that starts in `year`, month by month."""
    return budget_year(db, year)


@router.get("/categories/{category_id}/history")
def read_history(
    category_id: uuid.UUID,
    month: Annotated[Month, Query(description="The last month, like 2026-09.")],
    auth: CurrentAuth,
    db: Db,
) -> CategoryHistory:
    """What a category's budget was and what it came to, in each of the twelve months up to
    and including `month`."""
    return category_history(db, category_id, month)


@router.put("/categories/{category_id}")
def budget_category(
    category_id: uuid.UUID, body: BudgetChange, auth: AdminAuth, db: Db
) -> BudgetMonth:
    """Sets, changes or stops a category's budget. Returns the month it was changed from."""
    change_budget(db, category_id, body)
    db.commit()
    return budget_month(db, body.month)
