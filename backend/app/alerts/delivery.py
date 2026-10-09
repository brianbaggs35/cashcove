"""The outbound HTTP and SMTP transports used by alert tests and notifications."""

from dataclasses import dataclass
from email.message import EmailMessage

import aiosmtplib
import httpx2 as httpx

from app.models import SMTPTransport

SMTP_TIMEOUT = 10.0
HTTP_TIMEOUT = httpx.Timeout(10.0, connect=3.0)
DISCORD_LIMIT = 1900


@dataclass(frozen=True)
class SMTPConnection:
    host: str
    port: int
    security: SMTPTransport
    username: str | None
    password: str | None
    sender: str
    recipient: str


async def send_email(connection: SMTPConnection, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = connection.sender
    message["To"] = connection.recipient
    message["Subject"] = " ".join(subject.split())[:120]
    message.set_content(body)
    refused, _ = await aiosmtplib.send(
        message,
        hostname=connection.host,
        port=connection.port,
        username=connection.username,
        password=connection.password,
        use_tls=connection.security == SMTPTransport.SSL,
        start_tls=connection.security == SMTPTransport.STARTTLS,
        timeout=SMTP_TIMEOUT,
    )
    if refused:
        raise aiosmtplib.SMTPRecipientsRefused(
            [
                aiosmtplib.SMTPRecipientRefused(response.code, response.message, recipient)
                for recipient, response in refused.items()
            ]
        )


async def send_discord(webhook_url: str, content: str) -> None:
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        follow_redirects=False,
    ) as client:
        response = await client.post(
            webhook_url,
            json={
                "content": content[:DISCORD_LIMIT],
                "allowed_mentions": {"parse": []},
            },
        )
        response.raise_for_status()
