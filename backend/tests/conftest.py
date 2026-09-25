import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine, StaticPool, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import get_session
from app.main import create_app
from app.models import Base, Role, User
from tests.helpers import ORIGIN, SERVER_NAME, add_user, sign_in

# Set to a Postgres URL to run the suite against Postgres instead of in-memory SQLite.
TEST_DATABASE_URL = os.environ.get("CASHCOVE_TEST_DATABASE_URL")


def _enable_foreign_keys(connection: Any, _record: Any) -> None:
    # SQLite only enforces foreign keys (and their ON DELETE actions) when asked to.
    connection.execute("PRAGMA foreign_keys=ON")


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    if TEST_DATABASE_URL:
        engine = create_engine(TEST_DATABASE_URL)
        Base.metadata.drop_all(engine)
    else:
        engine = create_engine(
            "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
        )
        event.listen(engine, "connect", _enable_foreign_keys)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite://",
        enable_docs=True,
        server_name=SERVER_NAME,
        secret_key=SecretStr("test-secret-key-that-is-long-enough-for-hkdf"),
        # The cheapest Argon2id settings, so tests that hash passwords stay fast.
        password_time_cost=1,
        password_memory_kib=8,
        password_parallelism=1,
    )


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())


@pytest.fixture
def app(settings: Settings, session: Session) -> FastAPI:
    def request_session() -> Iterator[Session]:
        # Like a real request's session, anything not committed is rolled back at the end.
        try:
            yield session
        finally:
            session.rollback()

    app = create_app(settings)
    app.dependency_overrides[get_session] = request_session
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    # HTTPS, so the Secure session cookie is sent back like a browser would.
    with TestClient(app, base_url=ORIGIN) as client:
        yield client


@pytest.fixture
def admin(session: Session, settings: Settings) -> User:
    return add_user(session, settings, email="alex@example.com", name="Alex Rivera")


@pytest.fixture
def viewer(session: Session, settings: Settings) -> User:
    return add_user(session, settings, email="sam@example.com", name="Sam Lee", role=Role.VIEWER)


@pytest.fixture
def admin_client(client: TestClient, admin: User) -> TestClient:
    """A client signed in as an admin, sending the CSRF token like the web app does."""
    sign_in(client, admin.email)
    return client


@pytest.fixture
def viewer_client(client: TestClient, viewer: User) -> TestClient:
    sign_in(client, viewer.email)
    return client
