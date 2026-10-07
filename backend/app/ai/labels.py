"""The household's own names for things, as an AI is told them."""

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.privacy import Protected, Text
from app.finance.text import text_key
from app.models import Category, CategoryGroup


def categories(db: Session, protected: Protected) -> tuple[str, dict[str, uuid.UUID]]:
    """The categories to choose from as text, by group, and by the name they're compared by."""
    rows = db.execute(
        select(CategoryGroup.name, CategoryGroup.kind, Category.name, Category.id)
        .join(Category, Category.group_id == CategoryGroup.id)
        .order_by(CategoryGroup.name, Category.name)
    ).all()
    grouped: defaultdict[str, list[str]] = defaultdict(list)
    by_name: dict[str, uuid.UUID] = {}
    for group, kind, name, category_id in rows:
        grouped[f"{protected.scrub(group, Text.LABEL)} ({kind})"].append(
            protected.scrub(name, Text.LABEL)
        )
        by_name[text_key(name)] = category_id
    text = "\n".join(f"{group}: {'; '.join(names)}" for group, names in grouped.items())
    return text, by_name
