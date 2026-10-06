from collections.abc import Iterator
from contextlib import nullcontext

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.ai.deps import ai_sessions, ai_transport
from app.config import Settings
from app.db import get_session
from app.finance import exchange_rates
from app.finance.exchange_rates import exchange_rate_transport
from app.main import create_app
from app.models import Base, Role, User
from e2e.ai import FakeAI
from tests.helpers import ORIGIN, SERVER_NAME, TEST_DATABASE_URL, add_user, sign_in
from tests.rates import NOW, FakeRates


def pytest_configure() -> None:
    if not TEST_DATABASE_URL.startswith("postgresql"):
        raise pytest.UsageError(
            "The tests run on Postgres. Run `make test-backend`, which starts one, or set "
            "CASHCOVE_TEST_DATABASE_URL to a Postgres database the tests may empty."
        )


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        environment="test",
        database_url=TEST_DATABASE_URL,
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
def rates(monkeypatch: pytest.MonkeyPatch) -> FakeRates:
    """The exchange rate server, which has no rates until a test gives it some. The clock
    stands still, so which days have final rates doesn't depend on when the tests run."""
    monkeypatch.setattr(exchange_rates, "utcnow", lambda: NOW)
    return FakeRates()


@pytest.fixture
def fake_ai() -> FakeAI:
    """The AI providers, which answer by rules and remember what they were asked."""
    return FakeAI()


@pytest.fixture
def app(settings: Settings, session: Session, rates: FakeRates, fake_ai: FakeAI) -> FastAPI:
    def request_session() -> Iterator[Session]:
        # Like a real request's session, anything not committed is rolled back at the end.
        try:
            yield session
        finally:
            session.rollback()

    app = create_app(settings)
    app.dependency_overrides[get_session] = request_session
    app.dependency_overrides[exchange_rate_transport] = lambda: rates.transport
    app.dependency_overrides[ai_transport] = lambda: fake_ai.transport
    # A review that carries on after its response uses the test's own session, which it
    # leaves open for the test to look at.
    app.dependency_overrides[ai_sessions] = lambda: lambda: nullcontext(session)
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
