from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import __version__
from app.config import Settings
from tests.helpers import error


def test_needs_a_signed_in_member(client: TestClient) -> None:
    response = client.get("/api/system")
    assert response.status_code == 401
    assert error(response) == "not_signed_in"


def test_reports_unconfigured_plaid(viewer_client: TestClient) -> None:
    assert viewer_client.get("/api/system").json() == {
        "version": __version__,
        "environment": "test",
        "plaid": {"configured": False, "environment": "sandbox"},
    }


def test_reports_configured_plaid_without_leaking_secrets(
    admin_client: TestClient, settings: Settings
) -> None:
    settings.plaid_env = "production"
    settings.plaid_client_id = "client-id"
    settings.plaid_secret = SecretStr("super-secret")
    response = admin_client.get("/api/system")
    assert response.json()["plaid"] == {"configured": True, "environment": "production"}
    assert "super-secret" not in response.text
    assert "client-id" not in response.text
