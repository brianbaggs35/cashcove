"""Encrypted delivery settings and the state needed to send each alert only when it changes."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UTCDateTime, enum_type

ALERT_SETTINGS_ID = 1


class AlertType(StrEnum):
    SUBSCRIPTION_DUE = "subscription_due"
    BILL_DUE = "bill_due"
    LOW_BALANCE = "low_balance"
    LARGE_TRANSACTION = "large_transaction"
    BUDGET_THRESHOLD = "budget_threshold"
    SYNC_FAILURE = "sync_failure"


class AlertChannel(StrEnum):
    DISCORD = "discord"
    EMAIL = "email"


class SMTPTransport(StrEnum):
    STARTTLS = "starttls"
    SSL = "ssl"
    NONE = "none"


class AlertSettings(TimestampMixin, Base):
    """Household-wide delivery settings. Credentials are encrypted before they reach these
    columns and never leave the server in a response.
    """

    __tablename__ = "alert_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=ALERT_SETTINGS_ID)
    discord_enabled: Mapped[bool] = mapped_column(Boolean(), default=False)
    discord_webhook_url: Mapped[str | None] = mapped_column(String(4096))
    smtp_enabled: Mapped[bool] = mapped_column(Boolean(), default=False)
    smtp_host: Mapped[str | None] = mapped_column(String(255))
    smtp_port: Mapped[int] = mapped_column(default=587)
    smtp_security: Mapped[SMTPTransport] = mapped_column(
        enum_type(SMTPTransport, "smtp_transport"),
        default=SMTPTransport.STARTTLS,
        server_default=SMTPTransport.STARTTLS.value,
    )
    smtp_username: Mapped[str | None] = mapped_column(String(1024))
    smtp_password: Mapped[str | None] = mapped_column(String(1024))
    smtp_from: Mapped[str | None] = mapped_column(String(254))
    smtp_to: Mapped[str | None] = mapped_column(String(254))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class AlertState(Base):
    """Whether a continuous alert condition is active, and which crossing into it this is."""

    __tablename__ = "alert_states"

    key: Mapped[str] = mapped_column(String(180), primary_key=True)
    active: Mapped[bool] = mapped_column(Boolean(), default=False)
    episode: Mapped[int] = mapped_column(Integer(), default=0)


class AlertDelivery(TimestampMixin, Base):
    """One attempt to deliver an alert through one channel. Failed sends are retried by the
    alert worker; successful sends are not repeated.
    """

    __tablename__ = "alert_deliveries"
    __table_args__ = (
        UniqueConstraint("event_key", "channel", name="uq_alert_deliveries_event_key_channel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_key: Mapped[str] = mapped_column(String(255))
    alert_type: Mapped[AlertType] = mapped_column(enum_type(AlertType, "alert_type", length=24))
    channel: Mapped[AlertChannel] = mapped_column(enum_type(AlertChannel, "alert_channel"))
    subject_id: Mapped[uuid.UUID | None] = mapped_column()
    attempts: Mapped[int] = mapped_column(Integer(), default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_error: Mapped[str | None] = mapped_column(String(64))
