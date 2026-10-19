"""Subscriptions and bills that end: a day they end on, and the day they were cancelled.

Until now a subscription could only be deleted, which takes everything it tracked with it. Now it
can end instead: `ends_on` is the day no more payments are expected from, and `cancelled_on` is
the day a person cancelled it, which is how one that was cancelled differs from one whose term
ran out. A CHECK constraint makes sure that every cancelled one has the day it ends.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIPTIONS = "subscriptions"
END_CHECK = "ck_subscriptions_cancelled_has_an_end"


def upgrade() -> None:
    op.add_column(SUBSCRIPTIONS, sa.Column("ends_on", sa.Date(), nullable=True), if_not_exists=True)
    op.add_column(
        SUBSCRIPTIONS, sa.Column("cancelled_on", sa.Date(), nullable=True), if_not_exists=True
    )
    # A constraint can't be added only if it's missing, so it's replaced.
    op.drop_constraint(op.f(END_CHECK), SUBSCRIPTIONS, type_="check", if_exists=True)
    op.create_check_constraint(
        op.f(END_CHECK), SUBSCRIPTIONS, "cancelled_on IS NULL OR ends_on IS NOT NULL"
    )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns(SUBSCRIPTIONS)}
    if "cancelled_on" in columns:
        # The app before this one can't cancel anything, and would carry on matching payments to
        # and reminding of what was cancelled. Pausing is the nearest it has, so nothing that
        # was cancelled is reminded of again. Ending on a day is lost, as that app has no such day.
        op.execute("UPDATE subscriptions SET active = false WHERE cancelled_on IS NOT NULL")
    op.drop_constraint(op.f(END_CHECK), SUBSCRIPTIONS, type_="check", if_exists=True)
    op.drop_column(SUBSCRIPTIONS, "cancelled_on", if_exists=True)
    op.drop_column(SUBSCRIPTIONS, "ends_on", if_exists=True)
