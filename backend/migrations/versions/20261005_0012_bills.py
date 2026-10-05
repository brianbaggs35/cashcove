"""Bills: a recurring payment is a subscription or a bill.

Every payment tracked until now is a subscription. A bill is tracked, matched to transactions
and sorted by automations in exactly the same way, so it is a kind of the same row rather than
a second table. The kind is indexed, since each page lists its own, and so is what budgets link a
subscription or bill by, which the other things a budget links to already were.

Every step checks first, so running it again on a database that already has some or all of it
changes nothing.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIPTIONS = "subscriptions"
BUDGET_LINKS = "budget_links"
KIND_CHECK = "ck_subscriptions_recurring_kind"
SUBSCRIPTIONS_KIND = "ix_subscriptions_kind"
BUDGET_LINKS_SUBSCRIPTION = "ix_budget_links_subscription_id"
# Stored as text; the table's CHECK constraint limits it to these values.
KINDS = ("subscription", "bill")


def upgrade() -> None:
    op.add_column(
        SUBSCRIPTIONS,
        sa.Column(
            "kind",
            sa.Enum(*KINDS, name="recurring_kind", native_enum=False, length=16),
            nullable=False,
            server_default="subscription",
        ),
        if_not_exists=True,
    )
    # A constraint can't be added only if it's missing, so it's replaced.
    op.drop_constraint(op.f(KIND_CHECK), SUBSCRIPTIONS, type_="check", if_exists=True)
    op.create_check_constraint(op.f(KIND_CHECK), SUBSCRIPTIONS, "kind IN ('subscription', 'bill')")
    op.create_index(op.f(SUBSCRIPTIONS_KIND), SUBSCRIPTIONS, ["kind"], if_not_exists=True)
    op.create_index(
        op.f(BUDGET_LINKS_SUBSCRIPTION), BUDGET_LINKS, ["subscription_id"], if_not_exists=True
    )


def downgrade() -> None:
    # Bills are subscriptions again, so nothing they tracked is lost.
    op.drop_index(op.f(BUDGET_LINKS_SUBSCRIPTION), table_name=BUDGET_LINKS, if_exists=True)
    op.drop_index(op.f(SUBSCRIPTIONS_KIND), table_name=SUBSCRIPTIONS, if_exists=True)
    op.drop_constraint(op.f(KIND_CHECK), SUBSCRIPTIONS, type_="check", if_exists=True)
    op.drop_column(SUBSCRIPTIONS, "kind", if_exists=True)
