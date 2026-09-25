"""Read and update household preferences."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_session
from app.models.app_settings import SINGLETON_ID, AppSettings
from app.schemas.preferences import Preferences

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=Preferences)
def read_settings(session: Annotated[Session, Depends(get_session)]) -> Preferences:
    row = session.get(AppSettings, SINGLETON_ID)
    # Stored documents are merged over the defaults, so new fields appear without a migration.
    return Preferences.model_validate(row.data if row else {})


@router.put("", response_model=Preferences)
def update_settings(
    preferences: Preferences, session: Annotated[Session, Depends(get_session)]
) -> Preferences:
    row = session.get(AppSettings, SINGLETON_ID) or AppSettings(id=SINGLETON_ID)
    row.data = preferences.model_dump(mode="json")
    session.add(row)
    session.commit()
    return preferences
