"""Short-lived, single-use state carried between the steps of a sign-in or enrollment.

Each challenge is found by a random token the browser holds, of which only a hash is stored.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.tokens import hash_token, new_token
from app.models import AuthChallenge

# A sign-in that passed the password and still needs a code or passkey.
TWO_FACTOR = "two_factor"
# The WebAuthn challenges behind each passkey ceremony.
PASSKEY_SIGN_IN = "passkey_sign_in"
PASSKEY_TWO_FACTOR = "passkey_two_factor"
PASSKEY_VERIFY = "passkey_verify"
PASSKEY_REGISTER = "passkey_register"
# An authenticator key that's been shown but not yet confirmed with a code.
TOTP_SETUP = "totp_setup"

PASSKEY_LIFETIME = timedelta(minutes=5)


@dataclass(frozen=True)
class Claimed:
    user_id: uuid.UUID | None
    data: dict[str, Any]


def create(
    db: Session,
    purpose: str,
    *,
    lifetime: timedelta,
    now: datetime,
    user_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> tuple[str, AuthChallenge]:
    token = new_token()
    challenge = AuthChallenge(
        token_hash=hash_token(token),
        purpose=purpose,
        user_id=user_id,
        data=data or {},
        attempts=0,
        created_at=now,
        expires_at=now + lifetime,
    )
    db.add(challenge)
    return token, challenge


def find(db: Session, token: str | None, purpose: str, now: datetime) -> AuthChallenge | None:
    if not token:
        return None
    return db.scalar(
        select(AuthChallenge).where(
            AuthChallenge.token_hash == hash_token(token),
            AuthChallenge.purpose == purpose,
            AuthChallenge.expires_at > now,
        )
    )


def claim(db: Session, token: str, purpose: str, now: datetime) -> Claimed | None:
    """Uses a challenge up. Of several requests racing for it, only one gets it."""
    row = db.execute(
        delete(AuthChallenge)
        .where(
            AuthChallenge.token_hash == hash_token(token),
            AuthChallenge.purpose == purpose,
            AuthChallenge.expires_at > now,
        )
        .returning(AuthChallenge.user_id, AuthChallenge.data)
    ).one_or_none()
    return None if row is None else Claimed(user_id=row.user_id, data=row.data)


def clear(db: Session, purpose: str, user_id: uuid.UUID) -> None:
    db.execute(
        delete(AuthChallenge).where(
            AuthChallenge.purpose == purpose, AuthChallenge.user_id == user_id
        )
    )


def purge_expired(db: Session, now: datetime) -> None:
    db.execute(delete(AuthChallenge).where(AuthChallenge.expires_at <= now))
