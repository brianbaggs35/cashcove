"""Everyone's own sign-in settings: profile, password, two-step verification, passkeys and
sessions. Viewers can change nothing in the household, but they do manage their own account.
"""

import uuid
from datetime import timedelta
from typing import Annotated, NoReturn

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import delete, exists, select

from app.auth import audit, challenges, passkeys, sessions, throttle, totp
from app.auth.activity import list_activity
from app.auth.audit import Event, client_agent
from app.auth.crypto import DecryptionError
from app.auth.deps import (
    AppSettings,
    Auth,
    CurrentAuth,
    Db,
    VerifiedAuth,
    fail,
    require_recent_verification,
)
from app.auth.passwords import get_passwords, password_problem
from app.auth.service import (
    address_key,
    check_passkey,
    check_totp,
    email_key,
    ensure_not_locked,
    record_failed_attempt,
    replace_recovery_codes,
    totp_box,
    turn_off_two_factor,
    user_out,
)
from app.auth.useragent import describe
from app.models import AuthChallenge, Invitation, Passkey, PasswordReset, User, UserSession
from app.models.base import utcnow
from app.schemas.auth import (
    ActivityOut,
    CodeRequest,
    PasskeyAnswer,
    PasskeyOptions,
    PasskeyOut,
    PasskeyRegistration,
    PasskeyRename,
    PasswordChangeRequest,
    PasswordRequest,
    ProfileUpdate,
    RecoveryCodes,
    SessionOut,
    SessionsEnded,
    TotpSetup,
    UserOut,
)

router = APIRouter(prefix="/account", tags=["account"])

TOTP_SETUP_LIFETIME = timedelta(minutes=15)
# Wrong codes allowed while confirming a new authenticator app.
MAX_SETUP_ATTEMPTS = 5
MAX_PASSKEYS = 20

TOO_WEAK = "weak_password"
SETUP_EXPIRED = "setup_expired"


# ---- Confirming it's you ---------------------------------------------------------------


def _locked_out(db: Db, request: Request, user: User) -> None:
    ensure_not_locked(db, [email_key(user.email), address_key(request)], utcnow())


def _verification_failed(
    db: Db, request: Request, user: User, *, method: str, code: str, message: str
) -> NoReturn:
    record_failed_attempt(
        db,
        request,
        user=user,
        email=user.email,
        method=method,
        now=utcnow(),
        event=Event.VERIFICATION_FAILED,
    )
    fail(status.HTTP_401_UNAUTHORIZED, code, message)


def _verified(db: Db, auth: Auth) -> None:
    """Sensitive changes are allowed for a while after this."""
    auth.session.verified_at = utcnow()
    throttle.clear(db, email_key(auth.user.email))
    db.commit()


@router.post("/verify/password", status_code=status.HTTP_204_NO_CONTENT)
def verify_with_password(
    body: PasswordRequest, auth: CurrentAuth, request: Request, db: Db, settings: AppSettings
) -> None:
    _locked_out(db, request, auth.user)
    matched, new_hash = get_passwords(settings).verify(body.password, auth.user.password_hash)
    if not matched:
        _verification_failed(
            db,
            request,
            auth.user,
            method="password",
            code="wrong_password",
            message="That password isn't right.",
        )
    if new_hash:
        auth.user.password_hash = new_hash
    _verified(db, auth)


@router.post("/verify/totp", status_code=status.HTTP_204_NO_CONTENT)
def verify_with_totp(
    body: CodeRequest, auth: CurrentAuth, request: Request, db: Db, settings: AppSettings
) -> None:
    _locked_out(db, request, auth.user)
    if not check_totp(db, settings, auth.user, body.code, utcnow()):
        _verification_failed(
            db,
            request,
            auth.user,
            method="totp",
            code="invalid_code",
            message="That code didn't work. Enter the newest code from your authenticator app.",
        )
    _verified(db, auth)


def _own_passkeys(db: Db, user: User) -> list[Passkey]:
    return list(
        db.scalars(
            select(Passkey).where(Passkey.user_id == user.id).order_by(Passkey.created_at)
        ).all()
    )


@router.post("/verify/passkey/options", response_model=PasskeyOptions)
def verify_with_passkey_options(auth: CurrentAuth, db: Db, settings: AppSettings) -> PasskeyOptions:
    allowed = _own_passkeys(db, auth.user)
    if not allowed or not settings.passkeys_supported:
        fail(status.HTTP_409_CONFLICT, "no_passkeys", "There are no passkeys on this account.")
    challenge, options = passkeys.authentication_options(settings, allowed)
    challenge_id, _ = challenges.create(
        db,
        challenges.PASSKEY_VERIFY,
        lifetime=challenges.PASSKEY_LIFETIME,
        now=utcnow(),
        user_id=auth.user.id,
        data={"challenge": passkeys.encode_challenge(challenge)},
    )
    db.commit()
    return PasskeyOptions(challenge_id=challenge_id, options=options)


