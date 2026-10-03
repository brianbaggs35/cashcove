"""Recurring payments and their transaction links.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-03
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIPTIONS = "subscriptions"
TRANSACTIONS = "transactions"


def _timestamp(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    op.create_table(
        SUBSCRIPTIONS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("payee", sa.String(length=160), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column(
            "frequency",
            sa.Enum(
                "weekly",
                "biweekly",
                "monthly",
                "quarterly",
                "semiannual",
                "annual",
                name="payment_frequency",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("next_due_date", sa.Date(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_subscriptions_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_subscriptions_category_id_categories"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscriptions")),
    )
    op.create_index(op.f("ix_subscriptions_account_id"), SUBSCRIPTIONS, ["account_id"])
    op.create_index(op.f("ix_subscriptions_category_id"), SUBSCRIPTIONS, ["category_id"])
    op.create_index(op.f("ix_subscriptions_payee"), SUBSCRIPTIONS, ["payee"])
    op.add_column(TRANSACTIONS, sa.Column("subscription_id", sa.Uuid(), nullable=True))
    op.create_index(
        op.f("ix_transactions_subscription_id"), TRANSACTIONS, ["subscription_id"]
    )
    op.create_foreign_key(
        op.f("fk_transactions_subscription_id_subscriptions"),
        TRANSACTIONS,
        SUBSCRIPTIONS,
        ["subscription_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_transactions_subscription_id_subscriptions"),
        TRANSACTIONS,
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_transactions_subscription_id"), table_name=TRANSACTIONS)
    op.drop_column(TRANSACTIONS, "subscription_id")
    op.drop_index(op.f("ix_subscriptions_payee"), table_name=SUBSCRIPTIONS)
    op.drop_index(op.f("ix_subscriptions_category_id"), table_name=SUBSCRIPTIONS)
    op.drop_index(op.f("ix_subscriptions_account_id"), table_name=SUBSCRIPTIONS)
    op.drop_table(SUBSCRIPTIONS)
