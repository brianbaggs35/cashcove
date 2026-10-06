"""FastAPI dependencies that decide how requests reach an AI, and how a review that carries on
after its response gets a database session."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Annotated

import httpx2 as httpx
from fastapi import Depends
from sqlalchemy.orm import Session

from app.db import get_sessionmaker

# Opens a database session to use in a `with` block, which closes it.
Sessions = Callable[[], AbstractContextManager[Session]]


def ai_transport() -> httpx.BaseTransport | None:
    """How requests reach the AI providers: over the internet, unless the tests or the
    end-to-end harness put a stand-in for them here."""
    return None


def ai_sessions() -> Sessions:
    """Where a review that runs after its response opens its own database session."""
    return get_sessionmaker()


AITransport = Annotated[httpx.BaseTransport | None, Depends(ai_transport)]
AISessions = Annotated[Sessions, Depends(ai_sessions)]
