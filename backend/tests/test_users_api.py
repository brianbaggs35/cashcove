import uuid
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuditEvent, Passkey, PasswordReset, Role, User, UserSession
from app.models.base import utcnow
from tests.authenticator import Authenticator
from tests.helpers import ORIGIN, PASSWORD, add_user, error, sign_in
from tests.test_account_api import make_stale, second_browser
from tests.test_auth_passkeys import add_passkey
from tests.test_auth_two_factor import enable_totp


def events(session: Session, name: str) -> list[AuditEvent]:
    return list(session.scalars(select(AuditEvent).where(AuditEvent.event == name)))


def test_admins_see_how_everyone_signs_in(
    admin_client: TestClient, admin: User, viewer: User
) -> None:
    enable_totp(admin_client)
    members = admin_client.get("/api/users").json()
    assert [member["email"] for member in members] == [admin.email, viewer.email]
    assert members[0]["details"]["totp_enabled"] is True
    assert members[0]["details"]["passkey_count"] == 0
    assert members[0]["details"]["last_sign_in_at"] is not None
    assert members[1]["details"] == {
        "totp_enabled": False,
        "passkey_count": 0,
        "last_sign_in_at": None,
    }


def test_viewers_see_the_household_but_not_how_others_sign_in(
    viewer_client: TestClient, admin: User
) -> None:
    members = viewer_client.get("/api/users").json()
    assert {member["email"]: member["details"] for member in members} == {
        admin.email: None,
        "sam@example.com": None,
    }


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/api/users/{id}", {"role": "admin"}),
        ("DELETE", "/api/users/{id}", None),
        ("POST", "/api/users/{id}/password-reset", None),
        ("DELETE", "/api/users/{id}/two-factor", None),
        ("GET", "/api/users/activity", None),
        ("GET", "/api/users/invitations", None),
        (
            "POST",
            "/api/users/invitations",
            {"email": "a@example.com", "name": "A", "role": "admin"},
        ),
    ],
)
def test_viewers_cannot_manage_the_household(
    viewer_client: TestClient, admin: User, method: str, path: str, body: Any
) -> None:
    response = viewer_client.request(method, path.format(id=admin.id), json=body)
    assert response.status_code == 403
    assert error(response) == "admin_only"


def test_managing_people_needs_a_recent_check(
    admin_client: TestClient, session: Session, viewer: User
) -> None:
    make_stale(session)
    response = admin_client.patch(f"/api/users/{viewer.id}", json={"role": "admin"})
    assert error(response) == "verification_required"


def test_changing_someones_role(admin_client: TestClient, session: Session, viewer: User) -> None:
    response = admin_client.patch(f"/api/users/{viewer.id}", json={"role": "admin"})
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert response.json()["details"] is not None
    (event,) = events(session, "user_updated")
    assert (event.user_id, event.details) == (viewer.id, {"role": "admin"})
    # Saving the same values again changes nothing.
    admin_client.patch(f"/api/users/{viewer.id}", json={"role": "admin", "is_active": True})
    assert len(events(session, "user_updated")) == 1


def test_turning_an_account_off_and_on(
    admin_client: TestClient, session: Session, viewer: User
) -> None:
    viewer_browser = second_browser(admin_client, viewer.email)
    session.add(
        PasswordReset(
            token_hash=b"r" * 32, user_id=viewer.id, expires_at=utcnow() + timedelta(hours=1)
        )
    )
    session.commit()

    off = admin_client.patch(f"/api/users/{viewer.id}", json={"is_active": False})

    assert off.json()["is_active"] is False
    assert viewer_browser.get("/api/account").status_code == 401
    assert session.query(UserSession).filter(UserSession.user_id == viewer.id).count() == 0
    assert session.query(PasswordReset).count() == 0
    on = admin_client.patch(f"/api/users/{viewer.id}", json={"is_active": True})
    assert on.json()["is_active"] is True
    sign_in(viewer_browser, viewer.email)


def test_admins_cannot_turn_themselves_off(admin_client: TestClient, admin: User) -> None:
    response = admin_client.patch(f"/api/users/{admin.id}", json={"is_active": False})
    assert response.status_code == 409
    assert error(response) == "cannot_deactivate_self"


