"""Recurring budget cadences, account scopes and transaction links.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERIODS = ("weekly", "biweekly", "monthly", "yearly")
BUDGETS_ID = "budgets.id"


def upgrade() -> None:
    op.add_column("budgets", sa.Column("cycle_anchor", sa.Date(), nullable=True))
    op.drop_constraint(op.f("ck_budgets_budget_period"), "budgets", type_="check")
    op.create_check_constraint(
        op.f("ck_budgets_budget_period"),
        "budgets",
        "period IN ('weekly', 'biweekly', 'monthly', 'yearly')",
    )
    op.create_check_constraint(
        op.f("ck_budgets_recurring_budget_has_anchor"),
        "budgets",
        "period NOT IN ('weekly', 'biweekly') OR cycle_anchor IS NOT NULL",
    )
    op.create_table(
        "budget_accounts",
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [BUDGETS_ID],
            name=op.f("fk_budget_accounts_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_budget_accounts_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("budget_id", "account_id", name=op.f("pk_budget_accounts")),
    )
    op.create_index(
        op.f("ix_budget_accounts_account_id"),
        "budget_accounts",
        ["account_id"],
        unique=False,
    )
    op.create_table(
        "budget_transactions",
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [BUDGETS_ID],
            name=op.f("fk_budget_transactions_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name=op.f("fk_budget_transactions_transaction_id_transactions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("transaction_id", name=op.f("pk_budget_transactions")),
    )
    op.create_index(
        op.f("ix_budget_transactions_budget_id"),
        "budget_transactions",
        ["budget_id"],
        unique=False,
    )
    op.create_table(
        "budget_subscriptions",
        sa.Column("subscription_id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [BUDGETS_ID],
            name=op.f("fk_budget_subscriptions_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["subscriptions.id"],
            name=op.f("fk_budget_subscriptions_subscription_id_subscriptions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("subscription_id", name=op.f("pk_budget_subscriptions")),
    )
    op.create_index(
        op.f("ix_budget_subscriptions_budget_id"),
        "budget_subscriptions",
        ["budget_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_subscriptions_budget_id"), table_name="budget_subscriptions")
    op.drop_table("budget_subscriptions")
    op.drop_index(op.f("ix_budget_transactions_budget_id"), table_name="budget_transactions")
    op.drop_table("budget_transactions")
    op.drop_index(op.f("ix_budget_accounts_account_id"), table_name="budget_accounts")
    op.drop_table("budget_accounts")
    op.drop_constraint(
        op.f("ck_budgets_recurring_budget_has_anchor"),
        "budgets",
        type_="check",
    )
    op.drop_constraint(op.f("ck_budgets_budget_period"), "budgets", type_="check")
    op.execute(
        """
        UPDATE budget_amounts
        SET amount = ROUND(
            amount * CASE budgets.period WHEN 'weekly' THEN 52 ELSE 26 END / 12.0
        )
        FROM budgets
        WHERE budget_amounts.budget_id = budgets.id
          AND budgets.period IN ('weekly', 'biweekly')
        """
    )
    op.execute(
        "UPDATE budgets SET period = 'monthly', cycle_anchor = NULL "
        "WHERE period IN ('weekly', 'biweekly')"
    )
    op.drop_column("budgets", "cycle_anchor")
    op.create_check_constraint(
        op.f("ck_budgets_budget_period"),
        "budgets",
        "period IN ('monthly', 'yearly')",
    )
