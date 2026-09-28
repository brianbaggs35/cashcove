"""Bank connections through Plaid, and their sync history

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-27
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACCOUNTS = "accounts"
CONNECTIONS = "connections"
CONNECTION_SYNCS = "connection_syncs"
CONNECTION_ID = "connection_id"
SYNC_CURSOR = "sync_cursor"
JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

# Stored as text; each table's CHECK constraint limits it to these values.
PROVIDERS = ("plaid",)
STATUSES = ("healthy", "login_required", "error")
HISTORY = ("pending", "recent", "complete")
TRIGGERS = ("linked", "scheduled", "manual", "reconnected")


def _enum(values: Sequence[str], name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=16)


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _timestamp(name: str, *, nullable: bool = True) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        CONNECTIONS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider", _enum(PROVIDERS, "connection_provider"), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("access_token", sa.String(length=512), nullable=False),
        sa.Column("institution_id", sa.String(length=64), nullable=True),
        sa.Column("institution_name", sa.String(length=120), nullable=False),
        sa.Column("institution_url", sa.String(length=255), nullable=True),
        sa.Column("institution_color", sa.String(length=7), nullable=True),
        sa.Column("institution_logo", sa.Text(), nullable=True),
        sa.Column("status", _enum(STATUSES, "connection_status"), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        _timestamp("consent_expires_at"),
        sa.Column("available_accounts", JSON, nullable=False),
        sa.Column("skipped_accounts", JSON, nullable=False),
        sa.Column("history", _enum(HISTORY, "history_status"), nullable=False),
        _timestamp("last_synced_at"),
        _timestamp("last_attempt_at"),
        _timestamp("sync_started_at"),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            _in("provider", PROVIDERS), name=op.f("ck_connections_connection_provider")
        ),
        sa.CheckConstraint(_in("status", STATUSES), name=op.f("ck_connections_connection_status")),
        sa.CheckConstraint(_in("history", HISTORY), name=op.f("ck_connections_history_status")),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_connections_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_connections")),
        sa.UniqueConstraint("external_id", name=op.f("uq_connections_external_id")),
    )
    op.create_table(
        CONNECTION_SYNCS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(CONNECTION_ID, sa.Uuid(), nullable=False),
        sa.Column("trigger", _enum(TRIGGERS, "sync_trigger"), nullable=False),
        _timestamp("started_at", nullable=False),
        _timestamp("finished_at", nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("added", sa.Integer(), nullable=False),
        sa.Column("updated", sa.Integer(), nullable=False),
        sa.Column("removed", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.CheckConstraint(_in("trigger", TRIGGERS), name=op.f("ck_connection_syncs_sync_trigger")),
        sa.ForeignKeyConstraint(
            [CONNECTION_ID],
            [f"{CONNECTIONS}.id"],
            name=op.f("fk_connection_syncs_connection_id_connections"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_connection_syncs")),
    )
    op.create_index(
        "ix_connection_syncs_connection_id_started_at",
        CONNECTION_SYNCS,
        [CONNECTION_ID, "started_at"],
        unique=False,
    )
    op.add_column(ACCOUNTS, sa.Column(CONNECTION_ID, sa.Uuid(), nullable=True))
    op.add_column(ACCOUNTS, sa.Column(SYNC_CURSOR, sa.Text(), nullable=True))
    op.create_index(op.f("ix_accounts_connection_id"), ACCOUNTS, [CONNECTION_ID], unique=False)
    op.create_foreign_key(
        op.f("fk_accounts_connection_id_connections"),
        ACCOUNTS,
        CONNECTIONS,
        [CONNECTION_ID],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_accounts_connection_id_connections"), ACCOUNTS, type_="foreignkey")
    op.drop_index(op.f("ix_accounts_connection_id"), table_name=ACCOUNTS)
    op.drop_column(ACCOUNTS, SYNC_CURSOR)
    op.drop_column(ACCOUNTS, CONNECTION_ID)
    op.drop_table(CONNECTION_SYNCS)
    op.drop_table(CONNECTIONS)
