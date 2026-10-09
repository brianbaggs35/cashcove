"""Configure alert channels, test them, and deliver alert events without exposing secrets."""

import asyncio
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

import aiosmtplib
import httpx2 as httpx
from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.alerts import delivery
from app.auth.crypto import DecryptionError
from app.auth.deps import ApiError
from app.auth.service import alert_box, load_preferences
from app.config import Settings
from app.models import (
    Account,
    AlertChannel,
    AlertDelivery,
    AlertSettings,
    AlertType,
    SMTPTransport,
    Transaction,
)
from app.models.alerts import ALERT_SETTINGS_ID
from app.models.base import utcnow
from app.schemas.alerts import AlertSettingsOut, AlertSettingsPatch, AlertTestOut
from app.schemas.preferences import AlertPreferences

log = logging.getLogger(__name__)

RETRY_AFTER = timedelta(minutes=5)
DISCORD_WEBHOOK_LABEL = "Discord webhook"
SMTP_USERNAME_LABEL = "SMTP username"
SMTP_AUTH_VALUE_LABEL = "SMTP authentication value"
ENABLED_PREFERENCE: dict[AlertType, str] = {
    AlertType.SUBSCRIPTION_DUE: "subscription_due_enabled",
    AlertType.BILL_DUE: "bill_due_enabled",
    AlertType.LOW_BALANCE: "low_balance_enabled",
    AlertType.LARGE_TRANSACTION: "large_transaction_enabled",
    AlertType.BUDGET_THRESHOLD: "budget_threshold_enabled",
    AlertType.SYNC_FAILURE: "sync_failure_enabled",
}
type DeliveryFailure = aiosmtplib.SMTPException | httpx.HTTPError | OSError


@dataclass(frozen=True)
class ChannelSettings:
    discord_url: str | None
    smtp: delivery.SMTPConnection | None


def _decrypt(settings: Settings, value: str | None, label: str) -> str | None:
    if value is None:
        return None
    try:
        return alert_box(settings).decrypt(value)
    except DecryptionError:
        log.warning("Couldn't decrypt the saved %s. Replace it in Settings > Alerts.", label)
        return None


def _row(db: Session) -> AlertSettings | None:
    return db.get(AlertSettings, ALERT_SETTINGS_ID)


def _smtp_from_row(settings: Settings, row: AlertSettings | None) -> delivery.SMTPConnection | None:
    if row is None or not row.smtp_enabled:
        return None
    username = _decrypt(settings, row.smtp_username, SMTP_USERNAME_LABEL)
    password = _decrypt(settings, row.smtp_password, SMTP_AUTH_VALUE_LABEL)
    if (
        not row.smtp_host
        or not row.smtp_from
        or not row.smtp_to
        or (row.smtp_username is not None and username is None)
        or (row.smtp_password is not None and password is None)
        or bool(username) != bool(password)
    ):
        return None
    return delivery.SMTPConnection(
        host=row.smtp_host,
        port=row.smtp_port,
        security=row.smtp_security,
        username=username,
        password=password,
        sender=row.smtp_from,
        recipient=row.smtp_to,
    )


def _channels(settings: Settings, row: AlertSettings | None) -> ChannelSettings:
    return ChannelSettings(
        discord_url=(
            _decrypt(settings, row.discord_webhook_url, DISCORD_WEBHOOK_LABEL)
            if row is not None and row.discord_enabled
            else None
        ),
        smtp=_smtp_from_row(settings, row),
    )


def settings_out(db: Session, settings: Settings) -> AlertSettingsOut:
    row = _row(db)
    channels = _channels(settings, row)
    webhook_set = (
        _decrypt(settings, row.discord_webhook_url, DISCORD_WEBHOOK_LABEL) is not None
        if row is not None
        else False
    )
    username_set = (
        _decrypt(settings, row.smtp_username, SMTP_USERNAME_LABEL) is not None
        if row is not None
        else False
    )
    password_set = (
        _decrypt(settings, row.smtp_password, SMTP_AUTH_VALUE_LABEL) is not None
        if row is not None
        else False
    )
    return AlertSettingsOut(
        discord_enabled=row.discord_enabled if row else False,
        discord_configured=channels.discord_url is not None,
        discord_webhook_set=webhook_set,
        smtp_enabled=row.smtp_enabled if row else False,
        smtp_configured=channels.smtp is not None,
        smtp_host=row.smtp_host if row else None,
        smtp_port=row.smtp_port if row else 587,
        smtp_security=row.smtp_security if row else SMTPTransport.STARTTLS,
        smtp_username_set=username_set,
        smtp_password_set=password_set,
        smtp_from=row.smtp_from if row else None,
        smtp_to=row.smtp_to if row else None,
    )


