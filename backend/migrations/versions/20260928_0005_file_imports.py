"""Statement files imported into accounts, and saved formats for reading them

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACCOUNTS_ID = "accounts.id"
FILE_IMPORTS = "file_imports"
IMPORT_PROFILES = "import_profiles"
TRANSACTIONS = "transactions"
IMPORT_ID = "import_id"
SET_NULL = "SET NULL"
JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")
# Amounts of money are whole numbers of cents.
MONEY = sa.BigInteger()

# Stored as text; the table's CHECK constraint limits it to these values.
FORMATS = ("csv", "ofx", "qif")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _timestamp(name: str, *, nullable: bool = True) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _now(name: str) -> sa.Column[datetime]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        IMPORT_PROFILES,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("signature", sa.String(length=64), nullable=True),
        sa.Column("headers", JSON, nullable=False),
        sa.Column("options", JSON, nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        _timestamp("last_used_at"),
        _now("created_at"),
        _now("updated_at"),
        sa.ForeignKeyConstraint(
            ["account_id"],
            [ACCOUNTS_ID],
            name=op.f("fk_import_profiles_account_id_accounts"),
            ondelete=SET_NULL,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_profiles")),
        sa.UniqueConstraint("name", name=op.f("uq_import_profiles_name")),
    )
    op.create_index(
        op.f("ix_import_profiles_signature"), IMPORT_PROFILES, ["signature"], unique=False
    )
    op.create_table(
        FILE_IMPORTS,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column(
            "format",
            sa.Enum(*FORMATS, name="file_format", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("added", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("total", MONEY, nullable=False),
        sa.Column("balance_change", MONEY, nullable=False),
        sa.Column("first_date", sa.Date(), nullable=False),
        sa.Column("last_date", sa.Date(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        _timestamp("created_at", nullable=False),
        sa.CheckConstraint(_in("format", FORMATS), name=op.f("ck_file_imports_file_format")),
        sa.ForeignKeyConstraint(
            ["account_id"],
            [ACCOUNTS_ID],
            name=op.f("fk_file_imports_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            [f"{IMPORT_PROFILES}.id"],
            name=op.f("fk_file_imports_profile_id_import_profiles"),
            ondelete=SET_NULL,
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_file_imports_created_by_id_users"),
            ondelete=SET_NULL,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_file_imports")),
    )
    op.create_index(op.f("ix_file_imports_account_id"), FILE_IMPORTS, ["account_id"], unique=False)
    op.create_index(op.f("ix_file_imports_created_at"), FILE_IMPORTS, ["created_at"], unique=False)
    op.add_column(TRANSACTIONS, sa.Column(IMPORT_ID, sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_transactions_import_id"), TRANSACTIONS, [IMPORT_ID], unique=False)
    op.create_foreign_key(
        op.f("fk_transactions_import_id_file_imports"),
        TRANSACTIONS,
        FILE_IMPORTS,
        [IMPORT_ID],
        ["id"],
        ondelete=SET_NULL,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_transactions_import_id_file_imports"), TRANSACTIONS, type_="foreignkey"
    )
    op.drop_index(op.f("ix_transactions_import_id"), table_name=TRANSACTIONS)
    op.drop_column(TRANSACTIONS, IMPORT_ID)
    op.drop_table(FILE_IMPORTS)
    op.drop_table(IMPORT_PROFILES)
