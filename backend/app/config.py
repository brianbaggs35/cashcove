"""Application settings, read from ``CASHCOVE_*`` environment variables."""

import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CASHCOVE_", env_file=".env", extra="ignore")

    environment: Literal["production", "development", "test"] = "production"
    # The version a release image was built as, which the release workflow stamps in from
    # the release's tag. Builds from source report the version in app/__init__.py.
    release: str | None = None
    # The bundled Postgres only listens on its unix socket, and the API connects with peer auth.
    database_url: str = "postgresql+psycopg://cashcove@/cashcove?host=/run/postgresql"
    database_echo: bool = False
    # Interactive OpenAPI docs are off unless explicitly enabled.
    enable_docs: bool = False

    # The name people browse to and the host port it's served on. Passkeys and the check
    # that requests really come from Cashcove's own pages are bound to this address.
    server_name: str = "localhost"
    https_port: Annotated[int, Field(ge=1, le=65535)] = 443

    # Encrypts sensitive values such as authenticator-app keys before they're stored. The
    # container generates the key file on first start; CASHCOVE_SECRET_KEY overrides it.
    secret_key: SecretStr | None = None
    secret_key_file: Path = Path("/data/secrets/secret.key")

    # Argon2id cost for password hashes: RFC 9106's second recommended profile (64 MiB).
    password_time_cost: Annotated[int, Field(ge=1)] = 3
    password_memory_kib: Annotated[int, Field(ge=8)] = 65536
    password_parallelism: Annotated[int, Field(ge=1)] = 4

    # Plaid API credentials, from https://dashboard.plaid.com/developers/keys.
    plaid_env: Literal["sandbox", "production"] = "sandbox"
    plaid_client_id: str | None = None
    plaid_secret: SecretStr | None = None

    @property
    def version(self) -> str:
        return self.release or __version__

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def plaid_configured(self) -> bool:
        return bool(self.plaid_client_id and self.plaid_secret)

    @property
    def public_origin(self) -> str:
        port = "" if self.https_port == 443 else f":{self.https_port}"
        return f"https://{self.server_name}{port}"

    @property
    def passkeys_supported(self) -> bool:
        """Passkeys are bound to a domain name, so an install reached by IP can't offer them."""
        try:
            ipaddress.ip_address(self.server_name)
        except ValueError:
            return True
        return False

    def read_secret_key(self) -> bytes:
        if self.secret_key is not None:
            value = self.secret_key.get_secret_value()
        else:
            value = self.secret_key_file.read_text(encoding="utf-8")
        key = value.strip().encode()
        if len(key) < 32:
            raise ValueError("The Cashcove secret key must be at least 32 characters long")
        return key


@lru_cache
def get_settings() -> Settings:
    return Settings()
