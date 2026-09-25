from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AppSettings
from app.schemas.preferences import Preferences
from tests.helpers import error


def defaults() -> dict[str, Any]:
    return Preferences().model_dump(mode="json")


def test_returns_defaults_before_anything_is_saved(viewer_client: TestClient) -> None:
    response = viewer_client.get("/api/settings")
    assert response.status_code == 200
    body = response.json()
    assert body == defaults()
    assert body["sync"] == {"auto_sync": True, "interval_hours": 6, "history_days": 730}
    assert body["alerts"]["low_balance_threshold"] == "100.00"


def test_saves_and_reads_back_preferences(admin_client: TestClient, session: Session) -> None:
    client = admin_client
    updated = defaults()
    updated["general"]["household_name"] = "The Coves"
    updated["sync"]["interval_hours"] = 12
    updated["alerts"]["large_transaction_threshold"] = "250.50"

    response = client.put("/api/settings", json=updated)
    assert response.status_code == 200
    assert response.json() == updated
    assert client.get("/api/settings").json() == updated

    # A second save updates the same row.
    updated["sync"]["auto_sync"] = False
    assert client.put("/api/settings", json=updated).json()["sync"]["auto_sync"] is False
    assert session.query(AppSettings).count() == 1


def test_stored_documents_gain_new_defaults(admin_client: TestClient, session: Session) -> None:
    session.add(AppSettings(id=1, data={"general": {"household_name": "Older install"}}))
    session.commit()
    body = admin_client.get("/api/settings").json()
    assert body["general"]["household_name"] == "Older install"
    assert body["general"]["currency"] == "USD"
    assert body["sync"] == defaults()["sync"]


def test_rejects_invalid_values(admin_client: TestClient) -> None:
    for section, field, value in [
        ("sync", "interval_hours", 3),
        ("general", "currency", "usd"),
        ("general", "fiscal_year_start_month", 13),
        ("alerts", "low_balance_threshold", "-5"),
        ("alerts", "budget_threshold_percent", 200),
    ]:
        payload = defaults()
        payload[section][field] = value
        assert admin_client.put("/api/settings", json=payload).status_code == 422, field


def test_rejects_unknown_fields(admin_client: TestClient) -> None:
    payload = defaults()
    payload["sync"]["webhook_url"] = "http://example.com"
    assert admin_client.put("/api/settings", json=payload).status_code == 422


def test_viewers_can_read_but_not_change_preferences(viewer_client: TestClient) -> None:
    assert viewer_client.get("/api/settings").status_code == 200
    response = viewer_client.put("/api/settings", json=defaults())
    assert response.status_code == 403
    assert error(response) == "admin_only"


def test_signed_out_visitors_see_nothing(client: TestClient) -> None:
    assert client.get("/api/settings").status_code == 401
    assert client.put("/api/settings", json=defaults()).status_code == 401
