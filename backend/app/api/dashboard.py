"""The dashboard: how the household is doing. Everyone can see it; nothing here changes anything."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.auth.deps import CurrentAuth, Db
from app.finance.dashboard import dashboard
from app.finance.exchange_rates import ExchangeRates
from app.models.base import utcnow
from app.schemas.budget import Day
from app.schemas.dashboard import DashboardOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
def read_dashboard(
    auth: CurrentAuth,
    db: Db,
    rates: ExchangeRates,
    today: Annotated[
        Day | None,
        Query(description="The date where the person is, which says which month they're in."),
    ] = None,
) -> DashboardOut:
    """What came in and what was spent this month and over the months before, where the money
    went this month, and how many transactions still have no category."""
    return dashboard(db, rates, today or utcnow().date())
