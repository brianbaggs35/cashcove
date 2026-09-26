"""Categories for transactions, in groups such as Food & drink or Income."""

import uuid
from enum import StrEnum

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_type


class CategoryKind(StrEnum):
    """Whether a group's transactions count as spending, as income, or as neither."""

    INCOME = "income"
    EXPENSE = "expense"
    # Money moving between the household's own accounts, like paying off a credit card.
    TRANSFER = "transfer"


class CategoryGroup(TimestampMixin, Base):
    __tablename__ = "category_groups"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    kind: Mapped[CategoryKind] = mapped_column(enum_type(CategoryKind, "category_kind"))

    # Removing a group removes its categories, which the database does for rows not loaded.
    categories: Mapped[list["Category"]] = relationship(
        back_populates="group",
        order_by="Category.name",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("category_groups.id", ondelete="CASCADE"), index=True
    )
    # Unique across groups, so a name always means one category, e.g. in a file import.
    name: Mapped[str] = mapped_column(String(60), unique=True)
    emoji: Mapped[str] = mapped_column(String(32))

    group: Mapped[CategoryGroup] = relationship(back_populates="categories")
