"""The API with the end-to-end test harness mounted.

The e2e image serves it with ``uvicorn e2e.main:create_e2e_app --factory``.
"""

from fastapi import FastAPI
from pydantic import SecretStr

from app.config import Settings, get_settings
from app.main import create_app
from app.plaid.deps import plaid_transport
from e2e.api import router
from e2e.plaid import KEYS, FakePlaid


def create_e2e_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    # The harness can wipe the database, so it refuses to run anywhere but a test server.
    if settings.environment != "test":
        raise RuntimeError(
            "The end-to-end test harness only runs with CASHCOVE_ENVIRONMENT=test, because it "
            "can erase every account and all data."
        )
    # Plaid is the fake in e2e/plaid.py, with made-up keys, so connecting banks works offline.
    client_id, secret = KEYS
    settings = settings.model_copy(
        update={
            "plaid_env": "sandbox",
            "plaid_client_id": client_id,
            "plaid_secret": SecretStr(secret),
        }
    )
    app = create_app(settings)
    fake = FakePlaid()
    app.state.fake_plaid = fake
    app.dependency_overrides[plaid_transport] = lambda: fake.transport
    app.include_router(router, prefix="/api/e2e")
    return app
