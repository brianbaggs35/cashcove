"""Statement files imported into accounts, and the saved formats that read each bank's CSVs."""

import datetime as dt
import uuid
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import Date, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import JSON_TYPE
from app.models.base import Base, Money, TimestampMixin, UTCDateTime, enum_type, utcnow

SET_NULL = "SET NULL"


class FileFormat(StrEnum):
    """The kinds of file banks export that Cashcove reads."""

    # Comma-separated values, or another delimiter: each bank lays out its columns its own way.
    CSV = "csv"
    # Open Financial Exchange, which Quicken's QFX and QuickBooks' QBO files are too.
    OFX = "ofx"
    # Quicken Interchange Format, the older plain-text format some banks still offer.
    QIF = "qif"


class ImportProfile(TimestampMixin, Base):
    """How to read one bank's CSV files: which column holds what, and how dates and amounts
    are written. The next file with the same column names is read the same way."""

    __tablename__ = "import_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    # A hash of the file's column names, which recognizes the next file of the same kind. None
    # for files without a row of column names.
    signature: Mapped[str | None] = mapped_column(String(64), index=True)
    # The column names, as the file has them, to show which file it's for.
    headers: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list)
    # How to read the file (ImportOptions).
    options: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE)
    # The account its files were last imported into, to suggest next time.
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete=SET_NULL)
    )
    last_used_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime())


class FileImport(Base):
    """One file imported into an account, which can be undone."""

    __tablename__ = "file_imports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_profiles.id", ondelete=SET_NULL)
    )
    file_name: Mapped[str] = mapped_column(String(255))
    format: Mapped[FileFormat] = mapped_column(enum_type(FileFormat, "file_format"))
    # Transactions it added, and rows of the file it left out: ones already in the account,
    # ones unticked, and ones that couldn't be read.
    added: Mapped[int] = mapped_column()
    skipped: Mapped[int] = mapped_column()
    # What its transactions added up to, and how far it moved the account's balance, so that
    # undoing it can put the balance back.
    total: Mapped[Decimal] = mapped_column(Money())
    balance_change: Mapped[Decimal] = mapped_column(Money())
    # The days its transactions span.
    first_date: Mapped[dt.date] = mapped_column(Date())
    last_date: Mapped[dt.date] = mapped_column(Date())
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete=SET_NULL)
    )
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
