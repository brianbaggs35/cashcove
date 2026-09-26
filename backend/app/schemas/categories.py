"""Request and response models for categories and their groups."""

import uuid

from pydantic import BaseModel

from app.models import CategoryKind
from app.schemas.fields import STRICT, CategoryName, Emoji


class CategoryOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    name: str
    emoji: str
    transaction_count: int


class CategoryGroupOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: CategoryKind
    categories: list[CategoryOut]


class CategoryCreate(BaseModel):
    model_config = STRICT

    group_id: uuid.UUID
    name: CategoryName
    emoji: Emoji = "🏷️"


class CategoryUpdate(BaseModel):
    """Leave a field out to keep it."""

    model_config = STRICT

    group_id: uuid.UUID | None = None
    name: CategoryName | None = None
    emoji: Emoji | None = None


class CategoryGroupCreate(BaseModel):
    model_config = STRICT

    name: CategoryName
    kind: CategoryKind = CategoryKind.EXPENSE


class CategoryGroupUpdate(BaseModel):
    """Leave a field out to keep it."""

    model_config = STRICT

    name: CategoryName | None = None
    kind: CategoryKind | None = None


class SuggestedCategoriesAdded(BaseModel):
    added: int
    groups: list[CategoryGroupOut]
