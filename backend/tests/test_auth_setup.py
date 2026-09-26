from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import setup
from app.auth.sessions import SESSION_COOKIE
from app.models import AuditEvent, AuthChallenge, Role, User, UserSession
from app.models.base import utcnow
from tests.helpers import ORIGIN, PASSWORD, error, use_session


def issue(session: Session) -> str:
    code = setup.issue_code(session, utcnow())
    session.commit()
    return code


def setup_body(code: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "setup_code": code,
        "name": "  Alex Rivera ",
        "email": "Alex@Example.com",
        "password": PASSWORD,
    }
    return body | overrides


def test_a_fresh_install_asks_for_setup(client: TestClient) -> None:
    assert client.get("/api/auth/session").json() == {
        "setup_required": True,
        "user": None,
        "session": None,
        "origin": ORIGIN,
        "passkeys_supported": True,
    }


def test_setup_creates_the_first_admin_and_signs_them_in(
    client: TestClient, session: Session
) -> None:
    code = issue(session)
    # Codes are accepted however they're typed.
    typed = code.upper().replace("-", " ")
    assert client.post("/api/auth/setup/check", json={"setup_code": typed}).status_code == 204

    response = client.post("/api/auth/setup", json=setup_body(code))

    assert response.status_code == 201
    state = response.json()
    assert state["setup_required"] is False
    assert state["user"]["email"] == "alex@example.com"
    assert state["user"]["name"] == "Alex Rivera"
    assert state["user"]["role"] == "admin"
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    for attribute in ("HttpOnly", "Path=/", "SameSite=strict", "Secure"):
        assert attribute in cookie
    # Not "remembered", so the cookie ends with the browser session.
    assert "Max-Age" not in cookie
    # The code can't be used again.
    assert session.scalar(select(AuthChallenge)) is None
    assert session.scalars(select(AuditEvent.event)).all() == ["setup_completed"]

    use_session(client, state)
    again = client.get("/api/auth/session").json()
    assert again["user"]["id"] == state["user"]["id"]
    assert again["session"]["idle_timeout_seconds"] == 3600
    assert again["session"]["remember"] is False


def test_setup_starts_the_household_with_the_suggested_categories(
    client: TestClient, session: Session
) -> None:
    code = issue(session)

    use_session(client, client.post("/api/auth/setup", json=setup_body(code)).json())

    groups = client.get("/api/categories").json()
    assert [group["name"] for group in groups] == [
        "Income",
        "Bills & utilities",
        "Family & education",
        "Financial",
        "Food & drink",
        "Health & wellness",
        "Housing",
        "Lifestyle",
        "Shopping",
        "Transportation",
        "Transfers",
    ]
    assert sum(len(group["categories"]) for group in groups) == 37


def test_a_wrong_setup_code_is_refused_and_guessing_is_slowed(
    client: TestClient, session: Session
) -> None:
    issue(session)
    for _ in range(11):
        response = client.post("/api/auth/setup/check", json={"setup_code": "wrong"})
        assert response.status_code == 403
        assert error(response) == "invalid_setup_code"
    locked = client.post("/api/auth/setup/check", json={"setup_code": "wrong"})
    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) > 0


def test_setup_with_a_wrong_code_creates_nothing(client: TestClient, session: Session) -> None:
    issue(session)
    response = client.post("/api/auth/setup", json=setup_body("abcd-efgh-jkmn"))
    assert response.status_code == 403
    assert error(response) == "invalid_setup_code"
    assert session.scalar(select(User)) is None


def test_a_weak_password_keeps_the_code_usable(client: TestClient, session: Session) -> None:
    code = issue(session)
    response = client.post("/api/auth/setup", json=setup_body(code, password="alexrivera12"))
    assert response.status_code == 422
    assert error(response) == "weak_password"
    assert setup.code_is_valid(session, code, utcnow())


def test_an_expired_code_is_refused(client: TestClient, session: Session) -> None:
    code = issue(session)
    challenge = session.scalars(select(AuthChallenge)).one()
    challenge.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()
    assert client.post("/api/auth/setup/check", json={"setup_code": code}).status_code == 403


def test_a_new_code_replaces_the_old_one(client: TestClient, session: Session) -> None:
    old = issue(session)
    new = issue(session)
    assert client.post("/api/auth/setup/check", json={"setup_code": old}).status_code == 403
    assert client.post("/api/auth/setup/check", json={"setup_code": new}).status_code == 204


def test_setup_happens_only_once(client: TestClient, session: Session, admin: User) -> None:
    code = issue(session)
    check = client.post("/api/auth/setup/check", json={"setup_code": code})
    assert check.status_code == 409
    assert error(check) == "already_set_up"
    assert client.post("/api/auth/setup", json=setup_body(code)).status_code == 409
    assert client.get("/api/auth/session").json()["setup_required"] is False
    assert session.scalars(select(User.role)).all() == [Role.ADMIN]


def test_a_cookie_for_an_ended_session_is_cleared(
    admin_client: TestClient, session: Session
) -> None:
    session.query(UserSession).delete()
    session.commit()
    response = admin_client.get("/api/auth/session")
    assert response.json()["user"] is None
    assert f'{SESSION_COOKIE}=""' in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_loading_the_app_counts_as_activity(admin_client: TestClient, session: Session) -> None:
    row = session.scalars(select(UserSession)).one()
    row.last_seen_at = utcnow() - timedelta(minutes=30)
    session.commit()
    admin_client.get("/api/auth/session")
    session.refresh(row)
    assert utcnow() - row.last_seen_at < timedelta(minutes=1)
