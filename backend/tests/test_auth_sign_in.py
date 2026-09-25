from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import CSRF_HEADER
from app.auth.passwords import Passwords
from app.auth.service import _wait_message  # pyright: ignore[reportPrivateUsage]
from app.auth.sessions import SESSION_COOKIE
from app.config import Settings
from app.models import AuditEvent, LoginThrottle, User, UserSession
from app.models.base import utcnow
from tests.helpers import ORIGIN, PASSWORD, add_user, error, sign_in


def test_signing_in_with_a_password(client: TestClient, session: Session, admin: User) -> None:
    body = sign_in(client, "  ALEX@example.com ")

    assert body["status"] == "signed_in"
    assert body["methods"] == []
    state = body["state"]
    assert state["user"]["id"] == str(admin.id)
    assert state["user"]["passkey_count"] == 0
    assert state["session"]["remember"] is False
    session.refresh(admin)
    assert admin.last_sign_in_at is not None
    event = session.scalars(select(AuditEvent)).one()
    assert (event.event, event.user_id, event.details) == (
        "signed_in",
        admin.id,
        {"method": "password", "remember": False},
    )
    assert event.ip_address == "testclient"
    assert client.get("/api/auth/session").json()["user"]["email"] == admin.email


def test_keep_me_signed_in_uses_a_lasting_cookie(client: TestClient, admin: User) -> None:
    response = client.post(
        "/api/auth/sign-in", json={"email": admin.email, "password": PASSWORD, "remember": True}
    )
    assert "Max-Age=2592000" in response.headers["set-cookie"]
    session = response.json()["state"]["session"]
    assert session["remember"] is True
    assert session["idle_timeout_seconds"] == 14 * 24 * 3600


