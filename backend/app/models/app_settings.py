"""Household-wide preferences, stored as one validated JSON document."""

from typing import Any

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

SINGLETON_ID = 1


class AppSettings(TimestampMixin, Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=SINGLETON_ID)
    data: Mapped[dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict
    )
