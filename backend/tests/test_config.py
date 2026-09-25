from pathlib import Path

import pytest

from app.config import Settings, get_settings


def test_defaults_target_bundled_postgres_socket(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)  # no stray .env file
    monkeypatch.delenv("CASHCOVE_DATABASE_URL", raising=False)
    monkeypatch.delenv("CASHCOVE_ENVIRONMENT", raising=False)
    settings = Settings()
    assert settings.database_url == "postgresql+psycopg://cashcove@/cashcove?host=/run/postgresql"
    assert settings.is_production
    assert not settings.enable_docs


def test_reads_prefixed_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CASHCOVE_ENVIRONMENT", "development")
    monkeypatch.setenv("CASHCOVE_ENABLE_DOCS", "true")
    settings = Settings()
    assert settings.environment == "development"
    assert not settings.is_production
    assert settings.enable_docs


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
