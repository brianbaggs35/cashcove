"""HTTP API routers."""

from fastapi import APIRouter, Depends

from app.api import account, auth, health, settings, system, users
from app.auth.deps import verify_origin

# Every state-changing request must come from Cashcove's own pages.
api_router = APIRouter(dependencies=[Depends(verify_origin)])
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(account.router)
api_router.include_router(users.router)
api_router.include_router(settings.router)
api_router.include_router(system.router)

__all__ = ["api_router"]
