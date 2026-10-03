"""Exchange rates, kept so accounts in other currencies can count in the household's."""

import datetime as dt
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ExchangeRate(Base):
    """What one unit of `base` was worth in `quote` on a day. Only days that are over are kept,
    so a rate never changes once it's stored."""

    __tablename__ = "exchange_rates"
    __table_args__ = (CheckConstraint("rate > 0", name="rate_positive"),)

    base: Mapped[str] = mapped_column(String(3), primary_key=True)
    quote: Mapped[str] = mapped_column(String(3), primary_key=True)
    day: Mapped[dt.date] = mapped_column(Date(), primary_key=True)
    # Wide enough for currencies worth a tiny fraction of the household's.
    rate: Mapped[Decimal] = mapped_column(Numeric(24, 12))


class ExchangeRateSpan(Base):
    """The days of a currency pair that have been fetched, which is every day from the first to
    the last. A day in it without a rate is one the rate source has none for, so it isn't asked
    for again."""

    __tablename__ = "exchange_rate_spans"
    __table_args__ = (CheckConstraint("first_day <= last_day", name="days_in_order"),)

    base: Mapped[str] = mapped_column(String(3), primary_key=True)
    quote: Mapped[str] = mapped_column(String(3), primary_key=True)
    first_day: Mapped[dt.date] = mapped_column(Date())
    last_day: Mapped[dt.date] = mapped_column(Date())
