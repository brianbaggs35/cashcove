"""Alert delivery settings are admin-managed, and every saved secret stays encrypted."""

from typing import Any

import aiosmtplib
import httpx2 as httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.alerts import delivery, service
from app.auth.service import alert_box
from app.config import Settings
from app.models import AlertSettings, SMTPTransport
from tests.helpers import error

WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/this_is_a_secret_token"


def smtp_config(**changes: Any) -> dict[str, Any]:
    return {
        "smtp_enabled": True,
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_security": "starttls",
        "smtp_username": "smtp-user",
        "smtp_password": "smtp-password-secret",
        "smtp_from": "alerts@example.com",
        "smtp_to": "alex@example.com",
        **changes,
    }


def test_returns_empty_channel_settings(viewer_client: TestClient) -> None:
    response = viewer_client.get("/api/alerts/settings")

    assert response.status_code == 200
    assert response.json() == {
        "discord_enabled": False,
        "discord_configured": False,
        "discord_webhook_set": False,
        "smtp_enabled": False,
        "smtp_configured": False,
        "smtp_host": None,
        "smtp_port": 587,
        "smtp_security": "starttls",
        "smtp_username_set": False,
        "smtp_password_set": False,
        "smtp_from": None,
        "smtp_to": None,
    }


def test_saves_both_channels_encrypted_and_never_returns_secrets(
    admin_client: TestClient, session: Session, settings: Settings
) -> None:
    response = admin_client.patch(
        "/api/alerts/settings",
        json={
            "discord_enabled": True,
            "discord_webhook_url": WEBHOOK,
            **smtp_config(),
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result == {
        "discord_enabled": True,
        "discord_configured": True,
        "discord_webhook_set": True,
        "smtp_enabled": True,
        "smtp_configured": True,
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_security": "starttls",
        "smtp_username_set": True,
        "smtp_password_set": True,
        "smtp_from": "alerts@example.com",
        "smtp_to": "alex@example.com",
    }
    row = session.get_one(AlertSettings, 1)
    assert WEBHOOK not in (row.discord_webhook_url or "")
    assert "smtp-user" not in (row.smtp_username or "")
    assert "smtp-password-secret" not in (row.smtp_password or "")
    assert alert_box(settings).decrypt(row.discord_webhook_url or "") == WEBHOOK
    assert alert_box(settings).decrypt(row.smtp_username or "") == "smtp-user"
    assert alert_box(settings).decrypt(row.smtp_password or "") == "smtp-password-secret"
    response_json = str(admin_client.get("/api/alerts/settings").json())
    assert WEBHOOK not in response_json
    assert "smtp-user" not in response_json
    assert "smtp-password-secret" not in response_json


def test_partial_updates_preserve_secrets_and_clear_them_only_when_asked(
    admin_client: TestClient, session: Session, settings: Settings
) -> None:
    admin_client.patch(
        "/api/alerts/settings",
        json={"discord_enabled": True, "discord_webhook_url": WEBHOOK, **smtp_config()},
    )

    changed = admin_client.patch(
        "/api/alerts/settings",
        json={"smtp_host": "relay.example.test", "smtp_security": "ssl"},
    )
    assert changed.status_code == 200
    row = session.get_one(AlertSettings, 1)
    assert alert_box(settings).decrypt(row.discord_webhook_url or "") == WEBHOOK
    assert alert_box(settings).decrypt(row.smtp_username or "") == "smtp-user"
    assert alert_box(settings).decrypt(row.smtp_password or "") == "smtp-password-secret"
    assert row.smtp_host == "relay.example.test"
    assert row.smtp_security == "ssl"

    cleared = admin_client.patch(
        "/api/alerts/settings",
        json={
            "discord_enabled": False,
            "clear_discord_webhook": True,
            "smtp_enabled": False,
            "clear_smtp_credentials": True,
        },
    )
    assert cleared.status_code == 200
    row = session.get_one(AlertSettings, 1)
    assert row.discord_webhook_url is None
    assert row.smtp_username is None
    assert row.smtp_password is None
    assert cleared.json()["discord_webhook_set"] is False
    assert cleared.json()["smtp_username_set"] is False
    assert cleared.json()["smtp_password_set"] is False


def test_rejects_invalid_channel_configuration(admin_client: TestClient) -> None:
    for webhook in (
        "http://discord.com/api/webhooks/123/token",
        "https://example.test/api/webhooks/123/token",
        "https://discord.com/api/webhooks/not-an-id/token",
        "https://discord.com:8443/api/webhooks/123/token",
        "https://discord.com:bad/api/webhooks/123/token",
    ):
        assert (
            admin_client.patch(
                "/api/alerts/settings",
                json={"discord_webhook_url": webhook},
            ).status_code
            == 422
        )

    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"smtp_host": "bad host"},
        ).status_code
        == 422
    )
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"smtp_from": "not an email"},
        ).status_code
        == 422
    )
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"smtp_port": 65536},
        ).status_code
        == 422
    )
    assert admin_client.patch("/api/alerts/settings", json={"smtp_host": None}).status_code == 200


