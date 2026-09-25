from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.sessions import SESSION_COOKIE, TWO_FACTOR_COOKIE
from app.config import Settings
from app.models import AuditEvent, AuthChallenge, LoginThrottle, RecoveryCode, User, UserSession
from app.models.base import utcnow
from tests.helpers import PASSWORD, error, sign_in, totp_code, use_session


def enable_totp(client: TestClient) -> tuple[str, list[str]]:
    started = client.post("/api/account/totp")
    assert started.status_code == 200, started.text
    secret: str = started.json()["secret"]
    confirmed = client.post("/api/account/totp/confirm", json={"code": totp_code(secret)})
    assert confirmed.status_code == 200, confirmed.text
    codes: list[str] = confirmed.json()["codes"]
    return secret, codes


def start_sign_in(client: TestClient, email: str, *, remember: bool = False) -> list[str]:
    client.cookies.clear()
    body = sign_in(client, email, remember=remember)
    assert body["status"] == "two_factor_required"
    methods: list[str] = body["methods"]
    return methods


def events(session: Session) -> list[str]:
    return list(session.scalars(select(AuditEvent.event).order_by(AuditEvent.created_at)))


def test_turning_on_an_authenticator_app(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    started = admin_client.post("/api/account/totp").json()
    uri = urlparse(str(started["uri"]))
    assert (uri.scheme, uri.netloc, uri.path) == ("otpauth", "totp", "/Cashcove:alex%40example.com")
    assert parse_qs(uri.query) == {"secret": [started["secret"]], "issuer": ["Cashcove"]}
    assert len(started["secret"]) == 32
    # The key is only stored, encrypted, once a code from it has been confirmed.
    session.refresh(admin)
    assert admin.totp_secret is None

    response = admin_client.post(
        "/api/account/totp/confirm", json={"code": totp_code(started["secret"])}
    )

    codes = response.json()["codes"]
    assert len(codes) == len(set(codes)) == 10
    session.refresh(admin)
    assert admin.totp_secret is not None
    assert started["secret"] not in admin.totp_secret
    account = admin_client.get("/api/account").json()
    assert account["totp_enabled"] is True
    assert account["recovery_codes_left"] == 10
    assert "two_factor_enabled" in events(session)
    assert session.scalar(select(AuthChallenge)) is None


def test_a_wrong_code_while_turning_it_on(admin_client: TestClient, session: Session) -> None:
    admin_client.post("/api/account/totp")
    for _ in range(4):
        wrong = admin_client.post("/api/account/totp/confirm", json={"code": "000000"})
        assert wrong.status_code == 422
        assert error(wrong) == "invalid_code"
    last = admin_client.post("/api/account/totp/confirm", json={"code": "000000"})
    assert last.status_code == 409
    assert error(last) == "setup_expired"
    assert session.scalar(select(AuthChallenge)) is None


def test_confirming_without_starting(admin_client: TestClient) -> None:
    response = admin_client.post("/api/account/totp/confirm", json={"code": "123456"})
    assert error(response) == "setup_expired"


def test_confirming_after_the_secret_key_changed(
    admin_client: TestClient, settings: Settings
) -> None:
    started = admin_client.post("/api/account/totp").json()
    settings.secret_key = SecretStr("a-completely-different-secret-key-value")
    response = admin_client.post(
        "/api/account/totp/confirm", json={"code": totp_code(started["secret"])}
    )
    assert error(response) == "setup_expired"


def test_it_can_only_be_turned_on_once(admin_client: TestClient) -> None:
    enable_totp(admin_client)
    response = admin_client.post("/api/account/totp")
    assert response.status_code == 409
    assert error(response) == "totp_enabled"


def test_signing_in_with_an_authenticator_code(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    secret, _ = enable_totp(admin_client)

    assert start_sign_in(admin_client, admin.email) == ["totp", "recovery_code"]
    assert TWO_FACTOR_COOKIE in admin_client.cookies
    assert SESSION_COOKIE not in admin_client.cookies
    response = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})

    assert response.status_code == 200
    use_session(admin_client, response.json())
    assert TWO_FACTOR_COOKIE not in admin_client.cookies
    assert admin_client.get("/api/account").json()["email"] == admin.email
    signed_in = session.scalars(
        select(AuditEvent).where(AuditEvent.event == "signed_in").order_by(AuditEvent.created_at)
    ).all()
    assert signed_in[-1].details == {"method": "totp", "remember": False}


