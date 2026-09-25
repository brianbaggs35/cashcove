"""Application settings, read from ``CASHCOVE_*`` environment variables."""

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CASHCOVE_", env_file=".env", extra="ignore")

    environment: Literal["production", "development", "test"] = "production"
    # The bundled Postgres only listens on its unix socket, and the API connects with peer auth.
    database_url: str = "postgresql+psycopg://cashcove@/cashcove?host=/run/postgresql"
    database_echo: bool = False
    # Interactive OpenAPI docs are off unless explicitly enabled.
    enable_docs: bool = False

    # Plaid API credentials, from https://dashboard.plaid.com/developers/keys.
    plaid_env: Literal["sandbox", "production"] = "sandbox"
    plaid_client_id: str | None = None
    plaid_secret: SecretStr | None = None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def plaid_configured(self) -> bool:
        return bool(self.plaid_client_id and self.plaid_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
