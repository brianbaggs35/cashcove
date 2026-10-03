from pathlib import Path

import pytest
from pydantic import SecretStr

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


def test_plaid_needs_both_client_id_and_secret() -> None:
    assert not Settings(plaid_client_id="id").plaid_configured
    assert not Settings(plaid_secret=SecretStr("secret")).plaid_configured
    assert Settings(plaid_client_id="id", plaid_secret=SecretStr("secret")).plaid_configured


def test_plaid_country_codes_come_as_a_list_or_comma_separated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert Settings(plaid_country_codes=["US", "GB"]).plaid_country_codes == ["US", "GB"]
    monkeypatch.setenv("CASHCOVE_PLAID_COUNTRY_CODES", "us, ca,")
    assert Settings().plaid_country_codes == ["US", "CA"]


def test_plaid_oauth_comes_back_to_the_connect_tab() -> None:
    settings = Settings(server_name="money.example.com", plaid_oauth_redirect=True)
    assert settings.plaid_redirect_uri == "https://money.example.com/connect/oauth"
    assert Settings().plaid_redirect_uri is None


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("https://rates.example.com/", "https://rates.example.com"),
        (" http://localhost:8080// ", "http://localhost:8080"),
        ("", ""),
    ],
)
def test_the_exchange_rate_server_is_a_web_address_or_nothing(given: str, expected: str) -> None:
    assert Settings(exchange_rate_url=given).exchange_rate_url == expected


def test_exchange_rates_come_from_frankfurter_unless_told_otherwise(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    assert Settings().exchange_rate_url == "https://api.frankfurter.dev"
    monkeypatch.setenv("CASHCOVE_EXCHANGE_RATE_URL", "")
    assert Settings().exchange_rate_url == ""


def test_the_exchange_rate_server_needs_a_web_address() -> None:
    with pytest.raises(ValueError, match="must start with https:// or http://"):
        Settings(exchange_rate_url="ftp://rates.example.com")
