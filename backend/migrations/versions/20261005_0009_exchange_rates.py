"""Exchange rates, to count accounts in other currencies in the household's.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exchange_rates",
        sa.Column("base", sa.String(length=3), nullable=False),
        sa.Column("quote", sa.String(length=3), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("rate", sa.Numeric(precision=24, scale=12), nullable=False),
        sa.CheckConstraint("rate > 0", name=op.f("ck_exchange_rates_rate_positive")),
        sa.PrimaryKeyConstraint("base", "quote", "day", name=op.f("pk_exchange_rates")),
    )
    op.create_table(
        "exchange_rate_spans",
        sa.Column("base", sa.String(length=3), nullable=False),
        sa.Column("quote", sa.String(length=3), nullable=False),
        sa.Column("first_day", sa.Date(), nullable=False),
        sa.Column("last_day", sa.Date(), nullable=False),
        sa.CheckConstraint(
            "first_day <= last_day", name=op.f("ck_exchange_rate_spans_days_in_order")
        ),
        sa.PrimaryKeyConstraint("base", "quote", name=op.f("pk_exchange_rate_spans")),
    )


def downgrade() -> None:
    op.drop_table("exchange_rate_spans")
    op.drop_table("exchange_rates")
