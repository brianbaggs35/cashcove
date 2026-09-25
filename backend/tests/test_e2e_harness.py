"""The end-to-end tests' harness: the baseline, resetting to it, and signing in without the form."""

import base64
import uuid
from collections.abc import Iterator
from pathlib import Path

import coverage
import pytest
from coverage.data import CoverageData
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import tokens
from app.auth.service import load_preferences, totp_box
from app.config import Settings, get_settings
from app.db import get_session
from app.models import AuditEvent, Invitation, RecoveryCode, User, UserSession
from e2e.api import current_coverage
from e2e.main import create_e2e_app
from tests.helpers import ORIGIN, add_user, error, sign_in, totp_code

BASELINE_EMAILS = {"alex@example.com", "jordan@example.com", "sam@example.com", "casey@example.com"}


@pytest.fixture
def harness(settings: Settings, session: Session) -> FastAPI:
    def request_session() -> Iterator[Session]:
        try:
            yield session
        finally:
            session.rollback()

    app = create_e2e_app(settings)
    app.dependency_overrides[get_session] = request_session
    return app


@pytest.fixture
def e2e(harness: FastAPI) -> Iterator[TestClient]:
    with TestClient(harness, base_url=ORIGIN) as client:
        yield client


def count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_the_harness_refuses_to_run_outside_a_test_server(settings: Settings) -> None:
    with pytest.raises(RuntimeError, match="CASHCOVE_ENVIRONMENT=test"):
        create_e2e_app(settings.model_copy(update={"environment": "production"}))


def test_the_harness_reads_its_settings_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # As the e2e image starts it: uvicorn e2e.main:create_e2e_app --factory
    monkeypatch.setenv("CASHCOVE_ENVIRONMENT", "test")
    get_settings.cache_clear()
    try:
        app = create_e2e_app()
    finally:
        get_settings.cache_clear()
    assert app.url_path_for("reset_to_baseline") == "/api/e2e/reset"


def test_reset_replaces_everything_with_the_baseline(
    e2e: TestClient, session: Session, settings: Settings
) -> None:
    stranger = add_user(session, settings, email="stranger@example.com", name="Pat Stranger")
    sign_in(e2e, stranger.email)
    assert count(session, UserSession) == 1

    response = e2e.post("/api/e2e/reset")

    assert response.status_code == 200
    assert set(session.scalars(select(User.email))) == BASELINE_EMAILS
    # Sessions, sign-in history and lockouts from earlier tests are gone.
    assert count(session, UserSession) == 0
    assert count(session, AuditEvent) == 0
    assert response.json() == e2e.get("/api/e2e/baseline").json()


def test_the_baseline_is_a_household_with_admins_a_viewer_and_a_turned_off_account(
    e2e: TestClient, session: Session, settings: Settings
) -> None:
    baseline = e2e.post("/api/e2e/reset").json()

    assert baseline["household_name"] == "The Rivera household"
    assert load_preferences(session).general.household_name == "The Rivera household"
    expected = {
        "admin": ("Alex Rivera", "admin", True),
        "two_step": ("Jordan Rivera", "admin", True),
        "viewer": ("Sam Rivera", "viewer", True),
        "deactivated": ("Casey Rivera", "viewer", False),
    }
    assert set(baseline["users"]) == set(expected)
    for key, (name, role, active) in expected.items():
        described = baseline["users"][key]
        stored = session.get(User, uuid.UUID(described["id"]))
        assert stored is not None
        assert (stored.name, stored.role.value, stored.is_active) == (name, role, active)
        assert (described["name"], described["role"], described["is_active"]) == (
            name,
            role,
            active,
        )
        assert stored.email == described["email"]
    # Newest members joined last, so lists have a stable order.
    joined = sorted(session.scalars(select(User)), key=lambda user: user.created_at)
    assert [user.name for user in joined] == [
        "Alex Rivera",
        "Jordan Rivera",
        "Sam Rivera",
        "Casey Rivera",
    ]
    jordan = baseline["users"]["two_step"]
    stored_jordan = session.get(User, uuid.UUID(jordan["id"]))
    assert stored_jordan is not None and stored_jordan.totp_secret is not None
    assert totp_box(settings).decrypt(stored_jordan.totp_secret) == jordan["totp_secret"]
    assert len(jordan["recovery_codes"]) == count(session, RecoveryCode) == 10
    for key in ("admin", "viewer", "deactivated"):
        assert baseline["users"][key]["totp_secret"] is None
        assert baseline["users"][key]["recovery_codes"] == []


def test_baseline_accounts_sign_in_with_the_baseline_password(e2e: TestClient) -> None:
    users = e2e.post("/api/e2e/reset").json()["users"]

    for key in ("admin", "viewer"):
        user = users[key]
        result = sign_in(e2e, user["email"], user["password"])
        assert result["state"]["user"]["email"] == user["email"]

    casey = users["deactivated"]
    response = e2e.post(
        "/api/auth/sign-in", json={"email": casey["email"], "password": casey["password"]}
    )
    assert error(response) == "account_disabled"


