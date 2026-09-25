from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import __version__
from app.config import Settings
from app.main import create_app


def test_reports_unconfigured_plaid(client: TestClient) -> None:
    assert client.get("/api/system").json() == {
        "version": __version__,
        "environment": "test",
        "plaid": {"configured": False, "environment": "sandbox"},
    }


def test_reports_configured_plaid_without_leaking_secrets() -> None:
    settings = Settings(
        database_url="sqlite://",
        plaid_env="production",
        plaid_client_id="client-id",
        plaid_secret=SecretStr("super-secret"),
    )
    app: FastAPI = create_app(settings)
    response = TestClient(app).get("/api/system")
    assert response.json()["plaid"] == {"configured": True, "environment": "production"}
    assert "super-secret" not in response.text
    assert "client-id" not in response.text
