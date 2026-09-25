"""Non-secret facts about this install, shown on the Settings tab."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import __version__
from app.config import Settings, get_settings

router = APIRouter(tags=["system"])


class PlaidStatus(BaseModel):
    configured: bool
    environment: Literal["sandbox", "production"]


class SystemInfo(BaseModel):
    version: str
    environment: str
    plaid: PlaidStatus


@router.get("/system", response_model=SystemInfo)
def system_info(settings: Annotated[Settings, Depends(get_settings)]) -> SystemInfo:
    return SystemInfo(
        version=__version__,
        environment=settings.environment,
        plaid=PlaidStatus(configured=settings.plaid_configured, environment=settings.plaid_env),
    )
