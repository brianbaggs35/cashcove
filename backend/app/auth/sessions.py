"""Server-side sessions carried by an HttpOnly, Secure, SameSite=Strict cookie.

The cookie holds a random token and the database only its SHA-256, so neither a stolen
database nor a stolen backup lets anyone take over a session. The ``__Host-`` prefix makes
browsers refuse the cookie unless it's Secure, host-only and scoped to the whole site.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Request, Response
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.auth.audit import client_address, client_agent
from app.auth.tokens import hash_token, new_token
from app.models import User, UserSession

SESSION_COOKIE = "__Host-cashcove_session"
# Carries a sign-in that passed the password but still needs its second step.
TWO_FACTOR_COOKIE = "__Host-cashcove_2fa"


@dataclass(frozen=True)
class Lifetime:
    idle: timedelta
    absolute: timedelta


STANDARD = Lifetime(idle=timedelta(hours=1), absolute=timedelta(hours=12))
# "Keep me signed in on this device".
REMEMBERED = Lifetime(idle=timedelta(days=14), absolute=timedelta(days=30))

# Changing a password, two-step settings or passkeys needs proof of identity this recent.
RECENT_VERIFICATION = timedelta(minutes=10)
# last_seen_at is written at most this often, so reads don't each cost a write.
TOUCH_INTERVAL = timedelta(minutes=1)


def lifetime(session: UserSession) -> Lifetime:
    return REMEMBERED if session.remember else STANDARD


def idle_deadline(session: UserSession) -> datetime:
    return min(session.last_seen_at + lifetime(session).idle, session.expires_at)


def start(
    db: Session, request: Request, response: Response, user: User, *, remember: bool, now: datetime
) -> UserSession:
    """Signs a user in on this browser with a brand-new session token."""
    token = new_token()
    policy = REMEMBERED if remember else STANDARD
    session = UserSession(
        id=uuid.uuid4(),
        user=user,
        user_id=user.id,
        token_hash=hash_token(token),
        csrf_token=secrets.token_urlsafe(32),
        remember=remember,
        created_at=now,
        last_seen_at=now,
        verified_at=now,
        expires_at=now + policy.absolute,
        ip_address=client_address(request),
        user_agent=client_agent(request),
    )
    db.add(session)
    user.last_sign_in_at = now
    purge_expired(db, user, now)
    set_cookie(response, SESSION_COOKIE, token, max_age=policy.absolute if remember else None)
    return session


def load(db: Session, token: str | None, now: datetime) -> UserSession | None:
    """The live session for a cookie value, or None if it's unknown, expired or idle."""
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session is None or not session.user.is_active or now >= idle_deadline(session):
        return None
    return session


def end(db: Session, token: str | None) -> None:
    """Ends the session a cookie belongs to, whatever state it's in."""
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))


def touch(session: UserSession, now: datetime) -> None:
    if now - session.last_seen_at >= TOUCH_INTERVAL:
        session.last_seen_at = now


def purge_expired(db: Session, user: User, now: datetime) -> None:
    db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id,
            or_(
                UserSession.expires_at <= now,
                UserSession.last_seen_at <= now - REMEMBERED.idle,
                (UserSession.remember.is_(False))
                & (UserSession.last_seen_at <= now - STANDARD.idle),
            ),
        )
    )


def end_all(db: Session, user: User, *, keep: UserSession | None = None) -> int:
    """Signs a user out everywhere, optionally except the current browser."""
    query = delete(UserSession).where(UserSession.user_id == user.id)
    if keep is not None:
        query = query.where(UserSession.id != keep.id)
    return len(db.scalars(query.returning(UserSession.id)).all())


def set_cookie(response: Response, name: str, value: str, *, max_age: timedelta | None) -> None:
    response.set_cookie(
        name,
        value,
        max_age=int(max_age.total_seconds()) if max_age else None,
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )


def clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/", secure=True, httponly=True, samesite="strict")