def _invalid(code: str, message: str) -> ApiError:
    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, code, message)


def _validate_discord(settings: Settings, row: AlertSettings) -> None:
    if row.discord_enabled and not _decrypt(
        settings, row.discord_webhook_url, DISCORD_WEBHOOK_LABEL
    ):
        raise _invalid(
            "discord_webhook_required",
            f"Enter a {DISCORD_WEBHOOK_LABEL} URL before enabling Discord alerts.",
        )


def _validate_smtp(settings: Settings, row: AlertSettings) -> None:
    if not row.smtp_enabled:
        return
    username = _decrypt(settings, row.smtp_username, SMTP_USERNAME_LABEL)
    password = _decrypt(settings, row.smtp_password, SMTP_AUTH_VALUE_LABEL)
    if not row.smtp_host or not row.smtp_from or not row.smtp_to:
        raise _invalid(
            "smtp_settings_required",
            "Enter the SMTP host, sender address and alert recipient before enabling email.",
        )
    if (row.smtp_username is not None and username is None) or (
        row.smtp_password is not None and password is None
    ):
        raise _invalid(
            "smtp_credentials_unreadable",
            "Re-enter the SMTP credentials because Cashcove can't decrypt the saved values.",
        )
    if bool(username) != bool(password):
        raise _invalid(
            "smtp_credentials_incomplete",
            f"Enter both the {SMTP_USERNAME_LABEL} and password, or clear SMTP authentication.",
        )
    if username and row.smtp_security == SMTPTransport.NONE:
        raise _invalid(
            "smtp_auth_requires_tls",
            "Choose STARTTLS or SSL/TLS when SMTP authentication is enabled.",
        )


def save_settings(
    db: Session, settings: Settings, body: AlertSettingsPatch, user_id: UUID
) -> AlertSettingsOut:
    row = _row(db) or AlertSettings(id=ALERT_SETTINGS_ID)
    fields = body.model_fields_set

    if body.clear_discord_webhook:
        row.discord_webhook_url = None
    elif body.discord_webhook_url is not None:
        row.discord_webhook_url = alert_box(settings).encrypt(body.discord_webhook_url)
    if body.discord_enabled is not None:
        row.discord_enabled = body.discord_enabled

    if body.clear_smtp_credentials:
        row.smtp_username = None
        row.smtp_password = None
    else:
        if body.smtp_username is not None:
            row.smtp_username = alert_box(settings).encrypt(body.smtp_username)
        if body.smtp_password is not None:
            row.smtp_password = alert_box(settings).encrypt(body.smtp_password)

    for field, column in (
        ("smtp_enabled", "smtp_enabled"),
        ("smtp_host", "smtp_host"),
        ("smtp_port", "smtp_port"),
        ("smtp_security", "smtp_security"),
        ("smtp_from", "smtp_from"),
        ("smtp_to", "smtp_to"),
    ):
        if field in fields and getattr(body, field) is not None:
            setattr(row, column, getattr(body, field))
    row.updated_by_id = user_id

    _validate_discord(settings, row)
    _validate_smtp(settings, row)
    db.add(row)
    db.commit()
    return settings_out(db, settings)


def _patched_value(
    row: AlertSettings | None, body: AlertSettingsPatch, name: str, default: object = None
) -> object:
    if name in body.model_fields_set:
        value = getattr(body, name)
        if value is not None:
            return value
    return getattr(row, name, default) if row is not None else default


def _smtp_credentials(
    settings: Settings, row: AlertSettings | None, body: AlertSettingsPatch
) -> tuple[str | None, str | None]:
    if body.clear_smtp_credentials:
        return None, None
    username = body.smtp_username
    password = body.smtp_password
    if row is not None:
        username = username or _decrypt(settings, row.smtp_username, SMTP_USERNAME_LABEL)
        password = password or _decrypt(settings, row.smtp_password, SMTP_AUTH_VALUE_LABEL)
        if (row.smtp_username is not None and username is None) or (
            row.smtp_password is not None and password is None
        ):
            raise _invalid(
                "smtp_credentials_unreadable",
                "Re-enter the SMTP credentials because Cashcove can't decrypt the saved values.",
            )
    return username, password