def test_enabled_channels_require_complete_configuration(admin_client: TestClient) -> None:
    discord = admin_client.patch("/api/alerts/settings", json={"discord_enabled": True})
    assert discord.status_code == 422
    assert error(discord) == "discord_webhook_required"

    incomplete = smtp_config()
    incomplete.pop("smtp_password")
    smtp = admin_client.patch("/api/alerts/settings", json=incomplete)
    assert smtp.status_code == 422
    assert error(smtp) == "smtp_credentials_incomplete"

    insecure_auth = admin_client.patch(
        "/api/alerts/settings",
        json=smtp_config(smtp_security="none"),
    )
    assert insecure_auth.status_code == 422
    assert error(insecure_auth) == "smtp_auth_requires_tls"

    unauthenticated = smtp_config()
    unauthenticated.pop("smtp_username")
    unauthenticated.pop("smtp_password")
    unauthenticated["smtp_to"] = None
    missing_address = admin_client.patch(
        "/api/alerts/settings",
        json=unauthenticated,
    )
    assert missing_address.status_code == 422
    assert error(missing_address) == "smtp_settings_required"


def test_patch_cannot_clear_a_secret_ambiguously(admin_client: TestClient) -> None:
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"clear_discord_webhook": True, "discord_webhook_url": WEBHOOK},
        ).status_code
        == 422
    )
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={
                "clear_smtp_credentials": True,
                "smtp_password": "replacement",
            },
        ).status_code
        == 422
    )
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"unexpected": "field"},
        ).status_code
        == 422
    )
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"smtp_enabled": None},
        ).status_code
        == 422
    )
    assert (
        admin_client.patch(
            "/api/alerts/settings",
            json={"discord_webhook_url": None},
        ).status_code
        == 422
    )


def test_viewers_can_read_but_only_admins_can_edit_or_test(viewer_client: TestClient) -> None:
    assert viewer_client.get("/api/alerts/settings").status_code == 200
    assert error(viewer_client.patch("/api/alerts/settings", json={})) == "admin_only"
    assert error(viewer_client.post("/api/alerts/smtp/test", json={})) == "admin_only"
    assert error(viewer_client.post("/api/alerts/discord/test", json={})) == "admin_only"


def test_smtp_test_sends_a_message_with_form_settings(
    admin_client: TestClient, monkeypatch: Any
) -> None:
    calls: list[tuple[delivery.SMTPConnection, str, str]] = []

    async def send(connection: delivery.SMTPConnection, subject: str, body: str) -> None:
        calls.append((connection, subject, body))

    monkeypatch.setattr(delivery, "send_email", send)
    response = admin_client.post(
        "/api/alerts/smtp/test",
        json=smtp_config(
            smtp_port=465,
            smtp_security="ssl",
        ),
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "Test email sent to alex@example.com."}
    assert calls[0][0] == delivery.SMTPConnection(
        host="smtp.example.test",
        port=465,
        security=SMTPTransport.SSL,
        username="smtp-user",
        password="smtp-password-secret",
        sender="alerts@example.com",
        recipient="alex@example.com",
    )
    assert calls[0][1] == "Cashcove SMTP test"
    assert "smtp-password-secret" not in response.text


