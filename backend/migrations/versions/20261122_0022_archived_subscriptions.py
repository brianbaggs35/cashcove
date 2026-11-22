"""Archived subscriptions and bills: the day they were put away.

A subscription or a bill that is paused, cancelled or over can be archived, which keeps it, every
payment linked to it and what refers to it, and takes it out of the way. `archived_on` is the day it
was put away; it is null for every one that exists now.

Every step checks first, so running it again on a database that already has it changes nothing.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIPTIONS = "subscriptions"


def upgrade() -> None:
    op.add_column(
        SUBSCRIPTIONS, sa.Column("archived_on", sa.Date(), nullable=True), if_not_exists=True
    )


def downgrade() -> None:
    # The app before this one has no archive. What was archived is paused or over already, so it
    # isn't matched or reminded of there either; it only shows with the rest again.
    op.drop_column(SUBSCRIPTIONS, "archived_on", if_exists=True)
