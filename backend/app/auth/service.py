"""The steps sign-in, verification and account changes share."""

import math
from datetime import datetime, timedelta
from functools import cache
from typing import Any

from fastapi import Request, Response, status
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.orm import Session

from app.auth import audit, passkeys, sessions, throttle, totp
from app.auth.audit import Event, client_address
from app.auth.challenges import Claimed
from app.auth.crypto import DecryptionError, SecretBox
from app.auth.deps import ApiError
from app.auth.setup import setup_required
from app.auth.tokens import hash_token, new_token
from app.config import Settings
from app.models import AppSettings, Passkey, PasswordReset, RecoveryCode, User, UserSession
from app.models.app_settings import SINGLETON_ID
from app.schemas.auth import SessionInfo, SessionState, SignInResult, UserOut
from app.schemas.preferences import Preferences

RESET_LIFETIME = timedelta(hours=24)


@cache
def _box(secret_key: bytes, purpose: str) -> SecretBox:
    return SecretBox(secret_key, purpose=purpose)


def totp_box(settings: Settings) -> SecretBox:
    return _box(settings.read_secret_key(), "totp")


def load_preferences(db: Session) -> Preferences:
    row = db.get(AppSettings, SINGLETON_ID)
    # Stored documents are merged over the defaults, so new fields appear without a migration.
    return Preferences.model_validate(row.data if row else {})


def user_out(db: Session, user: User) -> UserOut:
    passkey_count = db.scalar(
        select(func.count()).select_from(Passkey).where(Passkey.user_id == user.id)
    )
    codes_left = db.scalar(
        select(func.count())
        .select_from(RecoveryCode)
        .where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
    )
    return UserOut.model_validate(user).model_copy(
        update={"passkey_count": passkey_count or 0, "recovery_codes_left": codes_left or 0}
    )


def session_state(db: Session, settings: Settings, session: UserSession | None) -> SessionState:
    base = SessionState(
        setup_required=session is None and setup_required(db),
        origin=settings.public_origin,
        passkeys_supported=settings.passkeys_supported,
    )
    if session is None:
        return base
    return base.model_copy(
        update={
            "user": user_out(db, session.user),
            "session": SessionInfo(
                csrf_token=session.csrf_token,
                expires_at=session.expires_at,
                idle_timeout_seconds=int(sessions.lifetime(session).idle.total_seconds()),
                remember=session.remember,
            ),
        }
    )


def has_passkeys(db: Session, user: User) -> bool:
    return bool(db.scalar(select(exists().where(Passkey.user_id == user.id))))


# ---- Guessing protection --------------------------------------------------------------


def email_key(email: str) -> str:
    return throttle.key(throttle.EMAIL, email)


def address_key(request: Request, limit: throttle.Limit = throttle.ADDRESS) -> str:
    return throttle.key(limit, client_address(request) or "unknown")


def _wait_message(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} seconds"
    minutes = math.ceil(seconds / 60)
    return "1 minute" if minutes == 1 else f"{minutes} minutes"


def ensure_not_locked(db: Session, keys: list[str], now: datetime) -> None:
    wait = throttle.seconds_locked(db, keys, now)
    if wait:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_attempts",
            f"Too many attempts. Try again in {_wait_message(wait)}.",
            headers={"Retry-After": str(wait)},
            retry_after=wait,
        )


def record_failed_attempt(
    db: Session,
    request: Request,
    *,
    user: User | None,
    email: str | None,
    method: str,
    now: datetime,
    event: Event = Event.SIGN_IN_FAILED,
) -> None:
    """Counts a wrong password, code or passkey against the address and the account."""
    throttle.record_failure(db, address_key(request), throttle.ADDRESS, now)
    if email:
        throttle.record_failure(db, email_key(email), throttle.EMAIL, now)
    audit.record(db, request, event, user=user, method=method)
    db.commit()


# ---- Signing in -----------------------------------------------------------------------


