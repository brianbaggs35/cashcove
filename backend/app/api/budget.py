"""Budgets. Everyone can see them; only admins change them."""

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.auth.deps import AdminAuth, CurrentAuth, Db
from app.finance.budget import (
    add_source,
    budget_out,
    change_budget,
    create_budget,
    delete_budget,
    find_budget,
    history,
    link_transactions,
    list_budgets,
    period_view,
    remove_source,
    transactions_page,
    unlink_transaction,
)
from app.finance.exchange_rates import ExchangeRates
from app.models import BudgetKind
from app.models.base import utcnow
from app.schemas.budget import (
    MAX_HISTORY,
    BudgetCreate,
    BudgetHistory,
    BudgetLinkOut,
    BudgetOut,
    BudgetPeriodView,
    BudgetSourceIn,
    BudgetTransactionPage,
    BudgetUpdate,
    Day,
    TransactionsLink,
    TransactionsLinked,
)

router = APIRouter(prefix="/budgets", tags=["budgets"])

Today = Annotated[
    Day | None,
    Query(description="The date where the person is, which says which period they're in."),
]
On = Annotated[Day | None, Query(description="Any day in the period to look at.")]


def _today(today: dt.date | None) -> dt.date:
    return today or utcnow().date()


@router.get("")
def read_budgets(
    auth: CurrentAuth, db: Db, rates: ExchangeRates, today: Today = None
) -> list[BudgetOut]:
    """Every budget, by how often it repeats, with how the period it's in is going."""
    return list_budgets(db, rates, _today(today))


@router.post("", status_code=status.HTTP_201_CREATED)
def add_budget(body: BudgetCreate, auth: AdminAuth, db: Db, rates: ExchangeRates) -> BudgetOut:
    budget = create_budget(db, body)
    db.commit()
    return budget_out(db, rates, budget, _today(body.today))


@router.patch("/{budget_id}")
def update_budget(
    budget_id: uuid.UUID, body: BudgetUpdate, auth: AdminAuth, db: Db, rates: ExchangeRates
) -> BudgetOut:
    """Changes a budget. Leave a field out to keep it."""
    budget = find_budget(db, budget_id)
    change_budget(db, budget, body)
    db.commit()
    return budget_out(db, rates, budget, _today(body.today))


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_budget(budget_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Deletes a budget and what's linked to it. Nothing that counted toward it changes."""
    delete_budget(db, find_budget(db, budget_id))
    db.commit()


@router.get("/{budget_id}/period")
def read_period(
    budget_id: uuid.UUID,
    auth: CurrentAuth,
    db: Db,
    rates: ExchangeRates,
    on: On = None,
    today: Today = None,
) -> BudgetPeriodView:
    """How the budget is going in the period that `on` is in (today's, unless it says), or how
    it went: what came in, what went out, and what's left."""
    now = _today(today)
    return period_view(db, rates, find_budget(db, budget_id), on or now, now)


@router.get("/{budget_id}/history")
def read_history(
    budget_id: uuid.UUID,
    auth: CurrentAuth,
    db: Db,
    rates: ExchangeRates,
    on: On = None,
    today: Today = None,
    count: Annotated[int, Query(ge=1, le=MAX_HISTORY)] = 12,
) -> BudgetHistory:
    """What the budget came to in each of its latest periods up to the one `on` is in."""
    now = _today(today)
    return history(db, rates, find_budget(db, budget_id), on or now, now, count)


@router.get("/{budget_id}/transactions")
def read_transactions(
    budget_id: uuid.UUID,
    auth: CurrentAuth,
    db: Db,
    on: On = None,
    today: Today = None,
    kind: Annotated[BudgetKind | None, Query(description="Only income or only spending.")] = None,
    removed: Annotated[
        bool, Query(description="The ones taken off that would otherwise count.")
    ] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> BudgetTransactionPage:
    """The transactions that count toward the budget in a period, newest first."""
    return transactions_page(
        db,
        find_budget(db, budget_id),
        on or _today(today),
        kind=kind,
        removed=removed,
        page=page,
        page_size=page_size,
    )


@router.post("/{budget_id}/transactions")
def link(
    budget_id: uuid.UUID, body: TransactionsLink, auth: AdminAuth, db: Db
) -> TransactionsLinked:
    """Counts transactions toward the budget, as income or as spending. Ones that were taken
    off are put back."""
    count = link_transactions(db, find_budget(db, budget_id), body.ids, body.kind)
    db.commit()
    return TransactionsLinked(count=count)


@router.delete("/{budget_id}/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink(budget_id: uuid.UUID, transaction_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Takes a transaction off the budget, even when an account, a category, a subscription or
    an automation counts it. Nothing about the transaction itself changes."""
    unlink_transaction(db, find_budget(db, budget_id), transaction_id)
    db.commit()


@router.post("/{budget_id}/sources", status_code=status.HTTP_201_CREATED)
def add_budget_source(
    budget_id: uuid.UUID, body: BudgetSourceIn, auth: AdminAuth, db: Db
) -> BudgetLinkOut:
    """Counts an account, a category, a subscription or an automation toward the budget."""
    source = add_source(db, find_budget(db, budget_id), body)
    db.commit()
    return source


@router.delete("/{budget_id}/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_budget_source(
    budget_id: uuid.UUID, source_id: uuid.UUID, auth: AdminAuth, db: Db
) -> None:
    """Stops counting an account, a category, a subscription or an automation toward the
    budget."""
    remove_source(db, find_budget(db, budget_id), source_id)
    db.commit()