def test_smtp_test_reports_connection_failures_without_details(
    admin_client: TestClient, monkeypatch: Any
) -> None:
    async def fail(*args: Any, **kwargs: Any) -> None:
        raise OSError("host and password must not appear")

    monkeypatch.setattr(delivery, "send_email", fail)
    response = admin_client.post("/api/alerts/smtp/test", json=smtp_config())

    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "message": (
            "Couldn't connect to the SMTP server. Check its host, port and security setting."
        ),
    }
    assert "password" not in response.text


def test_smtp_test_uses_saved_credentials_and_can_test_without_authentication(
    admin_client: TestClient,
    monkeypatch: Any,
) -> None:
    admin_client.patch("/api/alerts/settings", json=smtp_config())
    calls: list[delivery.SMTPConnection] = []

    async def send(connection: delivery.SMTPConnection, subject: str, body: str) -> None:
        calls.append(connection)

    monkeypatch.setattr(delivery, "send_email", send)
    saved = admin_client.post("/api/alerts/smtp/test", json={})
    assert saved.status_code == 200
    assert calls[-1].username == "smtp-user"
    assert calls[-1].password == "smtp-password-secret"
    blank_host = admin_client.post("/api/alerts/smtp/test", json={"smtp_host": None})
    assert blank_host.status_code == 200

    no_auth = admin_client.post(
        "/api/alerts/smtp/test",
        json={
            "clear_smtp_credentials": True,
            "smtp_host": "smtp.example.test",
            "smtp_port": 25,
            "smtp_security": "none",
            "smtp_from": "alerts@example.com",
            "smtp_to": "alex@example.com",
        },
    )
    assert no_auth.status_code == 200
    assert calls[-1].username is None
    assert calls[-1].password is None


def test_smtp_test_rejects_incomplete_or_unreadable_saved_credentials(
    admin_client: TestClient, session: Session
) -> None:
    incomplete = admin_client.post(
        "/api/alerts/smtp/test",
        json={
            "smtp_host": "smtp.example.test",
            "smtp_port": 587,
            "smtp_security": "starttls",
            "smtp_from": "alerts@example.com",
            "smtp_to": "alex@example.com",
            "smtp_username": "smtp-user",
        },
    )
    assert error(incomplete) == "smtp_credentials_incomplete"

    insecure = admin_client.post(
        "/api/alerts/smtp/test",
        json=smtp_config(smtp_security="none"),
    )
    assert error(insecure) == "smtp_auth_requires_tls"

    admin_client.patch("/api/alerts/settings", json=smtp_config())
    row = session.get_one(AlertSettings, 1)
    row.smtp_password = "unreadable"
    session.commit()
    unreadable = admin_client.post("/api/alerts/smtp/test", json={})
    assert error(unreadable) == "smtp_credentials_unreadable"

    still_enabled = admin_client.patch("/api/alerts/settings", json={"smtp_enabled": True})
    assert error(still_enabled) == "smtp_credentials_unreadable"


def test_smtp_test_reports_invalid_saved_port(admin_client: TestClient, monkeypatch: Any) -> None:
    row = AlertSettings(
        id=1,
        smtp_enabled=True,
        smtp_host="smtp.example.test",
        smtp_port=587,
        smtp_security=SMTPTransport.STARTTLS,
        smtp_from="alerts@example.com",
        smtp_to="alex@example.com",
    )
    monkeypatch.setattr(row, "smtp_port", "not-a-port")

    def get_row(db: Session) -> AlertSettings:
        return row

    monkeypatch.setattr(service, "_row", get_row)

    response = admin_client.post("/api/alerts/smtp/test", json={})

    assert error(response) == "smtp_settings_invalid"


def test_discord_test_sends_to_the_unsaved_webhook(
    admin_client: TestClient, monkeypatch: Any
) -> None:
    calls: list[tuple[str, str]] = []

    async def send(url: str, content: str) -> None:
        calls.append((url, content))

    monkeypatch.setattr(delivery, "send_discord", send)
    response = admin_client.post("/api/alerts/discord/test", json={"discord_webhook_url": WEBHOOK})

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "Test message sent to Discord."}
    assert calls == [(WEBHOOK, "Cashcove test alert: Discord notifications are working.")]
    assert WEBHOOK not in response.text