def complete_sign_in(
    db: Session,
    request: Request,
    response: Response,
    settings: Settings,
    user: User,
    *,
    remember: bool,
    method: str,
    now: datetime,
) -> SignInResult:
    """Starts a fresh session, replacing whatever session this browser had before."""
    sessions.end(db, request.cookies.get(sessions.SESSION_COOKIE))
    throttle.clear(db, email_key(user.email))
    session = sessions.start(db, request, response, user, remember=remember, now=now)
    audit.record(db, request, Event.SIGNED_IN, user=user, method=method, remember=remember)
    db.commit()
    return SignInResult(status="signed_in", state=session_state(db, settings, session))


def check_passkey(
    db: Session,
    settings: Settings,
    credential: dict[str, Any],
    claimed: Claimed | None,
    *,
    user: User | None,
    now: datetime,
) -> Passkey | None:
    """The passkey that answered a challenge, or None if the answer doesn't hold up.

    With ``user`` given, only that person's passkeys are accepted.
    """
    if claimed is None or (user is not None and claimed.user_id != user.id):
        return None
    credential_id = passkeys.credential_id(credential)
    challenge = passkeys.decode_challenge(claimed.data.get("challenge"))
    if credential_id is None or challenge is None:
        return None
    query = select(Passkey).where(Passkey.credential_id == credential_id)
    if user is not None:
        query = query.where(Passkey.user_id == user.id)
    passkey = db.scalar(query)
    if passkey is None or not passkeys.user_handle_matches(credential, passkey.user.webauthn_id):
        return None
    try:
        verified = passkeys.verify_authentication(settings, credential, challenge, passkey)
    except passkeys.VERIFICATION_ERRORS:
        return None
    passkey.sign_count = verified.new_sign_count
    passkey.backed_up = verified.credential_backed_up
    passkey.last_used_at = now
    return passkey


def check_totp(db: Session, settings: Settings, user: User, code: str, now: datetime) -> bool:
    """Whether the code is right for this person and hasn't been used before."""
    if user.totp_secret is None:
        return False
    try:
        secret = totp_box(settings).decrypt(user.totp_secret)
    except DecryptionError:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "totp_unavailable",
            "Cashcove can't read your authenticator key, so codes from the app won't work. "
            "Use a recovery code or a passkey instead.",
        ) from None
    step = totp.matching_step(secret, code, at=now, last_step=user.totp_last_step)
    return step is not None and _claim_totp_step(db, user, step)


def _claim_totp_step(db: Session, user: User, step: int) -> bool:
    """Marks a code's time step as used. Of two requests with one code, only one succeeds."""
    claimed = db.scalars(
        update(User)
        .where(User.id == user.id, or_(User.totp_last_step.is_(None), User.totp_last_step < step))
        .values(totp_last_step=step)
        .returning(User.id)
    ).all()
    return len(claimed) == 1


def use_recovery_code(db: Session, user: User, code: str, now: datetime) -> bool:
    claimed = db.scalars(
        update(RecoveryCode)
        .where(
            RecoveryCode.user_id == user.id,
            RecoveryCode.code_hash == totp.hash_recovery_code(code),
            RecoveryCode.used_at.is_(None),
        )
        .values(used_at=now)
        .returning(RecoveryCode.id)
    ).all()
    return len(claimed) == 1


def replace_recovery_codes(db: Session, user: User) -> list[str]:
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = totp.new_recovery_codes()
    db.add_all(
        RecoveryCode(user_id=user.id, code_hash=totp.hash_recovery_code(code)) for code in codes
    )
    return codes


def turn_off_two_factor(db: Session, user: User) -> None:
    user.totp_secret = None
    user.totp_last_step = None
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))


# ---- One-time links ---------------------------------------------------------------------


def one_time_link(settings: Settings, page: str, token: str) -> str:
    # The token goes after "#", so browsers never send it to the server or in a Referer.
    return f"{settings.public_origin}/{page}#{token}"


def issue_password_reset(
    db: Session, user: User, *, created_by: User | None, now: datetime
) -> tuple[str, PasswordReset]:
    """A link token, valid for a day, that replaces any earlier one for this person."""
    token = new_token()
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    reset = PasswordReset(
        token_hash=hash_token(token),
        user_id=user.id,
        created_by_id=created_by.id if created_by else None,
        created_at=now,
        expires_at=now + RESET_LIFETIME,
    )
    db.add(reset)
    return token, reset
