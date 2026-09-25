"""The API with the end-to-end test harness mounted.

The e2e image serves it with ``uvicorn e2e.main:create_e2e_app --factory``.
"""

from fastapi import FastAPI

from app.config import Settings, get_settings
from app.main import create_app
from e2e.api import router


def create_e2e_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    # The harness can wipe the database, so it refuses to run anywhere but a test server.
    if settings.environment != "test":
        raise RuntimeError(
            "The end-to-end test harness only runs with CASHCOVE_ENVIRONMENT=test, because it "
            "can erase every account and all data."
        )
    app = create_app(settings)
    app.include_router(router, prefix="/api/e2e")
    return app
