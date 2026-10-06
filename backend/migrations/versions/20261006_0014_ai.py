"""AI: the household's provider, what it recommends for transactions, and what it costs.

Four tables: which provider and model the household uses (with its key, encrypted), each review
the AI makes of how transactions are sorted, the categories it recommends in them, and every
answer it gives, as tokens and a cost, for the usage page. None of them holds account
information.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-06
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SETTINGS = "ai_settings"
REVIEWS = "ai_reviews"
RECOMMENDATIONS = "ai_recommendations"
USAGE = "ai_usage"

# Stored as text; each table's CHECK constraints limit them to these values.
PROVIDERS = ("ollama_local", "ollama_cloud", "anthropic", "openai")
SOURCES = ("manual", "import")
STATUSES = ("pending", "running", "done", "failed")
CONFIDENCES = ("high", "medium", "low")
DECISIONS = ("open", "applied", "dismissed")
PURPOSES = ("chat", "review", "test")


def _enum(values: Sequence[str], name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=16)


def _check(table: str, name: str, column: str, values: Sequence[str]) -> sa.CheckConstraint:
    listed = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column} IN ({listed})", name=op.f(f"ck_{table}_{name}"))


def _when(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False)


def _stamp(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def _link(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        [f"{target}.id"],
        name=op.f(f"fk_{table}_{column}_{target}"),
        ondelete=ondelete,
    )


def upgrade() -> None:
    op.create_table(
        SETTINGS,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider", _enum(PROVIDERS, "ai_provider"), nullable=False),
        sa.Column("base_url", sa.String(length=255), nullable=True),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("api_key", sa.String(length=1024), nullable=True),
        sa.Column("review_imports", sa.Boolean(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=True),
        _stamp("created_at"),
        _stamp("updated_at"),
        _check(SETTINGS, "ai_provider", "provider", PROVIDERS),
        _link(SETTINGS, "updated_by_id", "users", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_settings")),
        if_not_exists=True,
    )
    op.create_table(
        REVIEWS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source", _enum(SOURCES, "review_source"), nullable=False),
        sa.Column("status", _enum(STATUSES, "review_status"), nullable=False),
        sa.Column("import_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("provider", _enum(PROVIDERS, "ai_provider"), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("reviewed", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=300), nullable=True),
        _when("created_at"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        _check(REVIEWS, "review_source", "source", SOURCES),
        _check(REVIEWS, "review_status", "status", STATUSES),
        _check(REVIEWS, "ai_provider", "provider", PROVIDERS),
        _link(REVIEWS, "import_id", "file_imports", "SET NULL"),
        _link(REVIEWS, "created_by_id", "users", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_reviews")),
        if_not_exists=True,
    )
    op.create_index(op.f("ix_ai_reviews_created_at"), REVIEWS, ["created_at"], if_not_exists=True)
    op.create_index(op.f("ix_ai_reviews_import_id"), REVIEWS, ["import_id"], if_not_exists=True)
    op.create_index(op.f("ix_ai_reviews_status"), REVIEWS, ["status"], if_not_exists=True)
    op.create_table(
        RECOMMENDATIONS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("current_category_id", sa.Uuid(), nullable=True),
        sa.Column("suggested_category_id", sa.Uuid(), nullable=False),
        sa.Column("confidence", _enum(CONFIDENCES, "ai_confidence"), nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=False),
        sa.Column("status", _enum(DECISIONS, "recommendation_status"), nullable=False),
        _when("created_at"),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", sa.Uuid(), nullable=True),
        _check(RECOMMENDATIONS, "ai_confidence", "confidence", CONFIDENCES),
        _check(RECOMMENDATIONS, "recommendation_status", "status", DECISIONS),
        _link(RECOMMENDATIONS, "review_id", "ai_reviews", "CASCADE"),
        _link(RECOMMENDATIONS, "transaction_id", "transactions", "CASCADE"),
        _link(RECOMMENDATIONS, "current_category_id", "categories", "SET NULL"),
        _link(RECOMMENDATIONS, "suggested_category_id", "categories", "CASCADE"),
        _link(RECOMMENDATIONS, "decided_by_id", "users", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_recommendations")),
        sa.UniqueConstraint(
            "transaction_id",
            "suggested_category_id",
            name="uq_ai_recommendations_transaction_id_suggested_category_id",
        ),
        if_not_exists=True,
    )
    op.create_index(
        op.f("ix_ai_recommendations_review_id"), RECOMMENDATIONS, ["review_id"], if_not_exists=True
    )
    op.create_index(
        op.f("ix_ai_recommendations_transaction_id"),
        RECOMMENDATIONS,
        ["transaction_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_ai_recommendations_status_created_at",
        RECOMMENDATIONS,
        ["status", "created_at"],
        if_not_exists=True,
    )
    op.create_table(
        USAGE,
        sa.Column("id", sa.Uuid(), nullable=False),
        _when("created_at"),
        sa.Column("provider", _enum(PROVIDERS, "ai_provider"), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("purpose", _enum(PURPOSES, "ai_purpose"), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_micros", sa.BigInteger(), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("review_id", sa.Uuid(), nullable=True),
        _check(USAGE, "ai_provider", "provider", PROVIDERS),
        _check(USAGE, "ai_purpose", "purpose", PURPOSES),
        _link(USAGE, "user_id", "users", "SET NULL"),
        _link(USAGE, "review_id", "ai_reviews", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_usage")),
        if_not_exists=True,
    )
    op.create_index(op.f("ix_ai_usage_created_at"), USAGE, ["created_at"], if_not_exists=True)
    op.create_index(op.f("ix_ai_usage_review_id"), USAGE, ["review_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_ai_usage_review_id"), table_name=USAGE, if_exists=True)
    op.drop_index(op.f("ix_ai_usage_created_at"), table_name=USAGE, if_exists=True)
    op.drop_table(USAGE, if_exists=True)
    op.drop_index(
        "ix_ai_recommendations_status_created_at", table_name=RECOMMENDATIONS, if_exists=True
    )
    op.drop_index(
        op.f("ix_ai_recommendations_transaction_id"), table_name=RECOMMENDATIONS, if_exists=True
    )
    op.drop_index(
        op.f("ix_ai_recommendations_review_id"), table_name=RECOMMENDATIONS, if_exists=True
    )
    op.drop_table(RECOMMENDATIONS, if_exists=True)
    op.drop_index(op.f("ix_ai_reviews_status"), table_name=REVIEWS, if_exists=True)
    op.drop_index(op.f("ix_ai_reviews_import_id"), table_name=REVIEWS, if_exists=True)
    op.drop_index(op.f("ix_ai_reviews_created_at"), table_name=REVIEWS, if_exists=True)
    op.drop_table(REVIEWS, if_exists=True)
    op.drop_table(SETTINGS, if_exists=True)
