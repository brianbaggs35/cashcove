"""Automations: rules that categorize transactions and link them to subscriptions and bills."""

import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, Uuid
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Money, TimestampMixin, enum_type


class AutomationScope(StrEnum):
    """Which transactions an automation sorts."""

    # The ones the household already has, and every one that arrives later.
    ALL = "all"
    # Only the ones that arrive from now on; what's there stays as it is.
    FUTURE = "future"


class AutomationMatch(StrEnum):
    """How an automation compares what it looks for with a transaction's payee and with what
    the bank called it, which statement files and banks write differently."""

    # The whole of it, ignoring letter case and extra spaces.
    EXACT = "exact"
    # The start of it, e.g. "AMZN Mktp" for every "AMZN Mktp US*2K4TT3Y81".
    STARTS_WITH = "starts_with"
    # Anywhere in it, e.g. "netflix" for "NETFLIX.COM 866-579-7172 CA".
    CONTAINS = "contains"


class AutomationDirection(StrEnum):
    """Which way the money went in the transactions an automation sorts."""

    # Money in or out, which is every transaction.
    ANY = "any"
    # Only money coming in, like a paycheck or a refund.
    IN = "in"
    # Only money going out, like a purchase or a bill.
    OUT = "out"


class Automation(TimestampMixin, Base):
    __tablename__ = "automations"
    __table_args__ = (
        CheckConstraint("cardinality(payees) > 0", name="has_a_payee"),
        CheckConstraint(
            "min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount",
            name="amounts_in_order",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    # What it looks for: payees, as they were first written, or text from them or from what the
    # bank called the transaction. How it's compared with both is `match`.
    payees: Mapped[list[str]] = mapped_column(ARRAY(String(160)))
    match: Mapped[AutomationMatch] = mapped_column(
        enum_type(AutomationMatch, "automation_match"), default=AutomationMatch.EXACT
    )
    # Only transactions of this much, whichever way the money went: from `min_amount` to
    # `max_amount`, either of which can be left open. One payee can bill several subscriptions
    # by amount, while a utility bill is a different amount every month and leaves both open.
    min_amount: Mapped[Decimal | None] = mapped_column(Money())
    max_amount: Mapped[Decimal | None] = mapped_column(Money())
    # Only money coming in or only money going out, so a paycheck automation that looks for an
    # employer doesn't also sort what was bought from it.
    direction: Mapped[AutomationDirection] = mapped_column(
        enum_type(AutomationDirection, "automation_direction"),
        default=AutomationDirection.ANY,
    )
    # Only transactions in this account, or in any when empty. An account's automations go
    # with it, rather than start sorting every other account's.
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    # What it does: the category it gives, and the subscription it links payments to. Either
    # can go away from under it, which leaves an automation with less to do.
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"), index=True
    )
    apply_to: Mapped[AutomationScope] = mapped_column(
        enum_type(AutomationScope, "automation_scope")
    )
    active: Mapped[bool] = mapped_column(Boolean(), default=True)
