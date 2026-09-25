"""Non-secret facts about this install, shown on the Settings tab to signed-in members."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app import __version__
from app.auth.deps import AppSettings, CurrentAuth

router = APIRouter(tags=["system"])


class PlaidStatus(BaseModel):
    configured: bool
    environment: Literal["sandbox", "production"]


class SystemInfo(BaseModel):
    version: str
    environment: str
    plaid: PlaidStatus


@router.get("/system", response_model=SystemInfo)
def system_info(auth: CurrentAuth, settings: AppSettings) -> SystemInfo:
    return SystemInfo(
        version=__version__,
        environment=settings.environment,
        plaid=PlaidStatus(configured=settings.plaid_configured, environment=settings.plaid_env),
    )