def test_there_is_always_an_admin(
    admin_client: TestClient, session: Session, settings: Settings, admin: User
) -> None:
    alone = admin_client.patch(f"/api/users/{admin.id}", json={"role": "viewer"})
    assert alone.status_code == 409
    assert error(alone) == "last_admin"
    session.refresh(admin)
    assert admin.role == Role.ADMIN

    add_user(session, settings, email="jo@example.com", name="Jo")
    stepped_down = admin_client.patch(f"/api/users/{admin.id}", json={"role": "viewer"})
    assert stepped_down.json()["role"] == "viewer"
    # A viewer now, so they can't manage people anymore.
    assert admin_client.get("/api/users/invitations").status_code == 403


def test_removing_someone(
    admin_client: TestClient, session: Session, viewer: User, admin: User
) -> None:
    viewer_browser = second_browser(admin_client, viewer.email)
    add_passkey(viewer_browser, Authenticator())

    assert admin_client.delete(f"/api/users/{viewer.id}").status_code == 204

    assert session.get(User, viewer.id) is None
    assert session.query(Passkey).count() == 0
    assert viewer_browser.get("/api/account").status_code == 401
    (event,) = events(session, "user_removed")
    assert (event.user_id, event.actor_id) == (None, admin.id)
    assert event.details == {"name": "Sam Lee", "email": "sam@example.com"}
    # Their earlier activity stays, no longer linked to an account.
    assert all(
        entry.user_id is None
        for entry in session.scalars(select(AuditEvent))
        if entry.actor_id is None
    )
    assert admin_client.delete(f"/api/users/{viewer.id}").status_code == 404


def test_admins_cannot_remove_themselves(admin_client: TestClient, admin: User) -> None:
    response = admin_client.delete(f"/api/users/{admin.id}")
    assert response.status_code == 409
    assert error(response) == "cannot_remove_self"


def test_resetting_someones_two_step_verification(
    admin_client: TestClient, session: Session, viewer: User, admin: User
) -> None:
    viewer_browser = second_browser(admin_client, viewer.email)
    enable_totp(viewer_browser)

    assert admin_client.delete(f"/api/users/{viewer.id}/two-factor").status_code == 204

    session.refresh(viewer)
    assert viewer.totp_secret is None
    (event,) = events(session, "two_factor_reset")
    assert (event.user_id, event.actor_id) == (viewer.id, admin.id)
    admin_client.delete(f"/api/users/{viewer.id}/two-factor")
    assert len(events(session, "two_factor_reset")) == 1
    assert admin_client.delete(f"/api/users/{uuid.uuid4()}/two-factor").status_code == 404


def test_household_activity(
    admin_client: TestClient, client: TestClient, admin: User, viewer: User
) -> None:
    other = TestClient(client.app, base_url=ORIGIN)
    other.post("/api/auth/sign-in", json={"email": "ghost@example.com", "password": "x"})
    activity = admin_client.get("/api/users/activity").json()
    assert [(item["event"], item["user_name"]) for item in activity[:2]] == [
        ("sign_in_failed", None),
        ("signed_in", admin.name),
    ]
    assert len(admin_client.get("/api/users/activity?limit=1").json()) == 1


# ---- Password reset links -------------------------------------------------------------


def reset_token(link: str) -> str:
    assert link.startswith(f"{ORIGIN}/reset-password#")
    return link.partition("#")[2]


def test_a_password_reset_link(
    admin_client: TestClient, client: TestClient, session: Session, viewer: User, admin: User
) -> None:
    viewer_browser = second_browser(admin_client, viewer.email)
    first = admin_client.post(f"/api/users/{viewer.id}/password-reset").json()
    created = admin_client.post(f"/api/users/{viewer.id}/password-reset")
    assert created.status_code == 201
    token = reset_token(created.json()["link"])
    # Only the newest link works.
    stale = client.post(
        "/api/auth/password-resets/preview", json={"token": reset_token(first["link"])}
    )
    assert stale.status_code == 404
    assert error(stale) == "link_expired"

    preview = client.post("/api/auth/password-resets/preview", json={"token": token}).json()
    assert preview["name"] == viewer.name
    assert preview["email"] == viewer.email

    done = client.post(
        "/api/auth/password-resets/complete",
        json={"token": token, "password": "quiet-meadow-harbor-77"},
    )

    assert done.status_code == 204
    # They're signed out everywhere and sign in again with the new password.
    assert viewer_browser.get("/api/account").status_code == 401
    assert "set-cookie" not in done.headers
    sign_in(client, viewer.email, "quiet-meadow-harbor-77")
    again = client.post(
        "/api/auth/password-resets/complete", json={"token": token, "password": "x" * 20}
    )
    assert again.status_code == 404
    created_event = events(session, "password_reset_created")[0]
    assert (created_event.user_id, created_event.actor_id) == (viewer.id, admin.id)
    assert len(events(session, "password_reset")) == 1