def test_discord_test_reports_delivery_failures(admin_client: TestClient, monkeypatch: Any) -> None:
    async def fail(*args: Any, **kwargs: Any) -> None:
        raise OSError("webhook token must not be shown")

    monkeypatch.setattr(delivery, "send_discord", fail)
    response = admin_client.post("/api/alerts/discord/test", json={"discord_webhook_url": WEBHOOK})

    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "message": "Couldn't reach Discord. Check the webhook URL and try again.",
    }
    assert "token" not in response.text


def test_tests_require_settings(admin_client: TestClient) -> None:
    assert error(admin_client.post("/api/alerts/smtp/test", json={})) == "smtp_settings_required"
    assert (
        error(
            admin_client.post(
                "/api/alerts/smtp/test",
                json={"smtp_host": "smtp.example.test"},
            )
        )
        == "smtp_settings_required"
    )
    assert (
        error(admin_client.post("/api/alerts/discord/test", json={})) == "discord_webhook_required"
    )
    assert (
        error(admin_client.post("/api/alerts/discord/test", json={"clear_discord_webhook": True}))
        == "discord_webhook_required"
    )


def test_discord_test_uses_the_saved_webhook(admin_client: TestClient, monkeypatch: Any) -> None:
    admin_client.patch(
        "/api/alerts/settings",
        json={"discord_enabled": True, "discord_webhook_url": WEBHOOK},
    )
    calls: list[tuple[str, str]] = []

    async def send(url: str, content: str) -> None:
        calls.append((url, content))

    monkeypatch.setattr(delivery, "send_discord", send)
    response = admin_client.post("/api/alerts/discord/test", json={})

    assert response.status_code == 200
    assert calls[0][0] == WEBHOOK
    assert WEBHOOK not in response.text


def test_signed_out_visitors_cannot_read_or_test_alert_settings(client: TestClient) -> None:
    assert error(client.get("/api/alerts/settings")) == "not_signed_in"
    assert error(client.post("/api/alerts/smtp/test", json={})) == "not_signed_in"


def test_unreadable_saved_secrets_are_not_reported_as_configured(
    admin_client: TestClient, session: Session
) -> None:
    session.add(
        AlertSettings(
            id=1,
            discord_enabled=True,
            discord_webhook_url="not-encrypted",
            smtp_enabled=True,
            smtp_host="smtp.example.test",
            smtp_from="alerts@example.com",
            smtp_to="alex@example.com",
            smtp_username="not-encrypted",
            smtp_password="not-encrypted",
        )
    )
    session.commit()

    response = admin_client.get("/api/alerts/settings")
    assert response.status_code == 200
    assert response.json()["discord_configured"] is False
    assert response.json()["discord_webhook_set"] is False
    assert response.json()["smtp_configured"] is False
    assert response.json()["smtp_username_set"] is False
    assert response.json()["smtp_password_set"] is False


def test_connection_test_error_mapping() -> None:
    from app.alerts.service import connection_test_problem
    from app.models import AlertChannel

    auth_error = aiosmtplib.SMTPAuthenticationError(535, "bad credentials")
    rejected = aiosmtplib.SMTPResponseException(550, "no recipient")
    recipients_refused = aiosmtplib.SMTPRecipientsRefused(
        [aiosmtplib.SMTPRecipientRefused(550, "no recipient", "alex@example.com")]
    )
    response = httpx.Response(403, request=httpx.Request("POST", "https://discord.com"))
    status_error = httpx.HTTPStatusError("bad", request=response.request, response=response)

    assert "rejected the username" in connection_test_problem(auth_error, AlertChannel.EMAIL)
    assert "rejected the alert recipient" in connection_test_problem(
        recipients_refused, AlertChannel.EMAIL
    )
    assert "rejected the test email" in connection_test_problem(rejected, AlertChannel.EMAIL)
    assert "HTTP 403" in connection_test_problem(status_error, AlertChannel.DISCORD)
    assert "reach Discord" in connection_test_problem(OSError(), AlertChannel.DISCORD)
    assert "connect to the SMTP" in connection_test_problem(OSError(), AlertChannel.EMAIL)
