"""Encrypted Discord and SMTP settings, plus alert delivery state.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-09
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ALERT_SETTINGS = "alert_settings"
ALERT_STATES = "alert_states"
ALERT_DELIVERIES = "alert_deliveries"
ALERT_TYPES = (
    "subscription_due",
    "bill_due",
    "low_balance",
    "large_transaction",
    "budget_threshold",
    "sync_failure",
)
CHANNELS = ("discord", "email")
SMTP_TRANSPORTS = ("starttls", "ssl", "none")


def _stamp(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def _enum(values: Sequence[str], name: str, length: int) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=length, create_constraint=True)


def upgrade() -> None:
    op.create_table(
        ALERT_SETTINGS,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("discord_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("discord_webhook_url", sa.String(length=4096), nullable=True),
        sa.Column("smtp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("smtp_host", sa.String(length=255), nullable=True),
        sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column(
            "smtp_security",
            _enum(SMTP_TRANSPORTS, "smtp_transport", 16),
            nullable=False,
            server_default="starttls",
        ),
        sa.Column("smtp_username", sa.String(length=1024), nullable=True),
        sa.Column("smtp_password", sa.String(length=1024), nullable=True),
        sa.Column("smtp_from", sa.String(length=254), nullable=True),
        sa.Column("smtp_to", sa.String(length=254), nullable=True),
        sa.Column("updated_by_id", sa.Uuid(), nullable=True),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_alert_settings_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alert_settings")),
        if_not_exists=True,
    )
    op.create_table(
        ALERT_STATES,
        sa.Column("key", sa.String(length=180), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("episode", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_alert_states")),
        if_not_exists=True,
    )
    op.create_table(
        ALERT_DELIVERIES,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_key", sa.String(length=255), nullable=False),
        sa.Column("alert_type", _enum(ALERT_TYPES, "alert_type", 24), nullable=False),
        sa.Column("channel", _enum(CHANNELS, "alert_channel", 16), nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=64), nullable=True),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alert_deliveries")),
        sa.UniqueConstraint(
            "event_key",
            "channel",
            name=op.f("uq_alert_deliveries_event_key_channel"),
        ),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table(ALERT_DELIVERIES, if_exists=True)
    op.drop_table(ALERT_STATES, if_exists=True)
    op.drop_table(ALERT_SETTINGS, if_exists=True)
