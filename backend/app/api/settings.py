"""Read and update household preferences: every member can read them, admins change them."""

from fastapi import APIRouter

from app.auth.deps import AdminAuth, CurrentAuth, Db
from app.auth.service import load_preferences
from app.models.app_settings import SINGLETON_ID, AppSettings
from app.schemas.preferences import Preferences

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def read_settings(auth: CurrentAuth, db: Db) -> Preferences:
    return load_preferences(db)


@router.put("")
def update_settings(preferences: Preferences, auth: AdminAuth, db: Db) -> Preferences:
    row = db.get(AppSettings, SINGLETON_ID) or AppSettings(id=SINGLETON_ID)
    row.data = preferences.model_dump(mode="json")
    db.add(row)
    db.commit()
    return preferences
