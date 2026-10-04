"""Automations that sort transactions into a category and link them to a subscription, and
subscriptions whose amount changes every time.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-05
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUTOMATIONS = "automations"
SUBSCRIPTIONS = "subscriptions"

# Stored as text; the table's CHECK constraints limit them to these values.
SCOPES = ("all", "future")
MATCHES = ("exact", "starts_with", "contains")


def _now(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        AUTOMATIONS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("payees", postgresql.ARRAY(sa.String(length=160)), nullable=False),
        sa.Column(
            "match",
            sa.Enum(*MATCHES, name="automation_match", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("min_amount", sa.BigInteger(), nullable=True),
        sa.Column("max_amount", sa.BigInteger(), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("subscription_id", sa.Uuid(), nullable=True),
        sa.Column(
            "apply_to",
            sa.Enum(*SCOPES, name="automation_scope", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint(
            "apply_to IN ('all', 'future')", name=op.f("ck_automations_automation_scope")
        ),
        sa.CheckConstraint(
            "match IN ('exact', 'starts_with', 'contains')",
            name=op.f("ck_automations_automation_match"),
        ),
        sa.CheckConstraint("cardinality(payees) > 0", name=op.f("ck_automations_has_a_payee")),
        sa.CheckConstraint(
            "min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount",
            name=op.f("ck_automations_amounts_in_order"),
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_automations_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_automations_category_id_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["subscriptions.id"],
            name=op.f("fk_automations_subscription_id_subscriptions"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_automations")),
    )
    op.create_index(op.f("ix_automations_account_id"), AUTOMATIONS, ["account_id"])
    op.create_index(op.f("ix_automations_category_id"), AUTOMATIONS, ["category_id"])
    op.create_index(op.f("ix_automations_subscription_id"), AUTOMATIONS, ["subscription_id"])
    op.add_column(
        SUBSCRIPTIONS,
        sa.Column("amount_varies", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column(SUBSCRIPTIONS, "amount_varies")
    op.drop_index(op.f("ix_automations_subscription_id"), table_name=AUTOMATIONS)
    op.drop_index(op.f("ix_automations_category_id"), table_name=AUTOMATIONS)
    op.drop_index(op.f("ix_automations_account_id"), table_name=AUTOMATIONS)
    op.drop_table(AUTOMATIONS)
