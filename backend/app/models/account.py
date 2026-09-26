"""Bank, card, loan and cash accounts, entered by hand or linked through Plaid."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Money, TimestampMixin, UTCDateTime, enum_type, utcnow


class AccountType(StrEnum):
    CHECKING = "checking"
    SAVINGS = "savings"
    CASH = "cash"
    CREDIT_CARD = "credit_card"
    INVESTMENT = "investment"
    LOAN = "loan"
    MORTGAGE = "mortgage"
    OTHER = "other"


# Accounts that hold what you owe rather than what you have.
LIABILITY_TYPES = frozenset({AccountType.CREDIT_CARD, AccountType.LOAN, AccountType.MORTGAGE})


class AccountSource(StrEnum):
    """Who keeps an account up to date: the household, or its bank through Plaid."""

    MANUAL = "manual"
    PLAID = "plaid"


class Account(TimestampMixin, Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[AccountType] = mapped_column(enum_type(AccountType, "account_type"))
    institution: Mapped[str | None] = mapped_column(String(80))
    # The last few characters of the account number, as banks show them ("•••• 4410").
    mask: Mapped[str | None] = mapped_column(String(4))
    currency: Mapped[str] = mapped_column(String(3))
    # What the account is worth to the household: negative when money is owed, as on a
    # credit card, so adding up balances gives net worth and each transaction's amount moves
    # the balance the same way for every kind of account.
    balance: Mapped[Decimal] = mapped_column(Money())
    # Only banks report these; Plaid's `available` and `limit` balances.
    available_balance: Mapped[Decimal | None] = mapped_column(Money())
    credit_limit: Mapped[Decimal | None] = mapped_column(Money())
    balance_updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    notes: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[AccountSource] = mapped_column(enum_type(AccountSource, "account_source"))
    # For linked accounts: Plaid's account_id, and its own name and subtype for the account.
    external_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    official_name: Mapped[str | None] = mapped_column(String(160))
    subtype: Mapped[str | None] = mapped_column(String(40))
    # Closed accounts keep their history but drop out of totals and pickers.
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    @property
    def is_liability(self) -> bool:
        return self.type in LIABILITY_TYPES

    @property
    def is_linked(self) -> bool:
        return self.source == AccountSource.PLAID

    @property
    def is_closed(self) -> bool:
        return self.closed_at is not None
