"""Money in and out of an account, entered by hand, imported from a file or synced by Plaid."""

import datetime as dt
import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Date, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Money, TimestampMixin, enum_type


class TransactionSource(StrEnum):
    MANUAL = "manual"
    PLAID = "plaid"
    # Imported from a bank statement file, such as a CSV export.
    FILE = "file"


class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        # One row per transaction a bank or file reports, so syncing and re-imports can't
        # add it twice.
        UniqueConstraint(
            "account_id", "external_id", name="uq_transactions_account_id_external_id"
        ),
        Index("ix_transactions_account_id_date", "account_id", "date"),
        Index("ix_transactions_date_created_at", "date", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    date: Mapped[dt.date] = mapped_column(Date())
    # Positive when money comes in, negative when it goes out. (Plaid reports the opposite,
    # so syncing flips the sign.)
    amount: Mapped[Decimal] = mapped_column(Money())
    # Who it was with, as people want to read it ("Whole Foods"). Admins can rename it.
    payee: Mapped[str] = mapped_column(String(160))
    # What the bank or file called it ("WHOLEFDS MKT #10234 AUSTIN TX"), kept as it came.
    original_description: Mapped[str | None] = mapped_column(String(255))
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    notes: Mapped[str | None] = mapped_column(String(1000))
    # Authorized but not yet posted by the bank; its date and amount can still change.
    pending: Mapped[bool] = mapped_column(default=False)
    source: Mapped[TransactionSource] = mapped_column(
        enum_type(TransactionSource, "transaction_source")
    )
    # The bank's or file's own ID for it, such as Plaid's transaction_id.
    external_id: Mapped[str | None] = mapped_column(String(255))

    @property
    def from_bank(self) -> bool:
        """Its bank keeps its date and amount up to date, so people don't edit those."""
        return self.source == TransactionSource.PLAID