@router.post("/verify/passkey", status_code=status.HTTP_204_NO_CONTENT)
def verify_with_passkey(
    body: PasskeyAnswer, auth: CurrentAuth, request: Request, db: Db, settings: AppSettings
) -> None:
    _locked_out(db, request, auth.user)
    now = utcnow()
    claimed = challenges.claim(db, body.challenge_id, challenges.PASSKEY_VERIFY, now)
    if check_passkey(db, settings, body.credential, claimed, user=auth.user, now=now) is None:
        _verification_failed(
            db,
            request,
            auth.user,
            method="passkey",
            code="passkey_failed",
            message="That passkey didn't work. Try again or use your password.",
        )
    _verified(db, auth)


# ---- Profile and password -------------------------------------------------------------


@router.get("", response_model=UserOut)
def read_account(auth: CurrentAuth, db: Db) -> UserOut:
    return user_out(db, auth.user)


@router.put("/profile", response_model=UserOut)
def update_profile(body: ProfileUpdate, auth: CurrentAuth, request: Request, db: Db) -> UserOut:
    user = auth.user
    changed: list[str] = []
    if body.email != user.email:
        # The email is what people sign in with, so changing it needs a fresh check.
        require_recent_verification(auth)
        in_use = db.scalar(select(exists().where(User.email == body.email))) or db.scalar(
            select(exists().where(Invitation.email == body.email))
        )
        if in_use:
            fail(
                status.HTTP_409_CONFLICT,
                "email_taken",
                "Someone in this household already uses that email.",
            )
        user.email = body.email
        changed.append("email")
    if body.name != user.name:
        user.name = body.name
        changed.append("name")
    if changed:
        audit.record(db, request, Event.PROFILE_UPDATED, user=user, changed=changed)
    db.commit()
    return user_out(db, user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChangeRequest,
    auth: CurrentAuth,
    request: Request,
    db: Db,
    settings: AppSettings,
) -> None:
    """Changes the password and signs out every other browser."""
    user = auth.user
    _locked_out(db, request, user)
    hasher = get_passwords(settings)
    if not hasher.verify(body.current_password, user.password_hash)[0]:
        _verification_failed(
            db,
            request,
            user,
            method="password",
            code="wrong_password",
            message="Your current password isn't right.",
        )
    if body.new_password == body.current_password:
        fail(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            TOO_WEAK,
            "Choose a new password that's different from your current one.",
        )
    if problem := password_problem(body.new_password, email=user.email, name=user.name):
        fail(status.HTTP_422_UNPROCESSABLE_CONTENT, TOO_WEAK, problem)
    now = utcnow()
    user.password_hash = hasher.hash(body.new_password)
    user.password_changed_at = now
    ended = sessions.end_all(db, user, keep=auth.session)
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    audit.record(db, request, Event.PASSWORD_CHANGED, user=user, other_sessions_ended=ended)
    _verified(db, auth)


# ---- Two-step verification ------------------------------------------------------------


@router.post("/totp", response_model=TotpSetup)
def start_totp_setup(auth: VerifiedAuth, db: Db, settings: AppSettings) -> TotpSetup:
    """A new authenticator key. It's only turned on once a code from it is confirmed."""
    user = auth.user
    if user.totp_enabled:
        fail(status.HTTP_409_CONFLICT, "totp_enabled", "Two-step verification is already on.")
    now = utcnow()
    secret = totp.new_secret()
    challenges.clear(db, challenges.TOTP_SETUP, user.id)
    challenges.create(
        db,
        challenges.TOTP_SETUP,
        lifetime=TOTP_SETUP_LIFETIME,
        now=now,
        user_id=user.id,
        data={"secret": totp_box(settings).encrypt(secret)},
    )
    db.commit()
    return TotpSetup(
        secret=secret,
        uri=totp.provisioning_uri(secret, email=user.email),
        expires_at=now + TOTP_SETUP_LIFETIME,
    )


def _setup_expired(message: str) -> NoReturn:
    fail(status.HTTP_409_CONFLICT, SETUP_EXPIRED, message)


