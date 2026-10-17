"""Payments every two months: a subscription or bill can be bi-monthly.

A frequency is stored as text, so a new one needs no new column. The models limit the column to
the frequencies there are with a CHECK constraint, which the migration that made the column
never created, so this one does, with the new frequency among them (and replaces the constraint
on a database that has one from before, such as one built from the models).

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIPTIONS = "subscriptions"
FREQUENCY_CHECK = "ck_subscriptions_payment_frequency"


def upgrade() -> None:
    # A constraint can't be added only if it's missing, so it's replaced.
    op.drop_constraint(op.f(FREQUENCY_CHECK), SUBSCRIPTIONS, type_="check", if_exists=True)
    op.create_check_constraint(
        op.f(FREQUENCY_CHECK),
        SUBSCRIPTIONS,
        "frequency IN ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', "
        "'annual')",
    )


def downgrade() -> None:
    # The app before this one has no such frequency, and can't read a row that has. A payment
    # every two months becomes one every month for half as much, which is the same in a year.
    op.execute(
        "UPDATE subscriptions SET frequency = 'monthly', amount = ROUND(amount / 2.0) "
        "WHERE frequency = 'bimonthly'"
    )
    # Nothing limited the column before this, so nothing does again.
    op.drop_constraint(op.f(FREQUENCY_CHECK), SUBSCRIPTIONS, type_="check", if_exists=True)
