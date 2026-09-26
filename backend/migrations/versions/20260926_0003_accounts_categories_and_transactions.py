"""Accounts, categories and transactions

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Stored as text; each table's CHECK constraint limits it to these values.
ACCOUNT_TYPES = (
    "checking",
    "savings",
    "cash",
    "credit_card",
    "investment",
    "loan",
    "mortgage",
    "other",
)
ACCOUNT_TYPE = sa.Enum(*ACCOUNT_TYPES, name="account_type", native_enum=False, length=16)
ACCOUNT_SOURCE = sa.Enum("manual", "plaid", name="account_source", native_enum=False, length=16)
CATEGORY_KIND = sa.Enum(
    "income", "expense", "transfer", name="category_kind", native_enum=False, length=16
)
TRANSACTION_SOURCE = sa.Enum(
    "manual", "plaid", "file", name="transaction_source", native_enum=False, length=16
)
# Amounts of money are whole numbers of cents.
MONEY = sa.BigInteger()


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("type", ACCOUNT_TYPE, nullable=False),
        sa.Column("institution", sa.String(length=80), nullable=True),
        sa.Column("mask", sa.String(length=4), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("balance", MONEY, nullable=False),
        sa.Column("available_balance", MONEY, nullable=True),
        sa.Column("credit_limit", MONEY, nullable=True),
        sa.Column("balance_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("source", ACCOUNT_SOURCE, nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("official_name", sa.String(length=160), nullable=True),
        sa.Column("subtype", sa.String(length=40), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            _in("source", ("manual", "plaid")), name=op.f("ck_accounts_account_source")
        ),
        sa.CheckConstraint(_in("type", ACCOUNT_TYPES), name=op.f("ck_accounts_account_type")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
        sa.UniqueConstraint("external_id", name=op.f("uq_accounts_external_id")),
    )
    op.create_table(
        "category_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("kind", CATEGORY_KIND, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            _in("kind", ("income", "expense", "transfer")),
            name=op.f("ck_category_groups_category_kind"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_category_groups")),
        sa.UniqueConstraint("name", name=op.f("uq_category_groups_name")),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("emoji", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["category_groups.id"],
            name=op.f("fk_categories_group_id_category_groups"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categories")),
        sa.UniqueConstraint("name", name=op.f("uq_categories_name")),
    )
    op.create_index(op.f("ix_categories_group_id"), "categories", ["group_id"], unique=False)
    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("payee", sa.String(length=160), nullable=False),
        sa.Column("original_description", sa.String(length=255), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("pending", sa.Boolean(), nullable=False),
        sa.Column("source", TRANSACTION_SOURCE, nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            _in("source", ("manual", "plaid", "file")),
            name=op.f("ck_transactions_transaction_source"),
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_transactions_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("fk_transactions_category_id_categories"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_transactions")),
        sa.UniqueConstraint(
            "account_id", "external_id", name="uq_transactions_account_id_external_id"
        ),
    )
    op.create_index(
        "ix_transactions_account_id_date", "transactions", ["account_id", "date"], unique=False
    )
    op.create_index(
        op.f("ix_transactions_category_id"), "transactions", ["category_id"], unique=False
    )
    op.create_index(
        "ix_transactions_date_created_at", "transactions", ["date", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_table("transactions")
    op.drop_table("categories")
    op.drop_table("category_groups")
    op.drop_table("accounts")