def test_a_code_works_only_once(admin_client: TestClient, admin: User) -> None:
    secret, _ = enable_totp(admin_client)
    code = totp_code(secret, 1)
    start_sign_in(admin_client, admin.email)
    assert admin_client.post("/api/auth/sign-in/totp", json={"code": code}).status_code == 200
    start_sign_in(admin_client, admin.email)
    reused = admin_client.post("/api/auth/sign-in/totp", json={"code": code})
    assert reused.status_code == 401
    assert error(reused) == "invalid_code"


def test_too_many_wrong_codes_end_the_attempt(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    secret, _ = enable_totp(admin_client)
    start_sign_in(admin_client, admin.email)
    for _ in range(4):
        wrong = admin_client.post("/api/auth/sign-in/totp", json={"code": "12345"})
        assert error(wrong) == "invalid_code"
    last = admin_client.post("/api/auth/sign-in/totp", json={"code": "123456"})
    assert error(last) == "sign_in_expired"
    after = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})
    assert error(after) == "sign_in_expired"
    # Wrong codes count against the account like wrong passwords do.
    throttle = session.get(LoginThrottle, "email:alex@example.com")
    assert throttle is not None
    assert throttle.failures == 5


def test_a_locked_account_cannot_try_codes(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    secret, _ = enable_totp(admin_client)
    start_sign_in(admin_client, admin.email)
    session.add(
        LoginThrottle(
            key="email:alex@example.com",
            failures=9,
            last_failure_at=utcnow(),
            locked_until=utcnow() + timedelta(minutes=5),
        )
    )
    session.commit()
    response = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})
    assert response.status_code == 429


def test_the_second_step_needs_the_first(client: TestClient, admin: User) -> None:
    response = client.post("/api/auth/sign-in/totp", json={"code": "123456"})
    assert response.status_code == 401
    assert error(response) == "sign_in_expired"


def test_the_second_step_expires(admin_client: TestClient, session: Session, admin: User) -> None:
    secret, _ = enable_totp(admin_client)
    start_sign_in(admin_client, admin.email)
    challenge = session.scalars(select(AuthChallenge)).one()
    challenge.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()
    response = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})
    assert error(response) == "sign_in_expired"


def test_the_second_step_stops_if_the_account_is_turned_off(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    secret, _ = enable_totp(admin_client)
    start_sign_in(admin_client, admin.email)
    admin.is_active = False
    session.commit()
    response = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})
    assert error(response) == "sign_in_expired"


def test_keep_me_signed_in_carries_through_the_second_step(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    secret, _ = enable_totp(admin_client)
    start_sign_in(admin_client, admin.email, remember=True)
    response = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})
    assert response.json()["state"]["session"]["remember"] is True


