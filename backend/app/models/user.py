"""People who can sign in to Cashcove."""

import secrets
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UTCDateTime, enum_type, utcnow


class Role(StrEnum):
    """Admins can do everything; viewers can see everything and change nothing."""

    ADMIN = "admin"
    VIEWER = "viewer"


ROLE_TYPE = enum_type(Role, "role")


def new_webauthn_id() -> bytes:
    return secrets.token_bytes(32)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    # Stored lowercased; it's what people sign in with.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[Role] = mapped_column(ROLE_TYPE)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    # The opaque handle passkeys are registered under, so they never carry personal data.
    webauthn_id: Mapped[bytes] = mapped_column(
        LargeBinary(64), unique=True, default=new_webauthn_id
    )
    # Authenticator-app key, encrypted with the app secret; None until it's turned on.
    totp_secret: Mapped[str | None] = mapped_column(String(255))
    # The last 30-second step a code was accepted for, so no code can be used twice.
    totp_last_step: Mapped[int | None] = mapped_column(BigInteger())
    password_changed_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    last_sign_in_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    @property
    def totp_enabled(self) -> bool:
        return self.totp_secret is not None
