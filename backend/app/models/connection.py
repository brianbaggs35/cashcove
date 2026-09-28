"""Links to banks through a service like Plaid, which keep the household's accounts up to date."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import JSON_TYPE
from app.models.base import Base, TimestampMixin, UTCDateTime, enum_type


class ConnectionProvider(StrEnum):
    PLAID = "plaid"


class ConnectionStatus(StrEnum):
    """Whether a connection is syncing, and if not, what it needs."""

    HEALTHY = "healthy"
    # The bank wants someone to sign in again (or agree to share again) before it shares
    # anything new, which only a person can do.
    LOGIN_REQUIRED = "login_required"
    # The last sync failed for another reason. The next one tries again.
    ERROR = "error"


class HistoryStatus(StrEnum):
    """How much of a new connection's transaction history has arrived."""

    # Nothing yet: the provider is still fetching it from the bank.
    PENDING = "pending"
    # The last 30 days or so; older history is still on its way.
    RECENT = "recent"
    # Everything that was asked for.
    COMPLETE = "complete"


class SyncTrigger(StrEnum):
    """What started a sync."""

    # Right after a bank was connected, while its history comes in.
    LINKED = "linked"
    # The schedule chosen in Settings > Sync.
    SCHEDULED = "scheduled"
    # Someone pressed Sync now.
    MANUAL = "manual"
    # Someone signed in to the bank again, or chose which accounts it shares.
    RECONNECTED = "reconnected"


class Connection(TimestampMixin, Base):
    __tablename__ = "connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    provider: Mapped[ConnectionProvider] = mapped_column(
        enum_type(ConnectionProvider, "connection_provider")
    )
    # The provider's own ID for it: Plaid's item_id.
    external_id: Mapped[str] = mapped_column(String(255), unique=True)
    # What Cashcove reads the bank's data with (Plaid's access token), encrypted with the app
    # secret. It's never logged or sent to the browser.
    access_token: Mapped[str] = mapped_column(String(512))
    institution_id: Mapped[str | None] = mapped_column(String(64))
    institution_name: Mapped[str] = mapped_column(String(120))
    institution_url: Mapped[str | None] = mapped_column(String(255))
    # The bank's brand color ("#0a4d8c") and logo (a base64 PNG), to show which bank it is.
    institution_color: Mapped[str | None] = mapped_column(String(7))
    institution_logo: Mapped[str | None] = mapped_column(Text())
    status: Mapped[ConnectionStatus] = mapped_column(
        enum_type(ConnectionStatus, "connection_status")
    )
    # Why the last sync failed: the provider's error code, and what to tell people.
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(String(500))
    # Some banks only share for so long before someone has to agree again.
    consent_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    # Every account the bank shares, as of the last sync: Plaid's account_id, name, mask, type
    # and balance for each, so people can choose which ones to import.
    available_accounts: Mapped[list[dict[str, Any]]] = mapped_column(JSON_TYPE, default=list)
    # The Plaid account_ids of the shared accounts the household chose not to import. Any that
    # are neither imported nor skipped are new, and waiting for someone to choose.
    skipped_accounts: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list)
    history: Mapped[HistoryStatus] = mapped_column(enum_type(HistoryStatus, "history_status"))
    # When a sync last finished without an error, and when one was last tried at all.
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    # Set while a sync runs, so the schedule and Sync now never run one at the same time.
    sync_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class ConnectionSync(Base):
    """One finished sync of a connection, for its recent history on the Connect tab."""

    __tablename__ = "connection_syncs"
    __table_args__ = (
        Index("ix_connection_syncs_connection_id_started_at", "connection_id", "started_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("connections.id", ondelete="CASCADE")
    )
    trigger: Mapped[SyncTrigger] = mapped_column(enum_type(SyncTrigger, "sync_trigger"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime())
    finished_at: Mapped[datetime] = mapped_column(UTCDateTime())
    succeeded: Mapped[bool] = mapped_column()
    # Transactions that came in, changed or were dropped by the bank.
    added: Mapped[int] = mapped_column(default=0)
    updated: Mapped[int] = mapped_column(default=0)
    removed: Mapped[int] = mapped_column(default=0)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(String(500))
