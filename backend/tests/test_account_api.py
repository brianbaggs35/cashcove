import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuditEvent, Invitation, PasswordReset, Role, User, UserSession
from app.models.base import utcnow
from tests.helpers import PASSWORD, error, sign_in

NEW_PASSWORD = "quiet-meadow-harbor-77"
FIREFOX_ON_ANDROID = "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0"


def make_stale(session: Session) -> None:
    """Pretends the person last confirmed who they are a while ago."""
    for row in session.scalars(select(UserSession)):
        row.verified_at = utcnow() - timedelta(hours=1)
    session.commit()


def second_browser(client: TestClient, email: str, agent: str = FIREFOX_ON_ANDROID) -> TestClient:
    other = TestClient(client.app, base_url=str(client.base_url), headers={"User-Agent": agent})
    sign_in(other, email)
    return other


def test_reading_ones_own_account(viewer_client: TestClient, viewer: User) -> None:
    body = viewer_client.get("/api/account").json()
    assert body["email"] == viewer.email
    assert body["role"] == "viewer"
    assert body["totp_enabled"] is False
    assert body["recovery_codes_left"] == 0


def test_changing_ones_name(viewer_client: TestClient, session: Session, viewer: User) -> None:
    make_stale(session)
    response = viewer_client.put(
        "/api/account/profile", json={"name": " Samantha Lee ", "email": viewer.email}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Samantha Lee"
    event = session.scalars(select(AuditEvent).where(AuditEvent.event == "profile_updated")).one()
    assert event.details == {"changed": ["name"]}


def test_saving_without_changes_records_nothing(
    viewer_client: TestClient, session: Session, viewer: User
) -> None:
    viewer_client.put("/api/account/profile", json={"name": viewer.name, "email": viewer.email})
    assert session.query(AuditEvent).filter(AuditEvent.event == "profile_updated").count() == 0


def test_changing_ones_email_needs_a_recent_check(
    viewer_client: TestClient, session: Session, viewer: User
) -> None:
    make_stale(session)
    body = {"name": viewer.name, "email": "Samantha@Example.com"}
    blocked = viewer_client.put("/api/account/profile", json=body)
    assert error(blocked) == "verification_required"
    viewer_client.post("/api/account/verify/password", json={"password": PASSWORD})
    assert viewer_client.put("/api/account/profile", json=body).json()["email"] == (
        "samantha@example.com"
    )


def test_an_email_can_belong_to_one_person(
    viewer_client: TestClient, session: Session, admin: User
) -> None:
    taken = viewer_client.put("/api/account/profile", json={"name": "Sam", "email": admin.email})
    assert taken.status_code == 409
    assert error(taken) == "email_taken"
    session.add(
        Invitation(
            token_hash=b"x" * 32,
            email="kid@example.com",
            name="Kid",
            role=Role.VIEWER,
            expires_at=utcnow() + timedelta(days=1),
        )
    )
    session.commit()
    invited = viewer_client.put(
        "/api/account/profile", json={"name": "Sam", "email": "kid@example.com"}
    )
    assert error(invited) == "email_taken"


def test_changing_ones_password_signs_out_other_browsers(
    viewer_client: TestClient, session: Session, viewer: User, settings: Settings
) -> None:
    other = second_browser(viewer_client, viewer.email)
    session.add(
        PasswordReset(
            token_hash=b"r" * 32, user_id=viewer.id, expires_at=utcnow() + timedelta(hours=1)
        )
    )
    session.commit()

    response = viewer_client.post(
        "/api/account/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 204
    assert viewer_client.get("/api/account").status_code == 200
    assert other.get("/api/account").status_code == 401
    assert session.query(PasswordReset).count() == 0
    event = session.scalars(select(AuditEvent).where(AuditEvent.event == "password_changed")).one()
    assert event.details == {"other_sessions_ended": 1}
    viewer_client.cookies.clear()
    sign_in(viewer_client, viewer.email, NEW_PASSWORD)


def test_changing_ones_password_needs_the_current_one(viewer_client: TestClient) -> None:
    response = viewer_client.post(
        "/api/account/password", json={"current_password": "nope", "new_password": NEW_PASSWORD}
    )
    assert response.status_code == 401
    assert error(response) == "wrong_password"


def test_the_new_password_has_to_be_new_and_strong(viewer_client: TestClient) -> None:
    same = viewer_client.post(
        "/api/account/password", json={"current_password": PASSWORD, "new_password": PASSWORD}
    )
    assert same.status_code == 422
    assert error(same) == "weak_password"
    weak = viewer_client.post(
        "/api/account/password",
        json={"current_password": PASSWORD, "new_password": "password1234"},
    )
    assert error(weak) == "weak_password"
    assert "common" in weak.json()["detail"]["message"]


def test_listing_signed_in_browsers(viewer_client: TestClient, viewer: User) -> None:
    viewer_client.headers["User-Agent"] = "curl/8.0"
    second_browser(viewer_client, viewer.email)
    sessions = viewer_client.get("/api/account/sessions").json()
    assert [(item["current"], item["device"], item["kind"]) for item in sessions] == [
        (True, "Unknown device", "unknown"),
        (False, "Firefox on Android", "phone"),
    ]
    assert sessions[1]["browser"] == "Firefox"
    assert sessions[1]["system"] == "Android"
    assert sessions[1]["ip_address"] == "testclient"


def test_idle_browsers_are_not_listed(
    viewer_client: TestClient, session: Session, viewer: User
) -> None:
    second_browser(viewer_client, viewer.email)
    current_id = viewer_client.get("/api/account/sessions").json()[0]["id"]
    for row in session.scalars(select(UserSession)):
        if str(row.id) != current_id:
            row.last_seen_at = utcnow() - timedelta(hours=2)
    session.commit()
    assert len(viewer_client.get("/api/account/sessions").json()) == 1


def test_signing_out_another_browser(
    viewer_client: TestClient, session: Session, viewer: User
) -> None:
    other = second_browser(viewer_client, viewer.email)
    sessions = viewer_client.get("/api/account/sessions").json()
    assert viewer_client.delete(f"/api/account/sessions/{sessions[1]['id']}").status_code == 204
    assert other.get("/api/account").status_code == 401
    event = session.scalars(select(AuditEvent).where(AuditEvent.event == "session_revoked")).one()
    assert event.details == {"device": "Firefox on Android"}

    current = viewer_client.delete(f"/api/account/sessions/{sessions[0]['id']}")
    assert current.status_code == 409
    assert error(current) == "current_session"
    missing = viewer_client.delete(f"/api/account/sessions/{uuid.uuid4()}")
    assert missing.status_code == 404


def test_other_peoples_sessions_are_out_of_reach(
    viewer_client: TestClient, session: Session, admin: User
) -> None:
    second_browser(viewer_client, admin.email)
    theirs = session.scalars(select(UserSession).where(UserSession.user_id == admin.id)).one()
    response = viewer_client.delete(f"/api/account/sessions/{theirs.id}")
    assert response.status_code == 404


def test_signing_out_everywhere_else(
    viewer_client: TestClient, session: Session, viewer: User
) -> None:
    nothing = viewer_client.post("/api/account/sessions/sign-out-others")
    assert nothing.json() == {"ended": 0}
    assert session.query(AuditEvent).filter(AuditEvent.event == "session_revoked").count() == 0
    first = second_browser(viewer_client, viewer.email)
    second = second_browser(viewer_client, viewer.email)
    assert viewer_client.post("/api/account/sessions/sign-out-others").json() == {"ended": 2}
    assert first.get("/api/account").status_code == 401
    assert second.get("/api/account").status_code == 401
    assert viewer_client.get("/api/account").status_code == 200


def test_reviewing_recent_activity(
    viewer_client: TestClient, session: Session, viewer: User, admin: User
) -> None:
    viewer_client.headers["User-Agent"] = FIREFOX_ON_ANDROID
    viewer_client.post("/api/account/verify/password", json={"password": "wrong"})
    admin_session = TestClient(viewer_client.app, base_url=str(viewer_client.base_url))
    sign_in(admin_session, admin.email)

    activity = viewer_client.get("/api/account/activity").json()

    # Only this account's events, newest first.
    assert [item["event"] for item in activity] == ["verification_failed", "signed_in"]
    assert activity[0]["device"] == "Firefox on Android"
    assert activity[0]["user_name"] == viewer.name
    assert activity[0]["actor_name"] == viewer.name
    assert activity[1]["device"] == "Unknown device"
    assert len(viewer_client.get("/api/account/activity?limit=1").json()) == 1
    assert viewer_client.get("/api/account/activity?limit=0").status_code == 422
