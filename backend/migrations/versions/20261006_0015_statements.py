"""AI: reading a PDF statement, and importing what it holds.

The AI can read a bank's PDF statement for its transactions, which are then imported like a
file's, so a usage row can be for reading a statement and an import can have come from a PDF.
Both are stored as text that a CHECK constraint limits, so each constraint gains the new value.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USAGE = "ai_usage"
IMPORTS = "file_imports"
PURPOSE_CHECK = "ck_ai_usage_ai_purpose"
FORMAT_CHECK = "ck_file_imports_file_format"

PURPOSES = ("chat", "review", "test")
FORMATS = ("csv", "ofx", "qif")


def _replace(table: str, name: str, column: str, values: Sequence[str]) -> None:
    """Has the constraint allow exactly these values. A constraint can't be added only if it's
    missing, so it's dropped first."""
    listed = ", ".join(f"'{value}'" for value in values)
    op.drop_constraint(op.f(name), table, type_="check", if_exists=True)
    op.create_check_constraint(op.f(name), table, f"{column} IN ({listed})")


def upgrade() -> None:
    _replace(USAGE, PURPOSE_CHECK, "purpose", (*PURPOSES, "statement"))
    _replace(IMPORTS, FORMAT_CHECK, "format", (*FORMATS, "pdf"))


def downgrade() -> None:
    # What the old constraints don't allow is put under the nearest thing they do.
    op.execute("UPDATE ai_usage SET purpose = 'chat' WHERE purpose = 'statement'")
    op.execute("UPDATE file_imports SET format = 'csv' WHERE format = 'pdf'")
    _replace(USAGE, PURPOSE_CHECK, "purpose", PURPOSES)
    _replace(IMPORTS, FORMAT_CHECK, "format", FORMATS)
