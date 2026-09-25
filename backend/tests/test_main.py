from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app as module_app
from app.main import create_app


def test_docs_enabled_when_configured(client: TestClient) -> None:
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/openapi.json").json()["info"]["title"] == "Cashcove API"


def test_docs_disabled_by_default() -> None:
    client = TestClient(create_app(Settings(database_url="sqlite://")))
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_module_level_app_is_built_from_environment_settings() -> None:
    assert module_app.title == "Cashcove API"
