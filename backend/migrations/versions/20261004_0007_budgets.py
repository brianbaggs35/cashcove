"""Budgets for categories, by the month or by the budget year

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-04
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BUDGETS = "budgets"
BUDGET_AMOUNTS = "budget_amounts"
# Amounts of money are whole numbers of cents.
MONEY = sa.BigInteger()

# Stored as text; the table's CHECK constraint limits it to these values.
PERIODS = ("monthly", "yearly")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _now(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        BUDGETS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column(
            "period",
            sa.Enum(*PERIODS, name="budget_period", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("rollover_since", sa.Date(), nullable=True),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint(_in("period", PERIODS), name=op.f("ck_budgets_budget_period")),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_budgets_category_id_categories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budgets")),
        sa.UniqueConstraint("category_id", name=op.f("uq_budgets_category_id")),
    )
    op.create_table(
        BUDGET_AMOUNTS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("amount", MONEY, nullable=True),
        sa.CheckConstraint("amount >= 0", name=op.f("ck_budget_amounts_amount_not_negative")),
        sa.CheckConstraint(
            "extract(day from starts_on) = 1",
            name=op.f("ck_budget_amounts_starts_on_first_of_month"),
        ),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [f"{BUDGETS}.id"],
            name=op.f("fk_budget_amounts_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_amounts")),
        sa.UniqueConstraint(
            "budget_id", "starts_on", name=op.f("uq_budget_amounts_budget_id_starts_on")
        ),
    )


def downgrade() -> None:
    op.drop_table(BUDGET_AMOUNTS)
    op.drop_table(BUDGETS)
