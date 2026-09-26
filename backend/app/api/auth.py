"""Signing in and out, first-run setup, and the one-time links admins share."""

from datetime import timedelta
from typing import NoReturn

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import delete, exists, func, select

from app.auth import audit, challenges, passkeys, sessions, setup, throttle
from app.auth.audit import Event
from app.auth.deps import ApiError, AppSettings, CurrentAuth, Db
from app.auth.passwords import get_passwords, password_problem
from app.auth.service import (
    address_key,
    check_passkey,
    check_totp,
    complete_sign_in,
    email_key,
    ensure_not_locked,
    has_passkeys,
    load_preferences,
    record_failed_attempt,
    session_state,
    use_recovery_code,
)
from app.auth.tokens import hash_token
from app.models import AuthChallenge, Invitation, Passkey, PasswordReset, RecoveryCode, Role, User
from app.models.base import utcnow
from app.schemas.auth import (
    AcceptInvitationRequest,
    CodeRequest,
    CompletePasswordResetRequest,
    InvitationPreview,
    PasskeyAnswer,
    PasskeyOptions,
    PasskeySignInRequest,
    PasswordResetPreview,
    SessionState,
    SetupCodeRequest,
    SetupRequest,
    SignInRequest,
    SignInResult,
    TokenRequest,
    TwoFactorMethod,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# How long someone has to enter a code after their password was accepted.
TWO_FACTOR_LIFETIME = timedelta(minutes=5)
# Wrong codes allowed before the password has to be entered again.
MAX_CODE_ATTEMPTS = 5

INVALID_SETUP_CODE = "That setup code isn't right. Check Cashcove's logs for the latest one."
TOO_WEAK = "weak_password"
ACCOUNT_DISABLED = "Your account is turned off. Ask an admin in your household to turn it on."
LINK_EXPIRED = "link_expired"


# ---- Session and first-run setup ------------------------------------------------------


@router.get("/session", response_model=SessionState)
def read_session(
    request: Request, response: Response, db: Db, settings: AppSettings
) -> SessionState:
    """Who's signed in on this browser, if anyone. Loading the app counts as activity."""
    now = utcnow()
    token = request.cookies.get(sessions.SESSION_COOKIE)
    session = sessions.load(db, token, now)
    if session is not None:
        sessions.touch(session, now)
        db.commit()
    elif token:
        sessions.clear_cookie(response, sessions.SESSION_COOKIE)
    return session_state(db, settings, session)


def _require_setup(db: Db) -> None:
    if not setup.setup_required(db):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "already_set_up",
            "Cashcove is already set up. Sign in instead.",
        )


@router.post("/setup/check", status_code=status.HTTP_204_NO_CONTENT)
def check_setup_code(body: SetupCodeRequest, request: Request, db: Db) -> None:
    """Confirms the setup code early, so the wizard can say so before the account form."""
    now = utcnow()
    _require_setup(db)
    key = address_key(request, throttle.SETUP)
    ensure_not_locked(db, [key], now)
    if not setup.code_is_valid(db, body.setup_code, now):
        throttle.record_failure(db, key, throttle.SETUP, now)
        db.commit()
        raise ApiError(status.HTTP_403_FORBIDDEN, "invalid_setup_code", INVALID_SETUP_CODE)


@router.post("/setup", response_model=SessionState, status_code=status.HTTP_201_CREATED)
def complete_setup(
    body: SetupRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> SessionState:
    """Creates the first admin and signs them in."""
    now = utcnow()
    _require_setup(db)
    key = address_key(request, throttle.SETUP)
    ensure_not_locked(db, [key], now)
    if problem := password_problem(body.password, email=body.email, name=body.name):
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, TOO_WEAK, problem)
    if not setup.claim_code(db, body.setup_code, now):
        throttle.record_failure(db, key, throttle.SETUP, now)
        db.commit()
        raise ApiError(status.HTTP_403_FORBIDDEN, "invalid_setup_code", INVALID_SETUP_CODE)
    user = User(
        email=body.email,
        name=body.name,
        role=Role.ADMIN,
        password_hash=get_passwords(settings).hash(body.password),
        password_changed_at=now,
    )
    db.add(user)
    db.flush()
    session = sessions.start(db, request, response, user, remember=False, now=now)
    throttle.clear(db, key)
    audit.record(db, request, Event.SETUP_COMPLETED, user=user)
    db.commit()
    return session_state(db, settings, session)


# ---- Password sign-in and the second step ---------------------------------------------


