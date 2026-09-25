"""HTTP API routers."""

from fastapi import APIRouter

from app.api import health, settings, system

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(settings.router)
api_router.include_router(system.router)

__all__ = ["api_router"]
