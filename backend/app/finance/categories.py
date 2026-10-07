"""The categories a household starts with, which it can rename, regroup or remove."""

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import status
from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import ApiError
from app.models import Category, CategoryGroup, CategoryKind, Transaction
from app.schemas.categories import CategoryGroupOut, CategoryOut


@dataclass(frozen=True)
class SuggestedGroup:
    name: str
    kind: CategoryKind
    # Each category's emoji and name.
    categories: tuple[tuple[str, str], ...]


SUGGESTED = (
    SuggestedGroup(
        "Income",
        CategoryKind.INCOME,
        (("💼", "Paycheck"), ("📈", "Interest & dividends"), ("💰", "Other income")),
    ),
    SuggestedGroup(
        "Housing",
        CategoryKind.EXPENSE,
        (("🏠", "Rent & mortgage"), ("🛠️", "Home maintenance"), ("🛋️", "Home goods")),
    ),
    SuggestedGroup(
        "Bills & utilities",
        CategoryKind.EXPENSE,
        (
            ("💡", "Utilities"),
            ("📱", "Phone & internet"),
            ("🛡️", "Insurance"),
            ("📺", "Subscriptions"),
        ),
    ),
    SuggestedGroup(
        "Food & drink",
        CategoryKind.EXPENSE,
        (("🛒", "Groceries"), ("🍽️", "Restaurants"), ("☕", "Coffee")),
    ),
    SuggestedGroup(
        "Transportation",
        CategoryKind.EXPENSE,
        (
            ("⛽", "Gas & fuel"),
            ("🚗", "Car maintenance"),
            ("🅿️", "Parking & tolls"),
            ("🚆", "Public transit"),
            ("🚕", "Rideshare & taxis"),
        ),
    ),
    SuggestedGroup(
        "Shopping",
        CategoryKind.EXPENSE,
        (("🛍️", "Shopping"), ("👕", "Clothing"), ("💻", "Electronics")),
    ),
    SuggestedGroup(
        "Health & wellness",
        CategoryKind.EXPENSE,
        (("🩺", "Medical"), ("💊", "Pharmacy"), ("🏋️", "Fitness")),
    ),
    SuggestedGroup(
        "Lifestyle",
        CategoryKind.EXPENSE,
        (
            ("🎬", "Entertainment"),
            ("✈️", "Travel"),
            ("🐾", "Pets"),
            ("💇", "Personal care"),
            ("🎁", "Gifts & donations"),
        ),
    ),
    SuggestedGroup(
        "Family & education",
        CategoryKind.EXPENSE,
        (("🧸", "Kids"), ("🎓", "Education")),
    ),
    SuggestedGroup(
        "Financial",
        CategoryKind.EXPENSE,
        (
            ("🏦", "Bank fees"),
            ("🧾", "Taxes"),
            ("💵", "Loan payments"),
            ("🏧", "Cash & ATM"),
        ),
    ),
    SuggestedGroup(
        "Transfers",
        CategoryKind.TRANSFER,
        (("🔁", "Transfers"), ("💳", "Credit card payments")),
    ),
)


def add_suggested_categories(db: Session) -> int:
    """Adds whichever suggested groups and categories the household doesn't have by name.

    Categories someone renamed or removed are only added back under their suggested name,
    so running this again never duplicates anything. Returns how many categories it added.
    """
    groups = {group.name.casefold(): group for group in db.scalars(select(CategoryGroup))}
    taken = {name.casefold() for name in db.scalars(select(Category.name))}
    added = 0
    for suggested in SUGGESTED:
        group = groups.get(suggested.name.casefold())
        missing = [
            (emoji, name) for emoji, name in suggested.categories if name.casefold() not in taken
        ]
        if not missing:
            continue
        if group is None:
            group = CategoryGroup(name=suggested.name, kind=suggested.kind)
            db.add(group)
        for emoji, name in missing:
            db.add(Category(group=group, name=name, emoji=emoji))
            added += 1
    db.flush()
    return added


KIND_ORDER = {CategoryKind.INCOME: 0, CategoryKind.EXPENSE: 1, CategoryKind.TRANSFER: 2}


def category_groups_out(db: Session) -> list[CategoryGroupOut]:
    """Income first, then spending, then transfers; each group's categories by name."""
    counts = dict(
        db.execute(
            select(Transaction.category_id, func.count()).group_by(Transaction.category_id)
        ).all()
    )
    groups = sorted(
        db.scalars(select(CategoryGroup).options(selectinload(CategoryGroup.categories))),
        key=lambda group: (KIND_ORDER[group.kind], group.name.casefold()),
    )
    return [
        CategoryGroupOut(
            id=group.id,
            name=group.name,
            kind=group.kind,
            categories=[
                category_out(category, counts.get(category.id, 0))
                for category in sorted(group.categories, key=lambda item: item.name.casefold())
            ],
        )
        for group in groups
    ]


def category_out(category: Category, transaction_count: int) -> CategoryOut:
    return CategoryOut(
        id=category.id,
        group_id=category.group_id,
        name=category.name,
        emoji=category.emoji,
        transaction_count=transaction_count,
    )


def find_category(db: Session, category_id: uuid.UUID | None) -> Category | None:
    """The category a transaction is being given, which has to exist."""
    if category_id is None:
        return None
    category = db.get(Category, category_id)
    if category is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_category",
            "That category doesn't exist anymore. Choose another one.",
        )
    return category


def transfer_categories() -> Select[*tuple[Any, ...]]:
    """The categories of money moving between the household's own accounts."""
    return (
        select(Category.id)
        .join(CategoryGroup, CategoryGroup.id == Category.group_id)
        .where(CategoryGroup.kind == CategoryKind.TRANSFER)
    )


def not_a_transfer() -> ColumnElement[bool]:
    """What a transaction has to be to count as income or spending: moving money between the
    household's own accounts is neither."""
    return or_(
        Transaction.category_id.is_(None), Transaction.category_id.not_in(transfer_categories())
    )


# ---- Adding categories and groups ------------------------------------------------------------
#
# These don't commit, so a request can add several things and keep all of them or none.


def name_taken(what: str, name: str) -> ApiError:
    return ApiError(
        status.HTTP_409_CONFLICT, "name_taken", f"There's already a {what} called {name}."
    )


def ensure_unique_name(db: Session, model: type[Category] | type[CategoryGroup], name: str) -> None:
    """Names are unique whatever their case, so "groceries" can't sit beside "Groceries"."""
    clash = db.scalar(select(model.name).where(func.lower(model.name) == name.lower()).limit(1))
    if clash is not None:
        raise name_taken("category" if model is Category else "group", clash)


def find_group(db: Session, group_id: uuid.UUID) -> CategoryGroup:
    group = db.get(CategoryGroup, group_id)
    if group is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "That group doesn't exist anymore.")
    return group


def new_group(db: Session, name: str, kind: CategoryKind) -> CategoryGroup:
    ensure_unique_name(db, CategoryGroup, name)
    group = CategoryGroup(name=name, kind=kind)
    db.add(group)
    return group


def new_category(db: Session, group: CategoryGroup, name: str, emoji: str) -> Category:
    ensure_unique_name(db, Category, name)
    category = Category(group=group, name=name, emoji=emoji)
    db.add(category)
    return category
