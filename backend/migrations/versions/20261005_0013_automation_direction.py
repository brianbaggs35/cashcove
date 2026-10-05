"""Automations: money in or money out, and categories someone chose.

An automation can be for money coming in or money going out only, so a paycheck automation
that looks for an employer doesn't also sort what was bought from it. Existing automations
keep sorting both.

A transaction remembers when someone chose its category, so that an automation that is changed
or resumed later sorts only what nobody chose. Everything there already is left as it was:
whoever chose it isn't known, so it is open to automations, as before.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUTOMATIONS = "automations"
TRANSACTIONS = "transactions"
DIRECTION_CHECK = "ck_automations_automation_direction"
# Stored as text; the table's CHECK constraint limits it to these values.
DIRECTIONS = ("any", "in", "out")


def upgrade() -> None:
    op.add_column(
        AUTOMATIONS,
        sa.Column(
            "direction",
            sa.Enum(*DIRECTIONS, name="automation_direction", native_enum=False, length=16),
            nullable=False,
            server_default="any",
        ),
        if_not_exists=True,
    )
    # A constraint can't be added only if it's missing, so it's replaced.
    op.drop_constraint(op.f(DIRECTION_CHECK), AUTOMATIONS, type_="check", if_exists=True)
    op.create_check_constraint(
        op.f(DIRECTION_CHECK), AUTOMATIONS, "direction IN ('any', 'in', 'out')"
    )
    op.add_column(
        TRANSACTIONS,
        sa.Column("category_chosen", sa.Boolean(), nullable=False, server_default=sa.false()),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_column(TRANSACTIONS, "category_chosen", if_exists=True)
    op.drop_constraint(op.f(DIRECTION_CHECK), AUTOMATIONS, type_="check", if_exists=True)
    op.drop_column(AUTOMATIONS, "direction", if_exists=True)