def test_wrong_passwords_and_unknown_emails_get_the_same_answer(
    client: TestClient, session: Session, admin: User
) -> None:
    wrong = client.post("/api/auth/sign-in", json={"email": admin.email, "password": "nope"})
    unknown = client.post(
        "/api/auth/sign-in", json={"email": "nobody@example.com", "password": PASSWORD}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert error(wrong) == "invalid_credentials"
    failures = session.scalars(select(AuditEvent).order_by(AuditEvent.created_at)).all()
    assert [(event.event, event.user_id) for event in failures] == [
        ("sign_in_failed", admin.id),
        ("sign_in_failed", None),
    ]
    # Nothing about the attempted email is kept for unknown accounts.
    assert failures[1].details == {"method": "password"}


def test_repeated_failures_lock_the_account_for_a_while(
    client: TestClient, session: Session, admin: User
) -> None:
    for _ in range(6):
        attempt = client.post("/api/auth/sign-in", json={"email": admin.email, "password": "x"})
        assert attempt.status_code == 401
    locked = client.post("/api/auth/sign-in", json={"email": admin.email, "password": PASSWORD})
    assert locked.status_code == 429
    assert error(locked) == "too_many_attempts"
    assert locked.json()["detail"]["retry_after"] == int(locked.headers["retry-after"])
    assert "Try again in" in locked.json()["detail"]["message"]

    # Once the lock runs out, the right password works and the count starts over.
    row = session.get(LoginThrottle, "email:alex@example.com")
    assert row is not None
    row.locked_until = utcnow() - timedelta(seconds=1)
    session.commit()
    sign_in(client, admin.email)
    assert session.get(LoginThrottle, "email:alex@example.com") is None
    # The address's count isn't reset by a success, so one account can't clear it for others.
    assert session.get(LoginThrottle, "ip:testclient") is not None


@pytest.mark.parametrize(
    ("seconds", "message"),
    [(31, "31 seconds"), (60, "1 minute"), (61, "2 minutes"), (900, "15 minutes")],
)
def test_lock_messages_read_naturally(seconds: int, message: str) -> None:
    assert _wait_message(seconds) == message


def test_turned_off_accounts_cannot_sign_in(
    client: TestClient, session: Session, settings: Settings
) -> None:
    add_user(session, settings, email="jo@example.com", name="Jo", is_active=False)
    wrong = client.post("/api/auth/sign-in", json={"email": "jo@example.com", "password": "x"})
    assert error(wrong) == "invalid_credentials"
    right = client.post("/api/auth/sign-in", json={"email": "jo@example.com", "password": PASSWORD})
    assert right.status_code == 403
    assert error(right) == "account_disabled"


def test_older_password_hashes_are_upgraded_on_sign_in(
    client: TestClient, session: Session, admin: User
) -> None:
    older = Passwords(time_cost=2, memory_kib=8, parallelism=1)
    admin.password_hash = older.hash(PASSWORD)
    session.commit()
    sign_in(client, admin.email)
    session.refresh(admin)
    assert admin.password_hash.startswith("$argon2id$v=19$m=8,t=1,p=1$")


def test_signing_in_again_replaces_this_browsers_session(
    client: TestClient, session: Session, admin: User
) -> None:
    sign_in(client, admin.email)
    sign_in(client, admin.email)
    assert session.query(UserSession).count() == 1


def test_signing_out(admin_client: TestClient, session: Session, admin: User) -> None:
    response = admin_client.post("/api/auth/sign-out")
    assert response.status_code == 204
    assert f'{SESSION_COOKIE}=""' in response.headers["set-cookie"]
    assert session.query(UserSession).count() == 0
    assert session.scalars(select(AuditEvent.event).order_by(AuditEvent.created_at)).all() == [
        "signed_in",
        "signed_out",
    ]
    assert admin_client.get("/api/system").status_code == 401


def test_changes_need_the_csrf_token(admin_client: TestClient) -> None:
    token = admin_client.headers.pop(CSRF_HEADER)
    missing = admin_client.post("/api/auth/sign-out")
    assert missing.status_code == 403
    assert error(missing) == "csrf"
    wrong = admin_client.post("/api/auth/sign-out", headers={CSRF_HEADER: token[:-1] + "x"})
    assert wrong.status_code == 403
    # Reading doesn't.
    assert admin_client.get("/api/system").status_code == 200


def test_requests_from_other_sites_are_refused(admin_client: TestClient) -> None:
    other_site = admin_client.post("/api/auth/sign-out", headers={"Origin": "https://evil.example"})
    assert other_site.status_code == 403
    assert error(other_site) == "cross_origin"
    cross_site = admin_client.post("/api/auth/sign-out", headers={"Sec-Fetch-Site": "cross-site"})
    assert cross_site.status_code == 403
    # Reads are harmless, so they're allowed.
    assert admin_client.get("/api/system", headers={"Origin": "https://evil.example"}).is_success
    same_site = admin_client.post(
        "/api/auth/sign-out", headers={"Origin": ORIGIN, "Sec-Fetch-Site": "same-origin"}
    )
    assert same_site.status_code == 204


def test_a_repeated_origin_header_cannot_hide_another_site(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/auth/sign-out",
        headers=[("Origin", ORIGIN), ("Origin", "https://evil.example")],
    )
    assert response.status_code == 403
    assert error(response) == "cross_origin"


def test_forged_sign_ins_from_other_sites_are_refused(client: TestClient, admin: User) -> None:
    response = client.post(
        "/api/auth/sign-in",
        json={"email": admin.email, "password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_idle_sessions_end(admin_client: TestClient, session: Session) -> None:
    row = session.scalars(select(UserSession)).one()
    row.last_seen_at = utcnow() - timedelta(hours=1, seconds=1)
    session.commit()
    assert admin_client.get("/api/system").status_code == 401
    assert admin_client.get("/api/auth/session").json()["user"] is None


def test_sessions_end_after_their_absolute_lifetime(
    admin_client: TestClient, session: Session
) -> None:
    row = session.scalars(select(UserSession)).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()
    assert admin_client.get("/api/system").status_code == 401


def test_sessions_of_turned_off_accounts_stop_working(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    admin.is_active = False
    session.commit()
    assert admin_client.get("/api/system").status_code == 401


def test_new_sign_ins_clear_out_expired_sessions(
    client: TestClient, session: Session, admin: User
) -> None:
    sign_in(client, admin.email)
    stale = session.scalars(select(UserSession)).one()
    stale.last_seen_at = utcnow() - timedelta(hours=2)
    session.commit()
    client.cookies.clear()
    sign_in(client, admin.email)
    assert session.scalars(select(UserSession.id)).all() != [stale.id]
    assert session.query(UserSession).count() == 1
