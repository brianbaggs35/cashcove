"""AI: searching transactions in plain words, and suggesting automations.

Both are requests to the AI that are counted in its usage, which stores what each was for as text
that a CHECK constraint limits, so the constraint gains the two new values.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USAGE = "ai_usage"
PURPOSE_CHECK = "ck_ai_usage_ai_purpose"

PURPOSES = ("chat", "review", "test", "statement")


def _allow(values: Sequence[str]) -> None:
    """Has the constraint allow exactly these values. A constraint can't be added only if it's
    missing, so it's dropped first."""
    listed = ", ".join(f"'{value}'" for value in values)
    op.drop_constraint(op.f(PURPOSE_CHECK), USAGE, type_="check", if_exists=True)
    op.create_check_constraint(op.f(PURPOSE_CHECK), USAGE, f"purpose IN ({listed})")


def upgrade() -> None:
    _allow((*PURPOSES, "search", "automation"))


def downgrade() -> None:
    # What the old constraint doesn't allow is put under the nearest thing it does.
    op.execute("UPDATE ai_usage SET purpose = 'chat' WHERE purpose IN ('search', 'automation')")
    _allow(PURPOSES)
