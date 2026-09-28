from collections.abc import Iterator

import pytest
from sqlalchemy import text

from app import db
from app.config import Settings
from tests.helpers import TEST_DATABASE_URL


@pytest.fixture(autouse=True)
def configured_database(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(db, "get_settings", lambda: Settings(database_url=TEST_DATABASE_URL))
    db.get_engine.cache_clear()
    db.get_sessionmaker.cache_clear()
    yield
    db.get_engine().dispose()
    db.get_engine.cache_clear()
    db.get_sessionmaker.cache_clear()


def test_engine_uses_configured_url() -> None:
    assert db.get_engine().url.render_as_string(hide_password=False) == TEST_DATABASE_URL
    assert db.get_engine() is db.get_engine()


def test_get_session_yields_working_session_and_closes_it() -> None:
    sessions = db.get_session()
    session = next(sessions)
    assert session.execute(text("SELECT 1")).scalar_one() == 1
    with pytest.raises(StopIteration):
        next(sessions)