def _smtp_connection_fields(
    row: AlertSettings | None, body: AlertSettingsPatch
) -> tuple[str, str, str, int, SMTPTransport]:
    host = _patched_value(row, body, "smtp_host")
    sender = _patched_value(row, body, "smtp_from")
    recipient = _patched_value(row, body, "smtp_to")
    if not isinstance(host, str) or not host:
        raise _invalid(
            "smtp_settings_required",
            "Enter the SMTP host, sender address and alert recipient first.",
        )
    if not isinstance(sender, str) or not sender or not isinstance(recipient, str) or not recipient:
        raise _invalid(
            "smtp_settings_required",
            "Enter the SMTP host, sender address and alert recipient first.",
        )
    port = _patched_value(row, body, "smtp_port", 587)
    security = _patched_value(row, body, "smtp_security", SMTPTransport.STARTTLS)
    if not isinstance(port, int) or not isinstance(security, SMTPTransport):
        raise _invalid("smtp_settings_invalid", "Check the SMTP port and security setting.")
    return host, sender, recipient, port, security


def _smtp_draft(
    db: Session, settings: Settings, body: AlertSettingsPatch
) -> delivery.SMTPConnection:
    row = _row(db)
    username, password = _smtp_credentials(settings, row, body)
    host, sender, recipient, port, security = _smtp_connection_fields(row, body)
    if bool(username) != bool(password):
        raise _invalid(
            "smtp_credentials_incomplete",
            f"Enter both the {SMTP_USERNAME_LABEL} and password, or clear SMTP authentication.",
        )
    if username and security == SMTPTransport.NONE:
        raise _invalid(
            "smtp_auth_requires_tls",
            "Choose STARTTLS or SSL/TLS when SMTP authentication is enabled.",
        )
    return delivery.SMTPConnection(
        host=host,
        port=port,
        security=security,
        username=username,
        password=password,
        sender=sender,
        recipient=recipient,
    )


def connection_test_problem(error: DeliveryFailure, channel: AlertChannel) -> str:
    if isinstance(error, aiosmtplib.SMTPAuthenticationError):
        return "The SMTP server rejected the username or password."
    if isinstance(error, aiosmtplib.SMTPRecipientsRefused):
        return "The SMTP server rejected the alert recipient. Check the email address."
    if isinstance(error, httpx.HTTPStatusError):
        return f"Discord rejected the test message (HTTP {error.response.status_code})."
    if isinstance(error, aiosmtplib.SMTPResponseException):
        return "The SMTP server rejected the test email. Check the sender and recipient addresses."
    if channel == AlertChannel.DISCORD:
        return "Couldn't reach Discord. Check the webhook URL and try again."
    return "Couldn't connect to the SMTP server. Check its host, port and security setting."


async def test_smtp(db: Session, settings: Settings, body: AlertSettingsPatch) -> AlertTestOut:
    connection = _smtp_draft(db, settings, body)
    try:
        await delivery.send_email(
            connection,
            "Cashcove SMTP test",
            "This test email confirms that Cashcove can send alerts through this SMTP server.",
        )
    except (aiosmtplib.SMTPException, httpx.HTTPError, OSError) as error:
        log.warning("SMTP connection test failed (%s).", type(error).__name__)
        return AlertTestOut(ok=False, message=connection_test_problem(error, AlertChannel.EMAIL))
    return AlertTestOut(ok=True, message=f"Test email sent to {connection.recipient}.")


async def test_discord(db: Session, settings: Settings, body: AlertSettingsPatch) -> AlertTestOut:
    url = body.discord_webhook_url
    if body.clear_discord_webhook:
        url = None
    elif url is None:
        row = _row(db)
        url = _decrypt(settings, row.discord_webhook_url, DISCORD_WEBHOOK_LABEL) if row else None
    if not url:
        raise _invalid("discord_webhook_required", f"Enter a {DISCORD_WEBHOOK_LABEL} URL first.")
    try:
        await delivery.send_discord(url, "Cashcove test alert: Discord notifications are working.")
    except (httpx.HTTPError, OSError) as error:
        log.warning("Discord connection test failed (%s).", type(error).__name__)
        return AlertTestOut(ok=False, message=connection_test_problem(error, AlertChannel.DISCORD))
    return AlertTestOut(ok=True, message="Test message sent to Discord.")


def _format_amount(amount: Decimal, currency: str) -> str:
    return f"{amount:,.2f} {currency}"


@dataclass(frozen=True)
class LargeTransactionAlert:
    event_key: str
    title: str
    message: str
    subject_id: UUID


def _large_transaction_alert(
    db: Session, preferences: AlertPreferences, transaction: Transaction
) -> LargeTransactionAlert | None:
    if (
        not preferences.large_transaction_enabled
        or abs(transaction.amount) <= preferences.large_transaction_threshold
    ):
        return None
    account = db.get(Account, transaction.account_id)
    if account is None:
        log.warning("Skipping a large-transaction alert because its account no longer exists.")
        return None
    amount = _format_amount(abs(transaction.amount), account.currency)
    return LargeTransactionAlert(
        event_key=f"large_transaction:{transaction.id}",
        title=f"Large transaction: {transaction.payee}",
        message=f"{amount} on {transaction.date.isoformat()} in {account.name}.",
        subject_id=transaction.id,
    )


