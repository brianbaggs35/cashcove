from collections.abc import Iterator

import pytest
from sqlalchemy import text

from app import db
from app.config import Settings


@pytest.fixture(autouse=True)
def sqlite_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(db, "get_settings", lambda: Settings(database_url="sqlite://"))
    db.get_engine.cache_clear()
    db.get_sessionmaker.cache_clear()
    yield
    db.get_engine().dispose()
    db.get_engine.cache_clear()
    db.get_sessionmaker.cache_clear()


def test_engine_uses_configured_url() -> None:
    assert str(db.get_engine().url) == "sqlite://"
    assert db.get_engine() is db.get_engine()


def test_get_session_yields_working_session_and_closes_it() -> None:
    sessions = db.get_session()
    session = next(sessions)
    assert session.execute(text("SELECT 1")).scalar_one() == 1
    with pytest.raises(StopIteration):
        next(sessions)
