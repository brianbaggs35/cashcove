"""Categories and their groups. Everyone can see them; only admins change them."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.finance.categories import (
    add_suggested_categories,
    category_groups_out,
    category_out,
    find_category,
)
from app.models import Category, CategoryGroup, Transaction
from app.schemas.categories import (
    CategoryCreate,
    CategoryGroupCreate,
    CategoryGroupOut,
    CategoryGroupUpdate,
    CategoryOut,
    CategoryUpdate,
    SuggestedCategoriesAdded,
)

router = APIRouter(prefix="/categories", tags=["categories"])


def _category(db: Session, category_id: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That category doesn't exist anymore."
        )
    return category


def _group(db: Session, group_id: uuid.UUID) -> CategoryGroup:
    group = db.get(CategoryGroup, group_id)
    if group is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "That group doesn't exist anymore.")
    return group


def _name_taken(what: str, name: str) -> ApiError:
    return ApiError(
        status.HTTP_409_CONFLICT, "name_taken", f"There's already a {what} called {name}."
    )


def _ensure_unique(db: Session, model: type[Category] | type[CategoryGroup], name: str) -> None:
    """Names are unique whatever their case, so "groceries" can't sit beside "Groceries"."""
    clash = db.scalar(select(model.name).where(func.lower(model.name) == name.lower()).limit(1))
    if clash is not None:
        raise _name_taken("category" if model is Category else "group", clash)


def _commit(db: Session, what: str, name: str) -> None:
    # Two admins naming things at the same moment can still collide in the database.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _name_taken(what, name) from None


def _count(db: Session, category_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.category_id == category_id)
        )
        or 0
    )


@router.get("", response_model=list[CategoryGroupOut])
def list_categories(auth: CurrentAuth, db: Db) -> list[CategoryGroupOut]:
    return category_groups_out(db)


@router.post("/suggested", response_model=SuggestedCategoriesAdded)
def add_suggested(auth: AdminAuth, db: Db) -> SuggestedCategoriesAdded:
    """Adds the suggested categories the household doesn't have, e.g. after starting over."""
    added = add_suggested_categories(db)
    db.commit()
    return SuggestedCategoriesAdded(added=added, groups=category_groups_out(db))


# ---- Groups ----------------------------------------------------------------------------


def _group_out(db: Session, group: CategoryGroup) -> CategoryGroupOut:
    return next(item for item in category_groups_out(db) if item.id == group.id)


@router.post("/groups", response_model=CategoryGroupOut, status_code=status.HTTP_201_CREATED)
def create_group(body: CategoryGroupCreate, auth: AdminAuth, db: Db) -> CategoryGroupOut:
    _ensure_unique(db, CategoryGroup, body.name)
    group = CategoryGroup(name=body.name, kind=body.kind)
    db.add(group)
    _commit(db, "group", body.name)
    return _group_out(db, group)


@router.patch("/groups/{group_id}", response_model=CategoryGroupOut)
def update_group(
    group_id: uuid.UUID, body: CategoryGroupUpdate, auth: AdminAuth, db: Db
) -> CategoryGroupOut:
    group = _group(db, group_id)
    if body.name is not None and body.name != group.name:
        if body.name.lower() != group.name.lower():
            _ensure_unique(db, CategoryGroup, body.name)
        group.name = body.name
    if body.kind is not None:
        group.kind = body.kind
    _commit(db, "group", group.name)
    return _group_out(db, group)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Removes the group and its categories; their transactions become uncategorized."""
    db.delete(_group(db, group_id))
    db.commit()


# ---- Categories ------------------------------------------------------------------------


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, auth: AdminAuth, db: Db) -> CategoryOut:
    group = _group(db, body.group_id)
    _ensure_unique(db, Category, body.name)
    category = Category(group=group, name=body.name, emoji=body.emoji)
    db.add(category)
    _commit(db, "category", body.name)
    return category_out(category, 0)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: uuid.UUID, body: CategoryUpdate, auth: AdminAuth, db: Db
) -> CategoryOut:
    category = _category(db, category_id)
    if body.group_id is not None:
        category.group = _group(db, body.group_id)
    if body.name is not None and body.name != category.name:
        if body.name.lower() != category.name.lower():
            _ensure_unique(db, Category, body.name)
        category.name = body.name
    if body.emoji is not None:
        category.emoji = body.emoji
    _commit(db, "category", category.name)
    return category_out(category, _count(db, category.id))


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: uuid.UUID,
    auth: AdminAuth,
    db: Db,
    move_to: Annotated[uuid.UUID | None, Query()] = None,
) -> None:
    """Removes the category. Its transactions move to `move_to`, or become uncategorized."""
    category = _category(db, category_id)
    if move_to is not None:
        if move_to == category.id:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "same_category",
                "Choose a different category for its transactions.",
            )
        find_category(db, move_to)
        db.execute(
            update(Transaction)
            .where(Transaction.category_id == category.id)
            .values(category_id=move_to)
        )
    db.delete(category)
    db.commit()