def test_signing_in_with_a_recovery_code(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    _, codes = enable_totp(admin_client)
    start_sign_in(admin_client, admin.email)
    typed = codes[0].upper().replace("-", " ")
    response = admin_client.post("/api/auth/sign-in/recovery-code", json={"code": typed})
    assert response.status_code == 200
    assert response.json()["state"]["user"]["recovery_codes_left"] == 9
    used = session.scalars(select(AuditEvent).where(AuditEvent.event == "recovery_code_used")).one()
    assert used.details == {"codes_left": 9}

    start_sign_in(admin_client, admin.email)
    again = admin_client.post("/api/auth/sign-in/recovery-code", json={"code": codes[0]})
    assert error(again) == "invalid_code"


def test_codes_from_the_app_stop_working_if_the_secret_key_changes(
    admin_client: TestClient, admin: User, settings: Settings
) -> None:
    secret, codes = enable_totp(admin_client)
    settings.secret_key = SecretStr("a-completely-different-secret-key-value")
    start_sign_in(admin_client, admin.email)
    response = admin_client.post("/api/auth/sign-in/totp", json={"code": totp_code(secret, 1)})
    assert response.status_code == 409
    assert error(response) == "totp_unavailable"
    # Recovery codes still get the person in.
    recovered = admin_client.post("/api/auth/sign-in/recovery-code", json={"code": codes[1]})
    assert recovered.status_code == 200


def test_turning_it_off(admin_client: TestClient, session: Session, admin: User) -> None:
    enable_totp(admin_client)
    assert admin_client.delete("/api/account/totp").status_code == 204
    session.refresh(admin)
    assert (admin.totp_secret, admin.totp_last_step) == (None, None)
    assert session.query(RecoveryCode).count() == 0
    assert "two_factor_disabled" in events(session)
    # Turning it off again changes nothing.
    assert admin_client.delete("/api/account/totp").status_code == 204
    assert events(session).count("two_factor_disabled") == 1
    admin_client.cookies.clear()
    assert sign_in(admin_client, admin.email)["status"] == "signed_in"


def test_new_recovery_codes_replace_the_old_ones(admin_client: TestClient, admin: User) -> None:
    _, old = enable_totp(admin_client)
    new = admin_client.post("/api/account/recovery-codes").json()["codes"]
    assert len(new) == 10
    assert not set(new) & set(old)
    start_sign_in(admin_client, admin.email)
    rejected = admin_client.post("/api/auth/sign-in/recovery-code", json={"code": old[0]})
    assert error(rejected) == "invalid_code"


def test_recovery_codes_need_two_step_verification(admin_client: TestClient) -> None:
    response = admin_client.post("/api/account/recovery-codes")
    assert response.status_code == 409
    assert error(response) == "totp_disabled"


def test_sensitive_changes_need_a_recent_check(admin_client: TestClient, session: Session) -> None:
    row = session.scalars(select(UserSession)).one()
    row.verified_at = utcnow() - timedelta(minutes=11)
    session.commit()
    blocked = admin_client.post("/api/account/totp")
    assert blocked.status_code == 403
    assert error(blocked) == "verification_required"

    confirmed = admin_client.post("/api/account/verify/password", json={"password": PASSWORD})

    assert confirmed.status_code == 204
    assert admin_client.post("/api/account/totp").status_code == 200


def test_confirming_with_a_wrong_password(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    response = admin_client.post("/api/account/verify/password", json={"password": "nope"})
    assert response.status_code == 401
    assert error(response) == "wrong_password"
    failed = session.scalars(select(AuditEvent).where(AuditEvent.event != "signed_in")).one()
    assert (failed.event, failed.details) == ("verification_failed", {"method": "password"})
    throttle = session.get(LoginThrottle, "email:alex@example.com")
    assert throttle is not None
    assert throttle.failures == 1


def test_confirming_upgrades_an_older_password_hash(
    admin_client: TestClient, session: Session, admin: User
) -> None:
    from app.auth.passwords import Passwords

    admin.password_hash = Passwords(time_cost=2, memory_kib=8, parallelism=1).hash(PASSWORD)
    session.commit()
    admin_client.post("/api/account/verify/password", json={"password": PASSWORD})
    session.refresh(admin)
    assert admin.password_hash.startswith("$argon2id$v=19$m=8,t=1,p=1$")


def test_confirming_with_an_authenticator_code(admin_client: TestClient) -> None:
    secret, _ = enable_totp(admin_client)
    wrong = admin_client.post("/api/account/verify/totp", json={"code": "000000"})
    assert wrong.status_code == 401
    assert error(wrong) == "invalid_code"
    right = admin_client.post("/api/account/verify/totp", json={"code": totp_code(secret, 1)})
    assert right.status_code == 204


def test_confirming_is_blocked_while_locked(admin_client: TestClient, session: Session) -> None:
    session.add(
        LoginThrottle(
            key="ip:testclient",
            failures=30,
            last_failure_at=utcnow(),
            locked_until=utcnow() + timedelta(minutes=1),
        )
    )
    session.commit()
    response = admin_client.post("/api/account/verify/password", json={"password": PASSWORD})
    assert response.status_code == 429


def test_codes_do_nothing_without_an_authenticator_app(admin_client: TestClient) -> None:
    response = admin_client.post("/api/account/verify/totp", json={"code": "123456"})
    assert response.status_code == 401
    assert error(response) == "invalid_code"
