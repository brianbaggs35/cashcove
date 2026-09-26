"""HTTP API routers."""

from fastapi import APIRouter, Depends

from app.api import (
    account,
    accounts,
    auth,
    categories,
    health,
    settings,
    system,
    transactions,
    users,
)
from app.auth.deps import verify_origin

# Every state-changing request must come from Cashcove's own pages.
api_router = APIRouter(dependencies=[Depends(verify_origin)])
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(account.router)
api_router.include_router(users.router)
api_router.include_router(settings.router)
api_router.include_router(system.router)
api_router.include_router(accounts.router)
api_router.include_router(transactions.router)
api_router.include_router(categories.router)

__all__ = ["api_router"]
