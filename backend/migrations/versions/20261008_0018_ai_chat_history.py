"""AI chat history, scoped to the admin who had the conversation.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-08
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONVERSATIONS = "ai_conversations"
JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def _stamp(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        CONVERSATIONS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("messages", JSON, nullable=False),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_ai_conversations_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_conversations")),
        if_not_exists=True,
    )
    op.create_index(
        "ix_ai_conversations_user_id_updated_at",
        CONVERSATIONS,
        ["user_id", "updated_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_conversations_user_id_updated_at", table_name=CONVERSATIONS, if_exists=True
    )
    op.drop_table(CONVERSATIONS, if_exists=True)
