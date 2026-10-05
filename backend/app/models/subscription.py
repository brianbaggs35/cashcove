"""Recurring payments tracked by the household: its subscriptions and its bills."""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Boolean, Date, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Money, TimestampMixin, enum_type


class PaymentFrequency(StrEnum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
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
    active: Mapped[bool] = mapped_column(Boolean(), default=True)
