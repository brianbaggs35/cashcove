"""Recurring payments tracked by the household: its subscriptions and its bills."""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Money, TimestampMixin, enum_type


class PaymentFrequency(StrEnum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    # Every two months, the way biweekly is every two weeks: not twice a month.
    BIMONTHLY = "bimonthly"
    QUARTERLY = "quarterly"
    SEMIANNUAL = "semiannual"
    ANNUAL = "annual"


class RecurringKind(StrEnum):
    """What a household calls a recurring payment. Both are tracked, matched to transactions and
    sorted by automations the same way; the kind is how people think of it, and which page of the
    app lists it."""

    # A service paid for on a schedule, like a streaming plan or a membership.
    SUBSCRIPTION = "subscription"
    # What is owed to a provider for what was used or provided, like electricity or a phone line.
    BILL = "bill"


class Subscription(TimestampMixin, Base):
    """A recurring payment: a subscription or a bill, as `kind` says. It keeps its original table
    and name because everything that links to one, a transaction, an automation or a budget,
    links to either kind the same way."""

    __tablename__ = "subscriptions"
    __table_args__ = (
        # Cancelling says when it ends, so a cancelled one always has an end date.
        CheckConstraint("cancelled_on IS NULL OR ends_on IS NOT NULL", name="cancelled_has_an_end"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    # Each page lists its own kind, so this is filtered on whenever they're listed.
    kind: Mapped[RecurringKind] = mapped_column(
        enum_type(RecurringKind, "recurring_kind"), default=RecurringKind.SUBSCRIPTION, index=True
    )
    # Matching is scoped to an account and an exact, case-insensitive payee.
    payee: Mapped[str] = mapped_column(String(160), index=True)
    # What a payment is expected to be. When it changes every time, like a utility bill, this is
    # only an estimate that the average of recent payments replaces once there are some.
    amount: Mapped[Decimal] = mapped_column(Money())
    amount_varies: Mapped[bool] = mapped_column(Boolean(), default=False)
    frequency: Mapped[PaymentFrequency] = mapped_column(
        enum_type(PaymentFrequency, "payment_frequency")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    next_due_date: Mapped[date] = mapped_column(Date())
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    notes: Mapped[str | None] = mapped_column(String(1000))
    # Whether payments are matched to it and it is reminded of. Pausing is not cancelling: it says
    # nothing about whether it carries on.
    active: Mapped[bool] = mapped_column(Boolean(), default=True)
    # The day it ends, for a term that runs out or one that was cancelled. No payment is expected
    # on or after it, and once the day has come it is over. Nothing says so but the date: there is
    # no job that ends it, so whether it has is always read against today.
    ends_on: Mapped[date | None] = mapped_column(Date())
    # The day it was cancelled, which is how a cancelled one differs from one that ends on its own:
    # it was ended by a person, who can reactivate it. Cancelling always sets `ends_on` too.
    cancelled_on: Mapped[date | None] = mapped_column(Date())