def test_a_password_reset_needs_a_good_password(
    admin_client: TestClient, client: TestClient, viewer: User
) -> None:
    token = reset_token(admin_client.post(f"/api/users/{viewer.id}/password-reset").json()["link"])
    weak = client.post(
        "/api/auth/password-resets/complete", json={"token": token, "password": "samlee"}
    )
    assert weak.status_code == 422
    assert error(weak) == "weak_password"
    # The link still works.
    assert client.post("/api/auth/password-resets/preview", json={"token": token}).is_success


def test_password_reset_links_expire(
    admin_client: TestClient, client: TestClient, session: Session, viewer: User
) -> None:
    token = reset_token(admin_client.post(f"/api/users/{viewer.id}/password-reset").json()["link"])
    reset = session.scalars(select(PasswordReset)).one()
    reset.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()
    response = client.post("/api/auth/password-resets/preview", json={"token": token})
    assert response.status_code == 404


def test_turned_off_accounts_get_no_reset_links(
    admin_client: TestClient, client: TestClient, viewer: User
) -> None:
    token = reset_token(admin_client.post(f"/api/users/{viewer.id}/password-reset").json()["link"])
    admin_client.patch(f"/api/users/{viewer.id}", json={"is_active": False})
    assert (
        client.post("/api/auth/password-resets/preview", json={"token": token}).status_code == 404
    )
    refused = admin_client.post(f"/api/users/{viewer.id}/password-reset")
    assert refused.status_code == 409
    assert error(refused) == "user_inactive"


def test_a_reset_link_lifts_a_lockout(
    admin_client: TestClient, client: TestClient, viewer: User
) -> None:
    for _ in range(6):
        client.post("/api/auth/sign-in", json={"email": viewer.email, "password": "x"})
    token = reset_token(admin_client.post(f"/api/users/{viewer.id}/password-reset").json()["link"])
    client.post(
        "/api/auth/password-resets/complete",
        json={"token": token, "password": "quiet-meadow-harbor-77"},
    )
    sign_in(client, viewer.email, "quiet-meadow-harbor-77")


# ---- Invitations ----------------------------------------------------------------------


