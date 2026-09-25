"""Sign-in state: sessions, passkeys, recovery codes, one-time links and lockouts."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, ForeignKey, LargeBinary, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, utcnow
from app.models.user import ROLE_TYPE, Role, User

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


def _user_fk(*, index: bool = True) -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=index)


class UserSession(Base):
    """A signed-in browser. The cookie holds a random token; only its hash is stored."""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = _user_fk()
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    remember: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    # When the person last proved who they are, for actions that need a recent check.
    verified_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(lazy="joined")


class Passkey(Base):
    __tablename__ = "passkeys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = _user_fk()
    credential_id: Mapped[bytes] = mapped_column(LargeBinary(1023), unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary())
    sign_count: Mapped[int] = mapped_column(BigInteger(), default=0)
    transports: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list)
    aaguid: Mapped[str] = mapped_column(String(36))
    # Synced passkeys (iCloud Keychain, Google Password Manager) report being backed up.
    backed_up: Mapped[bool] = mapped_column(default=False)
    name: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    user: Mapped[User] = relationship()


class RecoveryCode(Base):
    """A one-time code for signing in without the authenticator app; stored hashed."""

    __tablename__ = "recovery_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = _user_fk()
    code_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class AuthChallenge(Base):
    """Short-lived, single-use state between the steps of a sign-in or enrollment."""

    __tablename__ = "auth_challenges"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    purpose: Mapped[str] = mapped_column(String(32))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict)
    attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())


class Invitation(Base):
    """A one-time link an admin shares so someone can create their own account."""

    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[Role] = mapped_column(ROLE_TYPE)
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())

    invited_by: Mapped[User | None] = relationship(lazy="joined")


class PasswordReset(Base):
    """A one-time link an admin creates for someone who forgot their password."""

    __tablename__ = "password_resets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    user_id: Mapped[uuid.UUID] = _user_fk()
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())

    user: Mapped[User] = relationship(lazy="joined", foreign_keys=[user_id])


class LoginThrottle(Base):
    """Failed attempts per email address or client address, shared by every API worker."""

    __tablename__ = "login_throttles"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    failures: Mapped[int] = mapped_column(default=0)
    last_failure_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime())
