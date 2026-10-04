"""Budgets: an amount for a period of time, and what counts toward it.

A household can have several at once, e.g. one a month and one a year. Each says how much, how
often (every week, two weeks, month or year, counted from a day) and what counts: income that
comes in and spending that comes out. What counts is whatever is linked to the budget, whether
that's a transaction, every transaction of an account or a category, the payments of a
subscription or the ones an automation sorts. Everything is worked out from the transactions
when it's asked for, so a budget is always up to date with whatever synced, was imported or was
added since.
"""

import datetime as dt
import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, TimestampMixin, UTCDateTime, enum_type

BUDGETS_TABLE = "budgets"


class BudgetPeriod(StrEnum):
    """How often a budget's amount starts over."""

    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class BudgetKind(StrEnum):
    """What something linked to a budget counts as."""

    # Money that comes in, which adds to what the budget has taken in.
    INCOME = "income"
    # Money that goes out, which is taken off the budget's amount.
    SPENDING = "spending"


class Budget(TimestampMixin, Base):
    __tablename__ = BUDGETS_TABLE

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    period: Mapped[BudgetPeriod] = mapped_column(enum_type(BudgetPeriod, "budget_period"))
    # A day a period starts on. Every other period starts a week, two weeks, a month or a year
    # on from it, in either direction, so periods before the budget was made exist too.
    starts_on: Mapped[dt.date] = mapped_column(Date())

    amounts: Mapped[list["BudgetAmount"]] = relationship(
        back_populates="budget",
        order_by="BudgetAmount.starts_on",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    links: Mapped[list["BudgetLink"]] = relationship(
        back_populates="budget",
        order_by="BudgetLink.created_at",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class BudgetAmount(Base):
    """How much a budget has for each period, from the one starting on `starts_on` until a
    later amount takes over. Changing a budget adds an amount rather than rewriting the old
    one, so periods that are over keep what they were measured against."""

    __tablename__ = "budget_amounts"
    __table_args__ = (
        UniqueConstraint("budget_id", "starts_on", name="uq_budget_amounts_budget_id_starts_on"),
        CheckConstraint("amount > 0", name="amount_is_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{BUDGETS_TABLE}.id", ondelete="CASCADE")
    )
    # The first day of a period of the budget, which this amount applies from. The earliest
    # amount also applies to the periods before it.
    starts_on: Mapped[dt.date] = mapped_column(Date())
    amount: Mapped[Decimal] = mapped_column(Money())

    budget: Mapped[Budget] = relationship(back_populates="amounts")


class BudgetLink(Base):
    """Something that counts toward a budget, and as what. A link is to one of five things:

    - a transaction, which counts by itself,
    - an account, whose money out counts as spending, or whose money in counts as income,
    - a category, all of whose transactions count,
    - a subscription, whose payments count as spending, and
    - an automation, whose transactions count, including the ones that arrive later.

    A transaction counts once, as the first of these that links it, in that order.
    """

    __tablename__ = "budget_links"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(transaction_id, account_id, category_id, subscription_id, automation_id)"
            " = 1",
            name="links_one_thing",
        ),
        CheckConstraint(
            "subscription_id IS NULL OR kind = 'spending'", name="subscriptions_are_spending"
        ),
        # A thing is only linked once (an account can count as both income and spending). Rows
        # with nothing there don't count as the same, since each is null.
        UniqueConstraint(
            "budget_id", "transaction_id", name="uq_budget_links_budget_id_transaction_id"
        ),
        UniqueConstraint(
            "budget_id", "account_id", "kind", name="uq_budget_links_budget_id_account_id_kind"
        ),
        UniqueConstraint("budget_id", "category_id", name="uq_budget_links_budget_id_category_id"),
        UniqueConstraint(
            "budget_id", "subscription_id", name="uq_budget_links_budget_id_subscription_id"
        ),
        UniqueConstraint(
            "budget_id", "automation_id", name="uq_budget_links_budget_id_automation_id"
        ),
        Index("ix_budget_links_transaction_id", "transaction_id"),
        Index("ix_budget_links_automation_id", "automation_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{BUDGETS_TABLE}.id", ondelete="CASCADE")
    )
    kind: Mapped[BudgetKind] = mapped_column(enum_type(BudgetKind, "budget_kind"))
    # Whichever one it links to; the others are null. They go when what they link to does.
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE")
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE")
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE")
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE")
    )
    automation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), nullable=False
    )

    budget: Mapped[Budget] = relationship(back_populates="links")


class BudgetExclusion(Base):
    """A transaction someone took off a budget that would otherwise count it, whether because
    its account, its category, its subscription or an automation links it. The others that
    they link keep counting."""

    __tablename__ = "budget_exclusions"
    __table_args__ = (Index("ix_budget_exclusions_transaction_id", "transaction_id"),)

    budget_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{BUDGETS_TABLE}.id", ondelete="CASCADE"), primary_key=True
    )
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True
    )
