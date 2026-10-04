"""Text as it's compared when matching one thing with another: lowercase, with single spaces."""

from sqlalchemy import ColumnElement, func
from sqlalchemy.orm import InstrumentedAttribute


def text_key(text: str) -> str:
    """Text as compared: lowercase, with single spaces."""
    return " ".join(text.lower().split())


def column_key(
    column: InstrumentedAttribute[str] | InstrumentedAttribute[str | None],
) -> ColumnElement[str]:
    """A column's text as compared, the way text_key does it, in the database."""
    return func.btrim(func.regexp_replace(func.lower(column), r"\s+", " ", "g"))
