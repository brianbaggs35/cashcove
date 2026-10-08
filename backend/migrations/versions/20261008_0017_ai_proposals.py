"""AI: changes the AI proposes, kept until an admin approves or turns them down.

One table, `ai_proposals`: each proposal has the changes in order, what the AI said with them, who
it was for, and how it was decided (who, when, and what they said when they turned it down). It is
a record of what the AI was allowed to do, and holds no account information that an AI was given.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-08
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROPOSALS = "ai_proposals"
JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")
SET_NULL = "SET NULL"

# Stored as text; CHECK constraints limit them to these values, as they do for the rest of AI.
PROVIDERS = ("ollama_local", "ollama_cloud", "anthropic", "openai")
STATUSES = ("pending", "approved", "rejected")


def _enum(values: Sequence[str], name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=16)


def _check(name: str, column: str, values: Sequence[str]) -> sa.CheckConstraint:
    listed = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column} IN ({listed})", name=op.f(f"ck_{PROPOSALS}_{name}"))


def _when(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False)


def _user(column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        ["users.id"],
        name=op.f(f"fk_{PROPOSALS}_{column}_users"),
        ondelete=SET_NULL,
    )


def upgrade() -> None:
    op.create_table(
        PROPOSALS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("provider", _enum(PROVIDERS, "ai_provider"), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("message", sa.String(length=4000), nullable=False),
        sa.Column("steps", JSON, nullable=False),
        sa.Column("status", _enum(STATUSES, "proposal_status"), nullable=False),
        _when("created_at"),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("results", JSON, nullable=False),
        _check("ai_provider", "provider", PROVIDERS),
        _check("proposal_status", "status", STATUSES),
        _user("user_id"),
        _user("decided_by_id"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_proposals")),
        if_not_exists=True,
    )
    op.create_index(
        "ix_ai_proposals_user_id_created_at",
        PROPOSALS,
        ["user_id", "created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_ai_proposals_status_created_at",
        PROPOSALS,
        ["status", "created_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_ai_proposals_status_created_at", table_name=PROPOSALS, if_exists=True)
    op.drop_index("ix_ai_proposals_user_id_created_at", table_name=PROPOSALS, if_exists=True)
    op.drop_table(PROPOSALS, if_exists=True)