def enqueue_large_transaction(db: Session, settings: Settings, transaction: Transaction) -> bool:
    return enqueue_large_transactions(db, settings, [transaction]) > 0


def enqueue_large_transactions(
    db: Session, settings: Settings, transactions: Iterable[Transaction]
) -> int:
    """Queues large transactions for the background alert worker without blocking the request."""
    preferences = load_preferences(db).alerts
    if not preferences.large_transaction_enabled:
        return 0
    channels = _channels(settings, _row(db))
    available = [
        (AlertChannel.DISCORD, channels.discord_url),
        (AlertChannel.EMAIL, channels.smtp),
    ]
    queued = 0
    for transaction in transactions:
        alert = _large_transaction_alert(db, preferences, transaction)
        if alert is None:
            continue
        for channel, config in available:
            if config is None:
                continue
            exists = db.scalar(
                select(AlertDelivery.id).where(
                    AlertDelivery.event_key == alert.event_key,
                    AlertDelivery.channel == channel,
                )
            )
            if exists is not None:
                continue
            db.add(
                AlertDelivery(
                    event_key=alert.event_key,
                    alert_type=AlertType.LARGE_TRANSACTION,
                    channel=channel,
                    subject_id=alert.subject_id,
                    attempts=0,
                )
            )
            queued += 1
    if queued:
        db.commit()
    return queued


def deliver_large_transaction(db: Session, settings: Settings, transaction: Transaction) -> bool:
    alert = _large_transaction_alert(db, load_preferences(db).alerts, transaction)
    if alert is None:
        return False
    return deliver_alert(
        db,
        settings,
        AlertType.LARGE_TRANSACTION,
        alert.event_key,
        alert.title,
        alert.message,
        subject_id=alert.subject_id,
    )


def _deliver_channel(
    db: Session,
    alert_type: AlertType,
    event_key: str,
    title: str,
    message: str,
    channel: AlertChannel,
    config: str | delivery.SMTPConnection | None,
    subject_id: UUID | None,
    now: datetime,
) -> bool:
    if config is None:
        return False
    row = db.scalar(
        select(AlertDelivery).where(
            AlertDelivery.event_key == event_key,
            AlertDelivery.channel == channel,
        )
    )
    if row is not None and row.sent_at is not None:
        return True
    if (
        row is not None
        and row.last_attempt_at is not None
        and now - row.last_attempt_at < RETRY_AFTER
    ):
        return False
    if row is None:
        row = AlertDelivery(
            event_key=event_key,
            alert_type=alert_type,
            channel=channel,
            subject_id=subject_id,
            attempts=0,
        )
        db.add(row)
    row.attempts += 1
    row.last_attempt_at = now
    db.commit()
    try:
        if isinstance(config, str):
            asyncio.run(delivery.send_discord(config, f"**{title}**\n{message}"))
        else:
            asyncio.run(delivery.send_email(config, title, message))
    except (aiosmtplib.SMTPException, httpx.HTTPError, OSError) as error:
        row.last_error = type(error).__name__[:64]
        db.commit()
        log.warning(
            "Couldn't deliver %s alert through %s (%s).",
            alert_type.value,
            channel.value,
            type(error).__name__,
        )
        return False
    row.sent_at = utcnow()
    row.last_error = None
    db.commit()
    return True


def deliver_alert(
    db: Session,
    settings: Settings,
    alert_type: AlertType,
    event_key: str,
    title: str,
    message: str,
    *,
    subject_id: UUID | None = None,
) -> bool:
    """Attempts an alert through each enabled channel. A failed channel is retried later."""
    preferences = load_preferences(db).alerts
    if not getattr(preferences, ENABLED_PREFERENCE[alert_type]):
        return False

    channels = _channels(settings, _row(db))
    now = utcnow()
    discord_sent = _deliver_channel(
        db,
        alert_type,
        event_key,
        title,
        message,
        AlertChannel.DISCORD,
        channels.discord_url,
        subject_id,
        now,
    )
    email_sent = _deliver_channel(
        db,
        alert_type,
        event_key,
        title,
        message,
        AlertChannel.EMAIL,
        channels.smtp,
        subject_id,
        now,
    )
    return discord_sent or email_sent


def amount_text(amount: Decimal, currency: str) -> str:
    """A displayable amount for an alert message."""
    return _format_amount(amount, currency)
