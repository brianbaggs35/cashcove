"""Recurring payments tracked by the household."""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, TimestampMixin, enum_type

if TYPE_CHECKING:
    from app.models.budget import Budget


class PaymentFrequency(StrEnum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    SEMIANNUAL = "semiannual"
    ANNUAL = "annual"


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    # Matching is scoped to an account and an exact, case-insensitive payee.
    payee: Mapped[str] = mapped_column(String(160), index=True)
    amount: Mapped[Decimal] = mapped_column(Money())
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
    budgets: Mapped[list["Budget"]] = relationship(
        secondary="budget_subscriptions",
        back_populates="subscriptions",
    )
