"""Declarative base and column types shared by all ORM models."""

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import override

from sqlalchemy import BigInteger, DateTime, Dialect, Enum, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

# Deterministic constraint names keep Alembic migrations stable across databases.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """A timezone-aware timestamp that always comes back in UTC, whatever the connection's
    time zone. Naive values are refused on the way in."""

    impl = DateTime(timezone=True)
    cache_ok = True

    @override
    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Timestamps must be timezone-aware")
        return value.astimezone(UTC)

    @override
    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        return None if value is None else value.astimezone(UTC)


CENT = Decimal("0.01")


class Money(TypeDecorator[Decimal]):
    """An amount of money, stored exactly as a whole number of cents, so amounts and their sums
    stay exact. Python sees Decimals with two decimal places."""

    impl = BigInteger()
    cache_ok = True

    @override
    def process_bind_param(self, value: Decimal | None, dialect: Dialect) -> int | None:
        if value is None:
            return None
        cents = Decimal(value).scaleb(2)
        if cents != cents.to_integral_value():
            raise ValueError("Amounts of money can't have more than two decimal places")
        return int(cents)

    @override
    def process_result_value(self, value: object, dialect: Dialect) -> Decimal | None:
        if value is None:
            return None
        # Postgres sums whole numbers as numeric, which arrives as a Decimal.
        return Decimal(str(value)).scaleb(-2).quantize(CENT)


def _values(enum: type[StrEnum]) -> list[str]:
    return [member.value for member in enum.__members__.values()]


def enum_type(enum: type[StrEnum], name: str, *, length: int = 16) -> Enum:
    """A column of an enum's values, stored as text that a CHECK constraint limits."""
    return Enum(
        enum,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=length,
        values_callable=_values,
        validate_strings=True,
    )


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), onupdate=func.now(), nullable=False
    )