def invite(client: TestClient, **overrides: Any) -> dict[str, Any]:
    body = {"email": "Kid@Example.com", "name": "Riley", "role": "viewer"} | overrides
    response = client.post("/api/users/invitations", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def invite_token(link: str) -> str:
    assert link.startswith(f"{ORIGIN}/invite#")
    return link.partition("#")[2]


def test_inviting_someone(
    admin_client: TestClient, client: TestClient, session: Session, admin: User
) -> None:
    admin_client.put("/api/settings", json={"general": {"household_name": "The Riveras"}})
    created = invite(admin_client)
    invitation = created["invitation"]
    assert (invitation["email"], invitation["role"], invitation["invited_by"]) == (
        "kid@example.com",
        "viewer",
        admin.name,
    )
    assert admin_client.get("/api/users/invitations").json() == [invitation]

    visitor = TestClient(client.app, base_url=ORIGIN)
    token = invite_token(created["link"])
    preview = visitor.post("/api/auth/invitations/preview", json={"token": token}).json()
    assert preview["household_name"] == "The Riveras"
    assert preview["invited_by"] == admin.name
    assert preview["role"] == "viewer"

    accepted = visitor.post(
        "/api/auth/invitations/accept",
        json={"token": token, "name": "Riley Rivera", "password": "quiet-meadow-harbor-77"},
    )

    assert accepted.status_code == 201
    state = accepted.json()
    assert state["user"]["email"] == "kid@example.com"
    assert state["user"]["name"] == "Riley Rivera"
    assert state["user"]["role"] == "viewer"
    assert admin_client.get("/api/users/invitations").json() == []
    (event,) = events(session, "invitation_accepted")
    assert event.details == {"role": "viewer", "invited_by": admin.name}
    reused = visitor.post(
        "/api/auth/invitations/accept",
        json={"token": token, "name": "Riley", "password": "quiet-meadow-harbor-77"},
    )
    assert reused.status_code == 404


def test_an_invitation_needs_a_good_password(admin_client: TestClient, client: TestClient) -> None:
    token = invite_token(invite(admin_client)["link"])
    weak = client.post(
        "/api/auth/invitations/accept",
        json={"token": token, "name": "Riley", "password": "riley-riley-riley"},
    )
    assert weak.status_code == 422
    assert error(weak) == "weak_password"


def test_invitations_expire_and_can_be_renewed(
    admin_client: TestClient, client: TestClient, session: Session
) -> None:
    created = invite(admin_client)
    old_token = invite_token(created["link"])
    from app.models import Invitation

    row = session.scalars(select(Invitation)).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()
    expired = client.post("/api/auth/invitations/preview", json={"token": old_token})
    assert expired.status_code == 404
    assert error(expired) == "link_expired"

    renewed = admin_client.post(f"/api/users/invitations/{created['invitation']['id']}/link")

    new_token = invite_token(renewed.json()["link"])
    assert new_token != old_token
    assert client.post("/api/auth/invitations/preview", json={"token": new_token}).is_success
    assert (
        client.post("/api/auth/invitations/preview", json={"token": old_token}).status_code == 404
    )


def test_revoking_an_invitation(
    admin_client: TestClient, client: TestClient, session: Session
) -> None:
    created = invite(admin_client)
    path = f"/api/users/invitations/{created['invitation']['id']}"
    assert admin_client.delete(path).status_code == 204
    assert (
        client.post(
            "/api/auth/invitations/preview", json={"token": invite_token(created["link"])}
        ).status_code
        == 404
    )
    (event,) = events(session, "invitation_revoked")
    assert event.details == {"email": "kid@example.com"}
    assert admin_client.delete(path).status_code == 404
    assert admin_client.post(f"{path}/link").status_code == 404


def test_one_invitation_per_email(admin_client: TestClient, viewer: User) -> None:
    invite(admin_client)
    again = admin_client.post(
        "/api/users/invitations", json={"email": "kid@example.com", "name": "R", "role": "admin"}
    )
    assert again.status_code == 409
    assert error(again) == "already_invited"
    member = admin_client.post(
        "/api/users/invitations", json={"email": viewer.email, "name": "S", "role": "admin"}
    )
    assert error(member) == "email_taken"


def test_an_invitation_for_an_email_that_is_now_taken(
    admin_client: TestClient, client: TestClient, session: Session, settings: Settings
) -> None:
    token = invite_token(invite(admin_client)["link"])
    add_user(session, settings, email="kid@example.com", name="Riley")
    response = client.post(
        "/api/auth/invitations/accept",
        json={"token": token, "name": "Riley", "password": PASSWORD},
    )
    assert response.status_code == 409
    assert error(response) == "email_taken"


def test_invitations_from_removed_admins_still_work(
    admin_client: TestClient, client: TestClient, session: Session, settings: Settings, admin: User
) -> None:
    token = invite_token(invite(admin_client, role="admin")["link"])
    other_admin = add_user(session, settings, email="jo@example.com", name="Jo")
    jo = TestClient(client.app, base_url=ORIGIN)
    sign_in(jo, other_admin.email)
    jo.delete(f"/api/users/{admin.id}")
    preview = client.post("/api/auth/invitations/preview", json={"token": token}).json()
    assert preview["invited_by"] is None
    accepted = client.post(
        "/api/auth/invitations/accept",
        json={"token": token, "name": "Riley", "password": PASSWORD},
    )
    assert accepted.json()["user"]["role"] == "admin"
    (event,) = events(session, "invitation_accepted")
    assert event.details == {"role": "admin", "invited_by": None}
