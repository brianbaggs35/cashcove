"""Application settings, read from ``CASHCOVE_*`` environment variables."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CASHCOVE_", env_file=".env", extra="ignore")

    environment: Literal["production", "development", "test"] = "production"
    # The bundled Postgres only listens on its unix socket, and the API connects with peer auth.
    database_url: str = "postgresql+psycopg://cashcove@/cashcove?host=/run/postgresql"
    database_echo: bool = False
    # Interactive OpenAPI docs are off unless explicitly enabled.
    enable_docs: bool = False

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
