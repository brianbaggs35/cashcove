"""Shared helpers for the API tests."""

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx2 as httpx
import pyotp
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import CSRF_HEADER
from app.auth.passwords import get_passwords
from app.config import Settings
from app.models import Role, User

SERVER_NAME = "cashcove.example.com"
ORIGIN = f"https://{SERVER_NAME}"
PASSWORD = "plum-orbit-lantern-42"


def add_user(
    session: Session,
    settings: Settings,
    *,
    email: str,
    name: str,
    role: Role = Role.ADMIN,
    password: str = PASSWORD,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        name=name,
        role=role,
        password_hash=get_passwords(settings).hash(password),
        is_active=is_active,
    )
    session.add(user)
    session.commit()
    return user


def use_session(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    """Sends the session's CSRF token from now on, like the web app does."""
    state: dict[str, Any] = body.get("state", body)
    client.headers[CSRF_HEADER] = state["session"]["csrf_token"]
    return body


def sign_in(
    client: TestClient, email: str, password: str = PASSWORD, *, remember: bool = False
) -> dict[str, Any]:
    response = client.post(
        "/api/auth/sign-in", json={"email": email, "password": password, "remember": remember}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return use_session(client, body) if body["status"] == "signed_in" else body


def totp_code(secret: str, steps_ahead: int = 0) -> str:
    """The code an authenticator app shows now, or that many 30-second steps later."""
    return pyotp.TOTP(secret).at(datetime.now(UTC) + timedelta(seconds=30 * steps_ahead))


def error(response: httpx.Response) -> str:
    """The machine-readable code of an API error."""
    detail: dict[str, Any] = response.json()["detail"]
    return str(detail["code"])