@router.post("/sign-in", response_model=SignInResult)
def sign_in(
    body: SignInRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> SignInResult:
    now = utcnow()
    email = body.email.strip().lower()
    ensure_not_locked(db, [email_key(email), address_key(request)], now)
    user = db.scalar(select(User).where(User.email == email))
    matched, new_hash = get_passwords(settings).verify(
        body.password, user.password_hash if user else None
    )
    if user is None or not matched:
        record_failed_attempt(db, request, user=user, email=email, method="password", now=now)
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_credentials",
            "That email and password don't match.",
        )
    if new_hash:
        user.password_hash = new_hash
    if not user.is_active:
        db.commit()
        raise ApiError(status.HTTP_403_FORBIDDEN, "account_disabled", ACCOUNT_DISABLED)
    if not user.totp_enabled:
        return complete_sign_in(
            db,
            request,
            response,
            settings,
            user,
            remember=body.remember,
            method="password",
            now=now,
        )
    challenges.purge_expired(db, now)
    token, _ = challenges.create(
        db,
        challenges.TWO_FACTOR,
        lifetime=TWO_FACTOR_LIFETIME,
        now=now,
        user_id=user.id,
        data={"remember": body.remember},
    )
    sessions.set_cookie(response, sessions.TWO_FACTOR_COOKIE, token, max_age=TWO_FACTOR_LIFETIME)
    methods: list[TwoFactorMethod] = ["totp", "recovery_code"]
    if settings.passkeys_supported and has_passkeys(db, user):
        methods.append("passkey")
    db.commit()
    return SignInResult(status="two_factor_required", methods=methods)


def _pending_sign_in(request: Request, db: Db) -> tuple[AuthChallenge, User]:
    now = utcnow()
    challenge = challenges.find(
        db, request.cookies.get(sessions.TWO_FACTOR_COOKIE), challenges.TWO_FACTOR, now
    )
    user = db.get(User, challenge.user_id) if challenge and challenge.user_id else None
    if challenge is None or user is None or not user.is_active:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "sign_in_expired",
            "Your sign-in timed out. Enter your email and password again.",
        )
    ensure_not_locked(db, [email_key(user.email), address_key(request)], now)
    return challenge, user


def _second_step_failed(
    db: Db, request: Request, challenge: AuthChallenge, user: User, *, method: str, message: str
) -> NoReturn:
    challenge.attempts += 1
    out_of_tries = challenge.attempts >= MAX_CODE_ATTEMPTS
    if out_of_tries:
        db.delete(challenge)
    record_failed_attempt(db, request, user=user, email=user.email, method=method, now=utcnow())
    if out_of_tries:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "sign_in_expired",
            "That was the last try. Enter your email and password to start again.",
        )
    raise ApiError(status.HTTP_401_UNAUTHORIZED, "invalid_code", message)


def _finish_second_step(
    db: Db,
    request: Request,
    response: Response,
    settings: AppSettings,
    challenge: AuthChallenge,
    user: User,
    *,
    method: str,
) -> SignInResult:
    remember = challenge.data.get("remember") is True
    db.delete(challenge)
    sessions.clear_cookie(response, sessions.TWO_FACTOR_COOKIE)
    return complete_sign_in(
        db, request, response, settings, user, remember=remember, method=method, now=utcnow()
    )