@router.post("/totp/confirm", response_model=RecoveryCodes)
def confirm_totp_setup(
    body: CodeRequest, auth: VerifiedAuth, request: Request, db: Db, settings: AppSettings
) -> RecoveryCodes:
    """Turns two-step verification on and returns recovery codes, shown only this once."""
    user = auth.user
    now = utcnow()
    pending = db.scalar(
        select(AuthChallenge).where(
            AuthChallenge.purpose == challenges.TOTP_SETUP,
            AuthChallenge.user_id == user.id,
            AuthChallenge.expires_at > now,
        )
    )
    sealed = pending.data.get("secret") if pending else None
    try:
        secret = totp_box(settings).decrypt(sealed) if isinstance(sealed, str) else None
    except DecryptionError:
        secret = None
    if pending is None or secret is None or not isinstance(sealed, str):
        _setup_expired("This setup timed out. Start again to get a new QR code.")
    step = totp.matching_step(secret, body.code, at=now)
    if step is None:
        pending.attempts += 1
        if pending.attempts >= MAX_SETUP_ATTEMPTS:
            db.delete(pending)
            db.commit()
            _setup_expired("Too many codes didn't match. Start again to get a new QR code.")
        db.commit()
        fail(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "invalid_code",
            "That code doesn't match. Make sure your phone's clock is right, then enter the "
            "newest code.",
        )
    user.totp_secret = sealed
    user.totp_last_step = step
    db.delete(pending)
    codes = replace_recovery_codes(db, user)
    audit.record(db, request, Event.TWO_FACTOR_ENABLED, user=user)
    db.commit()
    return RecoveryCodes(codes=codes)


@router.delete("/totp", status_code=status.HTTP_204_NO_CONTENT)
def turn_off_totp(auth: VerifiedAuth, request: Request, db: Db) -> None:
    if auth.user.totp_enabled:
        turn_off_two_factor(db, auth.user)
        audit.record(db, request, Event.TWO_FACTOR_DISABLED, user=auth.user)
    db.commit()


@router.post("/recovery-codes", response_model=RecoveryCodes)
def create_recovery_codes(auth: VerifiedAuth, request: Request, db: Db) -> RecoveryCodes:
    """Replaces every recovery code with a new set."""
    if not auth.user.totp_enabled:
        fail(
            status.HTTP_409_CONFLICT,
            "totp_disabled",
            "Recovery codes come with two-step verification. Turn it on first.",
        )
    codes = replace_recovery_codes(db, auth.user)
    audit.record(db, request, Event.RECOVERY_CODES_CREATED, user=auth.user)
    db.commit()
    return RecoveryCodes(codes=codes)


# ---- Passkeys -------------------------------------------------------------------------


def _passkey_out(passkey: Passkey) -> PasskeyOut:
    return PasskeyOut(
        id=passkey.id,
        credential_id=passkeys.encode_id(passkey.credential_id),
        name=passkey.name,
        provider=passkeys.provider_name(passkey.aaguid),
        backed_up=passkey.backed_up,
        created_at=passkey.created_at,
        last_used_at=passkey.last_used_at,
    )


@router.get("/passkeys", response_model=list[PasskeyOut])
def list_passkeys(auth: CurrentAuth, db: Db) -> list[PasskeyOut]:
    return [_passkey_out(passkey) for passkey in _own_passkeys(db, auth.user)]


@router.post("/passkeys/options", response_model=PasskeyOptions)
def passkey_registration_options(
    auth: VerifiedAuth, db: Db, settings: AppSettings
) -> PasskeyOptions:
    if not settings.passkeys_supported:
        fail(
            status.HTTP_409_CONFLICT,
            "passkeys_unavailable",
            "Passkeys need Cashcove to be opened by its domain name, not an IP address.",
        )
    existing = _own_passkeys(db, auth.user)
    if len(existing) >= MAX_PASSKEYS:
        fail(
            status.HTTP_409_CONFLICT,
            "too_many_passkeys",
            f"You can save up to {MAX_PASSKEYS} passkeys. Remove one you don't use first.",
        )
    challenge, options = passkeys.registration_options(settings, auth.user, existing)
    challenge_id, _ = challenges.create(
        db,
        challenges.PASSKEY_REGISTER,
        lifetime=challenges.PASSKEY_LIFETIME,
        now=utcnow(),
        user_id=auth.user.id,
        data={"challenge": passkeys.encode_challenge(challenge)},
    )
    db.commit()
    return PasskeyOptions(challenge_id=challenge_id, options=options)


def _default_passkey_name(aaguid: str, request: Request) -> str:
    device = describe(client_agent(request))
    known = device.browser is not None or device.system is not None
    return passkeys.provider_name(aaguid) or (device.label if known else "Passkey")


