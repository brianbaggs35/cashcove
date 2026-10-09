"""Alert-channel settings and connection tests."""

from fastapi import APIRouter

from app.alerts import service
from app.auth.deps import AdminAuth, AppSettings, CurrentAuth, Db
from app.schemas.alerts import AlertSettingsOut, AlertSettingsPatch, AlertTestOut

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/settings")
def read_settings(auth: CurrentAuth, db: Db, settings: AppSettings) -> AlertSettingsOut:
    return service.settings_out(db, settings)


@router.patch("/settings")
def update_settings(
    body: AlertSettingsPatch, auth: AdminAuth, db: Db, settings: AppSettings
) -> AlertSettingsOut:
    return service.save_settings(db, settings, body, auth.user.id)


@router.post("/smtp/test")
async def test_smtp(
    body: AlertSettingsPatch, auth: AdminAuth, db: Db, settings: AppSettings
) -> AlertTestOut:
    return await service.test_smtp(db, settings, body)


@router.post("/discord/test")
async def test_discord(
    body: AlertSettingsPatch, auth: AdminAuth, db: Db, settings: AppSettings
) -> AlertTestOut:
    return await service.test_discord(db, settings, body)
