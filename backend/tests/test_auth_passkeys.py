from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import account
from app.config import Settings
from app.models import AuditEvent, AuthChallenge, Passkey, User, UserSession
from app.models.base import utcnow
from tests.authenticator import ICLOUD_KEYCHAIN, Authenticator
from tests.helpers import error, sign_in, totp_code, use_session
from tests.test_auth_two_factor import enable_totp, start_sign_in

CHROME_ON_MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def add_passkey(client: TestClient, device: Authenticator, **extra: Any) -> dict[str, Any]:
    options = client.post("/api/account/passkeys/options").json()
    response = client.post(
        "/api/account/passkeys",
        json={
            "challenge_id": options["challenge_id"],
            "credential": device.create(options["options"]),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def passkey_sign_in(
    client: TestClient, device: Authenticator, *, remember: bool = False, **get: Any
) -> Any:
    options = client.post("/api/auth/passkey/options").json()
    return client.post(
        "/api/auth/passkey",
        json={
            "challenge_id": options["challenge_id"],
            "credential": device.get(options["options"], **get),
            "remember": remember,
        },
    )


def test_adding_a_passkey(admin_client: TestClient, session: Session, admin: User) -> None:
    options = admin_client.post("/api/account/passkeys/options").json()["options"]
    assert options["rp"] == {"name": "Cashcove", "id": "cashcove.example.com"}
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    assert options["excludeCredentials"] == []

    device = Authenticator(aaguid=ICLOUD_KEYCHAIN)
    added = add_passkey(admin_client, device)

    assert added["credential_id"] == device.id
    assert added["name"] == "iCloud Keychain"
    assert added["provider"] == "iCloud Keychain"
    assert added["backed_up"] is True
    assert added["last_used_at"] is None
    stored = session.scalars(select(Passkey)).one()
    assert stored.user_id == admin.id
    # Unknown transport names from the browser are dropped.
    assert stored.transports == ["internal", "hybrid"]
    account = admin_client.get("/api/account").json()
    assert account["passkey_count"] == 1
    # The browser can be told which passkeys are current for this account's handle.
    assert account["webauthn_user_id"] == options["user"]["id"]
    assert admin_client.get("/api/account/passkeys").json() == [added]
    added_event = session.scalars(
        select(AuditEvent).where(AuditEvent.event == "passkey_added")
    ).one()
    assert added_event.details == {"name": "iCloud Keychain"}
    # Next time, the browser is told not to create a second passkey on the same device.
    again = admin_client.post("/api/account/passkeys/options").json()["options"]
    assert [item["id"] for item in again["excludeCredentials"]] == [
        Authenticator(credential_id=stored.credential_id).id
    ]


def test_passkeys_are_named_after_the_browser_or_by_the_person(admin_client: TestClient) -> None:
    admin_client.headers["User-Agent"] = CHROME_ON_MAC
    assert add_passkey(admin_client, Authenticator())["name"] == "Chrome on macOS"
    admin_client.headers["User-Agent"] = "curl/8.0"
    assert add_passkey(admin_client, Authenticator())["name"] == "Passkey"
    named = add_passkey(admin_client, Authenticator(), name="  Work laptop ")
    assert named["name"] == "Work laptop"
    assert named["provider"] is None


def test_adding_a_passkey_needs_a_live_challenge_of_ones_own(
    admin_client: TestClient, session: Session, viewer: User
) -> None:
    device = Authenticator()
    options = admin_client.post("/api/account/passkeys/options").json()
    credential = device.create(options["options"])
    session.query(AuthChallenge).update({AuthChallenge.user_id: viewer.id})
    session.commit()
    stolen = admin_client.post(
        "/api/account/passkeys",
        json={"challenge_id": options["challenge_id"], "credential": credential},
    )
    assert stolen.status_code == 409
    assert error(stolen) == "passkey_expired"
    unknown = admin_client.post(
        "/api/account/passkeys", json={"challenge_id": "nope", "credential": credential}
    )
    assert error(unknown) == "passkey_expired"


def test_a_passkey_that_does_not_verify_is_refused(admin_client: TestClient) -> None:
    options = admin_client.post("/api/account/passkeys/options").json()
    credential = Authenticator(origin="https://evil.example").create(options["options"])
    response = admin_client.post(
        "/api/account/passkeys",
        json={"challenge_id": options["challenge_id"], "credential": credential},
    )
    assert response.status_code == 400
    assert error(response) == "passkey_failed"


def test_the_same_passkey_cannot_be_added_twice(admin_client: TestClient) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    options = admin_client.post("/api/account/passkeys/options").json()
    response = admin_client.post(
        "/api/account/passkeys",
        json={
            "challenge_id": options["challenge_id"],
            "credential": device.create(options["options"]),
        },
    )
    assert response.status_code == 409
    assert error(response) == "passkey_exists"


def test_there_is_a_limit_on_passkeys(
    admin_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(account, "MAX_PASSKEYS", 1)
    add_passkey(admin_client, Authenticator())
    response = admin_client.post("/api/account/passkeys/options")
    assert response.status_code == 409
    assert error(response) == "too_many_passkeys"


def test_passkeys_need_a_domain_name(admin_client: TestClient, settings: Settings) -> None:
    settings.server_name = "192.168.1.20"
    assert admin_client.get("/api/auth/session").json()["passkeys_supported"] is False
    assert error(admin_client.post("/api/account/passkeys/options")) == "passkeys_unavailable"
    assert error(admin_client.post("/api/auth/passkey/options")) == "passkeys_unavailable"


def test_renaming_and_removing_a_passkey(
    admin_client: TestClient, session: Session, viewer: User
) -> None:
    passkey = add_passkey(admin_client, Authenticator())
    renamed = admin_client.patch(f"/api/account/passkeys/{passkey['id']}", json={"name": "Phone"})
    assert renamed.json()["name"] == "Phone"
    assert admin_client.delete(f"/api/account/passkeys/{passkey['id']}").status_code == 204
    assert session.query(Passkey).count() == 0
    removed = session.scalars(select(AuditEvent).where(AuditEvent.event == "passkey_removed")).one()
    assert removed.details == {"name": "Phone"}
    gone = admin_client.delete(f"/api/account/passkeys/{passkey['id']}")
    assert gone.status_code == 404
    assert error(gone) == "not_found"


def test_signing_in_with_a_passkey(admin_client: TestClient, session: Session, admin: User) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()

    options = admin_client.post("/api/auth/passkey/options").json()["options"]
    # Any of this site's passkeys may answer, which is what lets browsers offer them as autofill.
    assert options["allowCredentials"] == []
    assert options["userVerification"] == "required"
    response = passkey_sign_in(admin_client, device, remember=True)

    assert response.status_code == 200
    state = use_session(admin_client, response.json())["state"]
    assert state["user"]["id"] == str(admin.id)
    assert state["session"]["remember"] is True
    stored = session.scalars(select(Passkey)).one()
    session.refresh(stored)
    assert stored.sign_count == 1
    assert stored.last_used_at is not None
    signed_in = session.scalars(
        select(AuditEvent).where(AuditEvent.event == "signed_in").order_by(AuditEvent.created_at)
    ).all()
    assert signed_in[-1].details == {"method": "passkey", "remember": True}


def test_passkeys_skip_the_authenticator_code(admin_client: TestClient, admin: User) -> None:
    enable_totp(admin_client)
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()
    response = passkey_sign_in(admin_client, device)
    assert response.json()["status"] == "signed_in"


def test_a_passkey_challenge_can_be_used_once(admin_client: TestClient) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()
    options = admin_client.post("/api/auth/passkey/options").json()
    body = {"challenge_id": options["challenge_id"], "credential": device.get(options["options"])}
    assert admin_client.post("/api/auth/passkey", json=body).status_code == 200
    replayed = admin_client.post("/api/auth/passkey", json=body)
    assert replayed.status_code == 401
    assert error(replayed) == "passkey_failed"
    # The passkey itself is fine, so the browser shouldn't be told to forget it.
    assert replayed.json()["detail"]["unknown_credential"] is False


@pytest.mark.parametrize(
    ("part", "field", "value", "unknown"),
    [
        pytest.param("credential", "rawId", "bm90LWEtcGFzc2tleQ", True, id="unknown passkey"),
        pytest.param("credential", "rawId", "not-a-passkey", False, id="unreadable id"),
        pytest.param("credential", "rawId", 12, False, id="malformed id"),
        pytest.param("response", "userHandle", "b3RoZXI", False, id="other account"),
        pytest.param("response", "userHandle", "", False, id="blank account"),
        pytest.param("response", "signature", "AAAA", False, id="bad signature"),
    ],
)
def test_passkey_answers_that_do_not_hold_up(
    admin_client: TestClient, part: str, field: str, value: object, unknown: bool
) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()
    options = admin_client.post("/api/auth/passkey/options").json()
    credential = device.get(options["options"])
    (credential if part == "credential" else credential["response"])[field] = value
    response = admin_client.post(
        "/api/auth/passkey",
        json={"challenge_id": options["challenge_id"], "credential": credential},
    )
    assert response.status_code == 401
    assert error(response) == "passkey_failed"
    assert response.json()["detail"]["unknown_credential"] is unknown
    assert "set-cookie" not in response.headers


def test_a_removed_passkey_is_reported_so_the_browser_can_forget_it(
    admin_client: TestClient,
) -> None:
    device = Authenticator()
    passkey = add_passkey(admin_client, device)
    admin_client.delete(f"/api/account/passkeys/{passkey['id']}")
    admin_client.cookies.clear()
    response = passkey_sign_in(admin_client, device)
    assert response.status_code == 401
    detail = response.json()["detail"]
    assert detail["unknown_credential"] is True
    assert detail["message"] == (
        "This passkey was removed from Cashcove. Sign in with your password instead."
    )


def test_passkeys_must_verify_the_person(admin_client: TestClient) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()
    assert passkey_sign_in(admin_client, device, verified=False).status_code == 401


def test_passkeys_without_an_account_name_still_work(admin_client: TestClient) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()
    device.user_handle = None
    assert passkey_sign_in(admin_client, device).status_code == 200


def test_a_turned_off_account_cannot_use_its_passkeys(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    device = Authenticator()
    add_passkey(admin_client, device)
    admin_client.cookies.clear()
    admin.is_active = False
    session.commit()
    response = passkey_sign_in(admin_client, device)
    assert response.status_code == 403
    assert error(response) == "account_disabled"


def test_a_passkey_as_the_second_step(admin_client: TestClient, admin: User) -> None:
    enable_totp(admin_client)
    device = Authenticator()
    add_passkey(admin_client, device)
    assert start_sign_in(admin_client, admin.email) == ["totp", "recovery_code", "passkey"]

    options = admin_client.post("/api/auth/sign-in/passkey/options").json()
    assert len(options["options"]["allowCredentials"]) == 1
    wrong = Authenticator(credential_id=device.credential_id)
    failed = admin_client.post(
        "/api/auth/sign-in/passkey",
        json={"challenge_id": options["challenge_id"], "credential": wrong.get(options["options"])},
    )
    assert error(failed) == "invalid_code"

    options = admin_client.post("/api/auth/sign-in/passkey/options").json()
    response = admin_client.post(
        "/api/auth/sign-in/passkey",
        json={
            "challenge_id": options["challenge_id"],
            "credential": device.get(options["options"]),
        },
    )
    assert response.status_code == 200
    assert response.json()["state"]["user"]["email"] == admin.email


def test_the_second_step_offers_passkeys_only_when_there_are_some(
    admin_client: TestClient, admin: User
) -> None:
    enable_totp(admin_client)
    start_sign_in(admin_client, admin.email)
    response = admin_client.post("/api/auth/sign-in/passkey/options")
    assert response.status_code == 409
    assert error(response) == "no_passkeys"


def test_another_accounts_passkey_cannot_be_the_second_step(
    admin_client: TestClient, session: Session, settings: Settings, viewer: User
) -> None:
    viewer_device = Authenticator()
    client_for_viewer = TestClient(admin_client.app, base_url=str(admin_client.base_url))
    sign_in(client_for_viewer, viewer.email)
    add_passkey(client_for_viewer, viewer_device)

    secret, _ = enable_totp(admin_client)
    add_passkey(admin_client, Authenticator())
    start_sign_in(admin_client, "alex@example.com")
    options = admin_client.post("/api/auth/sign-in/passkey/options").json()
    response = admin_client.post(
        "/api/auth/sign-in/passkey",
        json={
            "challenge_id": options["challenge_id"],
            "credential": viewer_device.get(options["options"]),
        },
    )
    assert error(response) == "invalid_code"
    # The code still works afterwards.
    assert (
        admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)}).status_code
        == 200
    )


def test_confirming_it_is_you_with_a_passkey(admin_client: TestClient, session: Session) -> None:
    missing = admin_client.post("/api/account/verify/passkey/options")
    assert error(missing) == "no_passkeys"
    device = Authenticator()
    add_passkey(admin_client, device)
    row = session.scalars(select(UserSession)).one()
    row.verified_at = utcnow().replace(year=2020)
    session.commit()

    options = admin_client.post("/api/account/verify/passkey/options").json()
    wrong = admin_client.post(
        "/api/account/verify/passkey",
        json={
            "challenge_id": options["challenge_id"],
            "credential": Authenticator(credential_id=device.credential_id).get(options["options"]),
        },
    )
    assert wrong.status_code == 401
    assert error(wrong) == "passkey_failed"

    options = admin_client.post("/api/account/verify/passkey/options").json()
    right = admin_client.post(
        "/api/account/verify/passkey",
        json={
            "challenge_id": options["challenge_id"],
            "credential": device.get(options["options"]),
        },
    )
    assert right.status_code == 204
    session.refresh(row)
    assert row.verified_at.year != 2020