@router.post("/sign-in/totp", response_model=SignInResult)
def sign_in_with_totp(
    body: CodeRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> SignInResult:
    challenge, user = _pending_sign_in(request, db)
    if not check_totp(db, settings, user, body.code, utcnow()):
        _second_step_failed(
            db,
            request,
            challenge,
            user,
            method="totp",
            message="That code didn't work. Enter the newest code from your authenticator app.",
        )
    return _finish_second_step(db, request, response, settings, challenge, user, method="totp")


@router.post("/sign-in/recovery-code", response_model=SignInResult)
def sign_in_with_recovery_code(
    body: CodeRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> SignInResult:
    challenge, user = _pending_sign_in(request, db)
    if not use_recovery_code(db, user, body.code, utcnow()):
        _second_step_failed(
            db,
            request,
            challenge,
            user,
            method="recovery_code",
            message="That recovery code didn't work. Each code can only be used once.",
        )
    codes_left = db.scalar(
        select(func.count())
        .select_from(RecoveryCode)
        .where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
    )
    audit.record(db, request, Event.RECOVERY_CODE_USED, user=user, codes_left=codes_left)
    return _finish_second_step(
        db, request, response, settings, challenge, user, method="recovery_code"
    )


@router.post("/sign-in/passkey/options", response_model=PasskeyOptions)
def second_step_passkey_options(request: Request, db: Db, settings: AppSettings) -> PasskeyOptions:
    _, user = _pending_sign_in(request, db)
    allowed = db.scalars(select(Passkey).where(Passkey.user_id == user.id)).all()
    if not allowed or not settings.passkeys_supported:
        raise ApiError(
            status.HTTP_409_CONFLICT, "no_passkeys", "There are no passkeys on this account."
        )
    challenge, options = passkeys.authentication_options(settings, allowed)
    challenge_id, _ = challenges.create(
        db,
        challenges.PASSKEY_TWO_FACTOR,
        lifetime=challenges.PASSKEY_LIFETIME,
        now=utcnow(),
        user_id=user.id,
        data={"challenge": passkeys.encode_challenge(challenge)},
    )
    db.commit()
    return PasskeyOptions(challenge_id=challenge_id, options=options)


@router.post("/sign-in/passkey", response_model=SignInResult)
def sign_in_second_step_with_passkey(
    body: PasskeyAnswer, request: Request, response: Response, db: Db, settings: AppSettings
) -> SignInResult:
    challenge, user = _pending_sign_in(request, db)
    now = utcnow()
    claimed = challenges.claim(db, body.challenge_id, challenges.PASSKEY_TWO_FACTOR, now)
    if check_passkey(db, settings, body.credential, claimed, user=user, now=now) is None:
        _second_step_failed(
            db,
            request,
            challenge,
            user,
            method="passkey",
            message="That passkey didn't work. Try again or use a code instead.",
        )
    return _finish_second_step(db, request, response, settings, challenge, user, method="passkey")


# ---- Passkey sign-in, without a password ----------------------------------------------


@router.post("/passkey/options", response_model=PasskeyOptions)
def passkey_sign_in_options(db: Db, settings: AppSettings) -> PasskeyOptions:
    """A challenge any of this site's passkeys can answer, including through autofill."""
    if not settings.passkeys_supported:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "passkeys_unavailable",
            "Passkeys need Cashcove to be opened by its domain name, not an IP address.",
        )
    now = utcnow()
    challenges.purge_expired(db, now)
    challenge, options = passkeys.authentication_options(settings)
    challenge_id, _ = challenges.create(
        db,
        challenges.PASSKEY_SIGN_IN,
        lifetime=challenges.PASSKEY_LIFETIME,
        now=now,
        data={"challenge": passkeys.encode_challenge(challenge)},
    )
    db.commit()
    return PasskeyOptions(challenge_id=challenge_id, options=options)


def _passkey_known(db: Db, credential_id: bytes) -> bool:
    return bool(db.scalar(select(exists().where(Passkey.credential_id == credential_id))))


@router.post("/passkey", response_model=SignInResult)
def sign_in_with_passkey(
    body: PasskeySignInRequest,
    request: Request,
    response: Response,
    db: Db,
    settings: AppSettings,
) -> SignInResult:
    now = utcnow()
    ensure_not_locked(db, [address_key(request)], now)
    claimed = challenges.claim(db, body.challenge_id, challenges.PASSKEY_SIGN_IN, now)
    passkey = check_passkey(db, settings, body.credential, claimed, user=None, now=now)
    if passkey is None:
        record_failed_attempt(db, request, user=None, email=None, method="passkey", now=now)
        credential_id = passkeys.credential_id(body.credential)
        if (
            claimed is not None
            and credential_id is not None
            and not _passkey_known(db, credential_id)
        ):
            # The browser is told, so its password manager stops offering this passkey.
            raise ApiError(
                status.HTTP_401_UNAUTHORIZED,
                "passkey_failed",
                "This passkey was removed from Cashcove. Sign in with your password instead.",
                unknown_credential=True,
            )
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "passkey_failed",
            "That passkey didn't work here. Try again, or sign in with your password.",
            unknown_credential=False,
        )
    if not passkey.user.is_active:
        db.commit()
        raise ApiError(status.HTTP_403_FORBIDDEN, "account_disabled", ACCOUNT_DISABLED)
    return complete_sign_in(
        db,
        request,
        response,
        settings,
        passkey.user,
        remember=body.remember,
        method="passkey",
        now=now,
    )


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(auth: CurrentAuth, request: Request, response: Response, db: Db) -> None:
    db.delete(auth.session)
    audit.record(db, request, Event.SIGNED_OUT, user=auth.user)
    db.commit()
    sessions.clear_cookie(response, sessions.SESSION_COOKIE)