@router.post("/passkeys", response_model=PasskeyOut, status_code=status.HTTP_201_CREATED)
def add_passkey(
    body: PasskeyRegistration,
    auth: VerifiedAuth,
    request: Request,
    db: Db,
    settings: AppSettings,
) -> PasskeyOut:
    now = utcnow()
    claimed = challenges.claim(db, body.challenge_id, challenges.PASSKEY_REGISTER, now)
    challenge = (
        passkeys.decode_challenge(claimed.data.get("challenge"))
        if claimed is not None and claimed.user_id == auth.user.id
        else None
    )
    if challenge is None:
        fail(
            status.HTTP_409_CONFLICT,
            "passkey_expired",
            "That took too long. Try adding the passkey again.",
        )
    try:
        verified = passkeys.verify_registration(settings, body.credential, challenge)
    except passkeys.VERIFICATION_ERRORS:
        db.commit()
        fail(
            status.HTTP_400_BAD_REQUEST,
            "passkey_failed",
            "Your device couldn't create a passkey for Cashcove. Try again.",
        )
    if db.scalar(select(exists().where(Passkey.credential_id == verified.credential_id))):
        db.commit()
        fail(status.HTTP_409_CONFLICT, "passkey_exists", "This passkey is already saved.")
    passkey = Passkey(
        user_id=auth.user.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        transports=passkeys.credential_transports(body.credential),
        aaguid=verified.aaguid,
        backed_up=verified.credential_backed_up,
        name=body.name or _default_passkey_name(verified.aaguid, request),
        created_at=now,
    )
    db.add(passkey)
    audit.record(db, request, Event.PASSKEY_ADDED, user=auth.user, name=passkey.name)
    db.commit()
    return _passkey_out(passkey)


def _own_passkey(db: Db, user: User, passkey_id: uuid.UUID) -> Passkey:
    passkey = db.scalar(select(Passkey).where(Passkey.id == passkey_id, Passkey.user_id == user.id))
    if passkey is None:
        fail(status.HTTP_404_NOT_FOUND, "not_found", "That passkey has already been removed.")
    return passkey


@router.patch("/passkeys/{passkey_id}", response_model=PasskeyOut)
def rename_passkey(
    passkey_id: uuid.UUID, body: PasskeyRename, auth: CurrentAuth, db: Db
) -> PasskeyOut:
    passkey = _own_passkey(db, auth.user, passkey_id)
    passkey.name = body.name
    db.commit()
    return _passkey_out(passkey)


@router.delete("/passkeys/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_passkey(passkey_id: uuid.UUID, auth: VerifiedAuth, request: Request, db: Db) -> None:
    passkey = _own_passkey(db, auth.user, passkey_id)
    db.delete(passkey)
    audit.record(db, request, Event.PASSKEY_REMOVED, user=auth.user, name=passkey.name)
    db.commit()


# ---- Sessions and activity ------------------------------------------------------------


def _session_out(session: UserSession, current: UserSession) -> SessionOut:
    device = describe(session.user_agent)
    return SessionOut(
        id=session.id,
        device=device.label,
        browser=device.browser,
        system=device.system,
        kind=device.kind,
        ip_address=session.ip_address,
        remember=session.remember,
        current=session.id == current.id,
        created_at=session.created_at,
        last_seen_at=session.last_seen_at,
    )


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(auth: CurrentAuth, db: Db) -> list[SessionOut]:
    """Browsers signed in to this account, the current one first."""
    now = utcnow()
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == auth.user.id)
        .order_by(UserSession.last_seen_at.desc())
    ).all()
    live = [row for row in rows if sessions.idle_deadline(row) > now]
    live.sort(key=lambda row: row.id != auth.session.id)
    return [_session_out(row, auth.session) for row in live]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def end_session(session_id: uuid.UUID, auth: CurrentAuth, request: Request, db: Db) -> None:
    """Signs one of this account's other browsers out."""
    target = db.scalar(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == auth.user.id)
    )
    if target is None:
        fail(status.HTTP_404_NOT_FOUND, "not_found", "That session has already ended.")
    if target.id == auth.session.id:
        fail(status.HTTP_409_CONFLICT, "current_session", "Use Sign out to end this session.")
    db.delete(target)
    device = describe(target.user_agent).label
    audit.record(db, request, Event.SESSION_REVOKED, user=auth.user, device=device)
    db.commit()


@router.post("/sessions/sign-out-others", response_model=SessionsEnded)
def end_other_sessions(auth: CurrentAuth, request: Request, db: Db) -> SessionsEnded:
    ended = sessions.end_all(db, auth.user, keep=auth.session)
    if ended:
        audit.record(db, request, Event.SESSION_REVOKED, user=auth.user, count=ended)
    db.commit()
    return SessionsEnded(ended=ended)


@router.get("/activity", response_model=list[ActivityOut])
def account_activity(
    auth: CurrentAuth, db: Db, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[ActivityOut]:
    """Recent sign-ins and security changes on this account."""
    return list_activity(db, user_id=auth.user.id, limit=limit)