def test_the_two_step_account_takes_its_codes(e2e: TestClient) -> None:
    jordan = e2e.post("/api/e2e/reset").json()["users"]["two_step"]

    assert sign_in(e2e, jordan["email"], jordan["password"])["status"] == "two_factor_required"
    response = e2e.post("/api/auth/sign-in/totp", json={"code": totp_code(jordan["totp_secret"])})
    assert response.json()["status"] == "signed_in"

    assert sign_in(e2e, jordan["email"], jordan["password"])["status"] == "two_factor_required"
    response = e2e.post(
        "/api/auth/sign-in/recovery-code", json={"code": jordan["recovery_codes"][0]}
    )
    assert response.json()["status"] == "signed_in"


def test_the_pending_invitation_opens_from_its_link(e2e: TestClient, session: Session) -> None:
    invitation = e2e.post("/api/e2e/reset").json()["invitations"]["pending"]

    assert invitation["link"] == f"{ORIGIN}/invite#{invitation['token']}"
    preview = e2e.post("/api/auth/invitations/preview", json={"token": invitation["token"]})
    assert preview.status_code == 200
    assert preview.json()["email"] == invitation["email"] == "riley@example.com"
    assert preview.json()["invited_by"] == "Alex Rivera"
    assert preview.json()["household_name"] == "The Rivera household"
    stored = session.get(Invitation, uuid.UUID(invitation["id"]))
    assert stored is not None
    assert (stored.expires_at - stored.created_at).days == 7


def test_resets_reuse_the_hashed_password(e2e: TestClient, session: Session) -> None:
    hashes: list[str | None] = []
    for _ in range(2):
        e2e.post("/api/e2e/reset")
        hashes.append(
            session.scalar(select(User.password_hash).where(User.email == "alex@example.com"))
        )
    assert hashes[0] is not None
    assert hashes[0] == hashes[1]


def test_a_fresh_install_empties_the_database_and_offers_a_setup_code(
    e2e: TestClient, session: Session
) -> None:
    e2e.post("/api/e2e/reset")

    code = e2e.post("/api/e2e/fresh-install").json()["setup_code"]

    assert count(session, User) == 0
    assert e2e.get("/api/auth/session").json()["setup_required"] is True
    assert e2e.post("/api/auth/setup/check", json={"setup_code": code}).status_code == 204


def test_sessions_sign_a_browser_in_without_the_form(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    response = e2e.post("/api/e2e/sessions", json={"email": "Sam@Example.com"})

    assert response.status_code == 200
    state = response.json()
    assert state["user"]["email"] == "sam@example.com"
    assert state["session"]["remember"] is False
    assert state["session"]["csrf_token"]
    # The cookie it set is what signs the browser in.
    assert e2e.get("/api/auth/session").json()["user"]["role"] == "viewer"


def test_sessions_can_be_remembered(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    state = e2e.post("/api/e2e/sessions", json={"email": "alex@example.com", "remember": True})

    assert state.json()["session"]["remember"] is True


def test_sessions_need_an_account_that_is_on(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    assert error(e2e.post("/api/e2e/sessions", json={"email": "nobody@example.com"})) == (
        "not_found"
    )
    assert error(e2e.post("/api/e2e/sessions", json={"email": "casey@example.com"})) == (
        "account_disabled"
    )


def test_coverage_is_the_measurement_the_api_runs_under() -> None:
    assert current_coverage() is coverage.Coverage.current()


def test_coverage_needs_the_api_to_run_under_it(e2e: TestClient, harness: FastAPI) -> None:
    harness.dependency_overrides[current_coverage] = lambda: None

    assert error(e2e.get("/api/e2e/coverage")) == "coverage_off"


def test_coverage_comes_back_as_an_html_report_and_lcov(
    e2e: TestClient, harness: FastAPI, tmp_path: Path
) -> None:
    # Coverage data for part of one module, as if the API had run it.
    data_file = tmp_path / ".coverage"
    data = CoverageData(basename=str(data_file))
    data.add_lines({str(Path(tokens.__file__).resolve()): [3, 4, 5, 11, 12]})
    data.write()
    measurement = coverage.Coverage(data_file=str(data_file), config_file=False)
    measurement.load()
    harness.dependency_overrides[current_coverage] = lambda: measurement

    response = e2e.get("/api/e2e/coverage")

    assert response.status_code == 200
    report = response.json()
    files = {entry["path"]: base64.b64decode(entry["content"]) for entry in report["files"]}
    assert "html/index.html" in files
    assert b"tokens.py" in files["lcov.info"]
    assert 0 < report["percent_covered"] < 100
