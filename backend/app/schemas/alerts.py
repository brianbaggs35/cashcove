"""Request and response models for Settings > Alerts delivery channels."""

import re
from typing import Annotated, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.models import SMTPTransport
from app.schemas.fields import STRICT

WebhookURL = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)]
SMTPHost = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
SMTPUsername = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=254)
]
SMTPPassword = Annotated[str, StringConstraints(min_length=1, max_length=512)]

_WEBHOOK_PATH = re.compile(r"^/api/webhooks/\d+/[A-Za-z0-9._-]+$")
_SMTP_HOST = re.compile(r"^[A-Za-z0-9_.:-]+$")


class AlertSettingsOut(BaseModel):
    """Delivery configuration, without webhook URLs or SMTP credentials."""

    discord_enabled: bool
    discord_configured: bool
    discord_webhook_set: bool
    smtp_enabled: bool
    smtp_configured: bool
    smtp_host: str | None
    smtp_port: int
    smtp_security: SMTPTransport
    smtp_username_set: bool
    smtp_password_set: bool
    smtp_from: str | None
    smtp_to: str | None


class AlertSettingsPatch(BaseModel):
    """Only supplied fields change. Secret fields stay unchanged unless replaced or cleared."""

    model_config = STRICT

    discord_enabled: bool | None = None
    discord_webhook_url: WebhookURL | None = None
    clear_discord_webhook: bool = False

    smtp_enabled: bool | None = None
    smtp_host: SMTPHost | None = None
    smtp_port: Annotated[int, Field(ge=1, le=65535)] | None = None
    smtp_security: SMTPTransport | None = None
    smtp_username: SMTPUsername | None = None
    smtp_password: SMTPPassword | None = None
    clear_smtp_credentials: bool = False
    smtp_from: EmailStr | None = None
    smtp_to: EmailStr | None = None

    @field_validator("discord_webhook_url")
    @classmethod
    def _discord_webhook(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError as error:
            raise PydanticCustomError(
                "discord_webhook", "Enter a valid Discord webhook URL."
            ) from error
        if (
            parsed.scheme != "https"
            or parsed.hostname not in {"discord.com", "discordapp.com"}
            or port not in {None, 443}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or not _WEBHOOK_PATH.fullmatch(parsed.path)
        ):
            raise PydanticCustomError("discord_webhook", "Enter a valid Discord webhook URL.")
        return value

    @field_validator("smtp_host")
    @classmethod
    def _smtp_host(cls, value: str | None) -> str | None:
        if value is not None and not _SMTP_HOST.fullmatch(value):
            raise PydanticCustomError(
                "smtp_host", "Enter a host name or IP address without a port."
            )
        return value

    @model_validator(mode="after")
    def _clear_is_unambiguous(self) -> Self:
        nullable_fields = {
            "discord_enabled",
            "smtp_enabled",
            "smtp_port",
            "smtp_security",
            "discord_webhook_url",
            "smtp_username",
            "smtp_password",
        }
        if any(
            field in self.model_fields_set and getattr(self, field) is None
            for field in nullable_fields
        ):
            raise PydanticCustomError(
                "alert_setting_null", "Leave a setting out to keep it, or use its clear option."
            )
        if self.clear_discord_webhook and self.discord_webhook_url is not None:
            raise PydanticCustomError(
                "discord_webhook_clear", "Enter a webhook URL or choose to clear it."
            )
        if self.clear_smtp_credentials and (
            self.smtp_username is not None or self.smtp_password is not None
        ):
            raise PydanticCustomError(
                "smtp_credentials_clear", "Enter new credentials or choose to clear them."
            )
        return self


class AlertTestOut(BaseModel):
    ok: bool
    message: str
