from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import StaticPool, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import get_session
from app.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(environment="test", database_url="sqlite://", enable_docs=True)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    with sessionmaker(bind=engine)() as session:
        yield session
    engine.dispose()


@pytest.fixture
def app(settings: Settings, session: Session) -> FastAPI:
    app = create_app(settings)
    app.dependency_overrides[get_session] = lambda: session
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client
