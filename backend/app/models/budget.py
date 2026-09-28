"""Budgets: how much the household plans to spend in each category, or expects from each kind
of income, month by month or year by year."""

import datetime as dt
import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, TimestampMixin, enum_type


class BudgetPeriod(StrEnum):
    """Whether a budget is for each month, or for each budget year, like insurance that's paid
    once a year. Settings > General says which month a budget year starts in."""

    MONTHLY = "monthly"
    YEARLY = "yearly"


class Budget(TimestampMixin, Base):
    """A category's budget. Its amounts say how much, and from when."""

    __tablename__ = "budgets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), unique=True
    )
    period: Mapped[BudgetPeriod] = mapped_column(enum_type(BudgetPeriod, "budget_period"))
    # A monthly spending budget that rolls over carries what's left of each month into the
    # next, or takes off what went over, starting from this month's.
    rollover_since: Mapped[dt.date | None] = mapped_column(Date())

    amounts: Mapped[list["BudgetAmount"]] = relationship(
        back_populates="budget",
        order_by="BudgetAmount.starts_on",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class BudgetAmount(Base):
    """How much a budget plans for each month, or budget year, from the one it starts in until
    a later amount takes over. Changing a budget adds amounts rather than rewriting them, so
    past months keep the budget they had."""

    __tablename__ = "budget_amounts"
    __table_args__ = (
        UniqueConstraint("budget_id", "starts_on", name="uq_budget_amounts_budget_id_starts_on"),
        CheckConstraint("amount >= 0", name="amount_not_negative"),
        CheckConstraint("extract(day from starts_on) = 1", name="starts_on_first_of_month"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"))
    # The first day of the month, or of the budget year, it applies from.
    starts_on: Mapped[dt.date] = mapped_column(Date())
    # None stops budgeting the category from then on.
    amount: Mapped[Decimal | None] = mapped_column(Money())

    budget: Mapped[Budget] = relationship(back_populates="amounts")
