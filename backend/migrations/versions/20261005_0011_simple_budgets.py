"""Simple budgets: an amount for a week, two weeks, a month or a year, and what counts toward it.

Replaces the budgets of each category. Those were a different shape of thing, a plan for every
category rather than one amount with things linked to it, so they aren't carried over: the old
budget tables and everything in them are dropped.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-05
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BUDGETS = "budgets"
BUDGET_AMOUNTS = "budget_amounts"
BUDGET_LINKS = "budget_links"
BUDGET_EXCLUSIONS = "budget_exclusions"
BUDGETS_ID = "budgets.id"
# Amounts of money are whole numbers of cents.
MONEY = sa.BigInteger()

# Stored as text; the tables' CHECK constraints limit them to these values.
PERIODS = ("weekly", "biweekly", "monthly", "yearly")
KINDS = ("income", "spending")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _now(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def _drop_old_budgets() -> None:
    op.drop_index(op.f("ix_budget_subscriptions_budget_id"), table_name="budget_subscriptions")
    op.drop_table("budget_subscriptions")
    op.drop_index(op.f("ix_budget_transactions_budget_id"), table_name="budget_transactions")
    op.drop_table("budget_transactions")
    op.drop_index(op.f("ix_budget_accounts_account_id"), table_name="budget_accounts")
    op.drop_table("budget_accounts")
    op.drop_table(BUDGET_AMOUNTS)
    op.drop_table(BUDGETS)


def _create_old_budgets() -> None:
    """The tables as migrations 0007 and 0008 left them, empty."""
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
        sa.Column("cycle_anchor", sa.Date(), nullable=True),
        sa.CheckConstraint(_in("period", PERIODS), name=op.f("ck_budgets_budget_period")),
        sa.CheckConstraint(
            "period NOT IN ('weekly', 'biweekly') OR cycle_anchor IS NOT NULL",
            name=op.f("ck_budgets_recurring_budget_has_anchor"),
        ),
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
            [BUDGETS_ID],
            name=op.f("fk_budget_amounts_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_amounts")),
        sa.UniqueConstraint(
            "budget_id", "starts_on", name=op.f("uq_budget_amounts_budget_id_starts_on")
        ),
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
        op.f("ix_budget_accounts_account_id"), "budget_accounts", ["account_id"], unique=False
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


def upgrade() -> None:
    _drop_old_budgets()
    op.create_table(
        BUDGETS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "period",
            sa.Enum(*PERIODS, name="budget_period", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("starts_on", sa.Date(), nullable=False),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint(_in("period", PERIODS), name=op.f("ck_budgets_budget_period")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budgets")),
    )
    op.create_table(
        BUDGET_AMOUNTS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.CheckConstraint("amount > 0", name=op.f("ck_budget_amounts_amount_is_positive")),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [BUDGETS_ID],
            name=op.f("fk_budget_amounts_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_amounts")),
        sa.UniqueConstraint(
            "budget_id", "starts_on", name=op.f("uq_budget_amounts_budget_id_starts_on")
        ),
    )
    op.create_table(
        BUDGET_LINKS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(*KINDS, name="budget_kind", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("subscription_id", sa.Uuid(), nullable=True),
        sa.Column("automation_id", sa.Uuid(), nullable=True),
        _now("created_at"),
        sa.CheckConstraint(_in("kind", KINDS), name=op.f("ck_budget_links_budget_kind")),
        sa.CheckConstraint(
            "num_nonnulls(transaction_id, account_id, category_id, subscription_id, automation_id)"
            " = 1",
            name=op.f("ck_budget_links_links_one_thing"),
        ),
        sa.CheckConstraint(
            "subscription_id IS NULL OR kind = 'spending'",
            name=op.f("ck_budget_links_subscriptions_are_spending"),
        ),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [BUDGETS_ID],
            name=op.f("fk_budget_links_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name=op.f("fk_budget_links_transaction_id_transactions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_budget_links_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_budget_links_category_id_categories"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["subscriptions.id"],
            name=op.f("fk_budget_links_subscription_id_subscriptions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["automation_id"],
            ["automations.id"],
            name=op.f("fk_budget_links_automation_id_automations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_links")),
        sa.UniqueConstraint(
            "budget_id", "transaction_id", name=op.f("uq_budget_links_budget_id_transaction_id")
        ),
        sa.UniqueConstraint(
            "budget_id",
            "account_id",
            "kind",
            name=op.f("uq_budget_links_budget_id_account_id_kind"),
        ),
        sa.UniqueConstraint(
            "budget_id", "category_id", name=op.f("uq_budget_links_budget_id_category_id")
        ),
        sa.UniqueConstraint(
            "budget_id", "subscription_id", name=op.f("uq_budget_links_budget_id_subscription_id")
        ),
        sa.UniqueConstraint(
            "budget_id", "automation_id", name=op.f("uq_budget_links_budget_id_automation_id")
        ),
    )
    op.create_index(
        op.f("ix_budget_links_transaction_id"), BUDGET_LINKS, ["transaction_id"], unique=False
    )
    op.create_index(
        op.f("ix_budget_links_automation_id"), BUDGET_LINKS, ["automation_id"], unique=False
    )
    op.create_table(
        BUDGET_EXCLUSIONS,
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [BUDGETS_ID],
            name=op.f("fk_budget_exclusions_budget_id_budgets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name=op.f("fk_budget_exclusions_transaction_id_transactions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("budget_id", "transaction_id", name=op.f("pk_budget_exclusions")),
    )
    op.create_index(
        op.f("ix_budget_exclusions_transaction_id"),
        BUDGET_EXCLUSIONS,
        ["transaction_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_exclusions_transaction_id"), table_name=BUDGET_EXCLUSIONS)
    op.drop_table(BUDGET_EXCLUSIONS)
    op.drop_index(op.f("ix_budget_links_automation_id"), table_name=BUDGET_LINKS)
    op.drop_index(op.f("ix_budget_links_transaction_id"), table_name=BUDGET_LINKS)
    op.drop_table(BUDGET_LINKS)
    op.drop_table(BUDGET_AMOUNTS)
    op.drop_table(BUDGETS)
    _create_old_budgets()