# ---- Invitations and password reset links ---------------------------------------------


def _invitation_gone() -> NoReturn:
    raise ApiError(
        status.HTTP_404_NOT_FOUND,
        LINK_EXPIRED,
        "This invitation has expired or was already used. Ask for a new link.",
    )


def _invitation(db: Db, token: str) -> Invitation:
    invitation = db.scalar(
        select(Invitation).where(
            Invitation.token_hash == hash_token(token), Invitation.expires_at > utcnow()
        )
    )
    if invitation is None:
        _invitation_gone()
    return invitation


@router.post("/invitations/preview", response_model=InvitationPreview)
def preview_invitation(body: TokenRequest, db: Db) -> InvitationPreview:
    invitation = _invitation(db, body.token)
    return InvitationPreview(
        household_name=load_preferences(db).general.household_name,
        name=invitation.name,
        email=invitation.email,
        role=invitation.role,
        invited_by=invitation.invited_by.name if invitation.invited_by else None,
        expires_at=invitation.expires_at,
    )


@router.post(
    "/invitations/accept", response_model=SessionState, status_code=status.HTTP_201_CREATED
)
def accept_invitation(
    body: AcceptInvitationRequest,
    request: Request,
    response: Response,
    db: Db,
    settings: AppSettings,
) -> SessionState:
    """Creates the invited person's account and signs them in.

    The invitation is used up first, so of two requests racing with one link only one gets
    it. Any error after that rolls the whole request back, leaving the link usable.
    """
    now = utcnow()
    claimed = db.execute(
        delete(Invitation)
        .where(Invitation.token_hash == hash_token(body.token), Invitation.expires_at > now)
        .returning(Invitation.email, Invitation.role, Invitation.invited_by_id)
    ).one_or_none()
    if claimed is None:
        _invitation_gone()
    email, role = claimed.email, claimed.role
    inviter = db.get(User, claimed.invited_by_id) if claimed.invited_by_id else None
    if problem := password_problem(body.password, email=email, name=body.name):
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, TOO_WEAK, problem)
    if db.scalar(select(exists().where(User.email == email))):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "email_taken",
            "There's already an account with this email. Sign in instead.",
        )
    user = User(
        email=email,
        name=body.name,
        role=role,
        password_hash=get_passwords(settings).hash(body.password),
        password_changed_at=now,
    )
    db.add(user)
    db.flush()
    session = sessions.start(db, request, response, user, remember=False, now=now)
    audit.record(
        db,
        request,
        Event.INVITATION_ACCEPTED,
        user=user,
        role=role.value,
        invited_by=inviter.name if inviter else None,
    )
    db.commit()
    return session_state(db, settings, session)


def _reset_gone() -> NoReturn:
    raise ApiError(
        status.HTTP_404_NOT_FOUND,
        LINK_EXPIRED,
        "This link has expired or was already used. Ask an admin for a new one.",
    )


def _password_reset(db: Db, token: str) -> PasswordReset:
    reset = db.scalar(
        select(PasswordReset).where(
            PasswordReset.token_hash == hash_token(token), PasswordReset.expires_at > utcnow()
        )
    )
    if reset is None or not reset.user.is_active:
        _reset_gone()
    return reset


@router.post("/password-resets/preview", response_model=PasswordResetPreview)
def preview_password_reset(body: TokenRequest, db: Db) -> PasswordResetPreview:
    reset = _password_reset(db, body.token)
    return PasswordResetPreview(
        name=reset.user.name, email=reset.user.email, expires_at=reset.expires_at
    )


@router.post("/password-resets/complete", status_code=status.HTTP_204_NO_CONTENT)
def complete_password_reset(
    body: CompletePasswordResetRequest, request: Request, db: Db, settings: AppSettings
) -> None:
    """Sets a new password and signs the person out everywhere; they then sign in as usual.

    As with invitations, the link is used up first and any later error rolls that back.
    """
    now = utcnow()
    user_id = db.scalar(
        delete(PasswordReset)
        .where(PasswordReset.token_hash == hash_token(body.token), PasswordReset.expires_at > now)
        .returning(PasswordReset.user_id)
    )
    user = db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        _reset_gone()
    if problem := password_problem(body.password, email=user.email, name=user.name):
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, TOO_WEAK, problem)
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    user.password_hash = get_passwords(settings).hash(body.password)
    user.password_changed_at = now
    sessions.end_all(db, user)
    throttle.clear(db, email_key(user.email))
    audit.record(db, request, Event.PASSWORD_RESET, user=user)
    db.commit()
