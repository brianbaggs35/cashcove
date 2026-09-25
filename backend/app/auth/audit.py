"""Records sign-ins and security-sensitive changes so people can review them later."""

from enum import StrEnum, auto
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEvent, User
from app.models.base import utcnow


class Event(StrEnum):
    """Stored by value: each member's name in lowercase."""

    SETUP_COMPLETED = auto()
    SIGNED_IN = auto()
    SIGN_IN_FAILED = auto()
    # A wrong password, code or passkey while confirming identity for a sensitive change.
    VERIFICATION_FAILED = auto()
    SIGNED_OUT = auto()
    SESSION_REVOKED = auto()
    PASSWORD_CHANGED = auto()
    PROFILE_UPDATED = auto()
    TWO_FACTOR_ENABLED = auto()
    TWO_FACTOR_DISABLED = auto()
    RECOVERY_CODES_CREATED = auto()
    RECOVERY_CODE_USED = auto()
    PASSKEY_ADDED = auto()
    PASSKEY_REMOVED = auto()
    USER_INVITED = auto()
    INVITATION_REVOKED = auto()
    INVITATION_ACCEPTED = auto()
    USER_UPDATED = auto()
    USER_REMOVED = auto()
    PASSWORD_RESET_CREATED = auto()
    PASSWORD_RESET = auto()
    TWO_FACTOR_RESET = auto()


def client_address(request: Request) -> str | None:
    # uvicorn rewrites the client from nginx's X-Forwarded-For (see docker/start-api.sh).
    return request.client.host if request.client else None


def client_agent(request: Request) -> str | None:
    agent = request.headers.get("user-agent")
    return agent[:255] if agent else None


def record(
    db: Session,
    request: Request | None,
    event: Event,
    *,
    user: User | None,
    actor: User | None = None,
    **details: Any,
) -> AuditEvent:
    by = actor or user
    entry = AuditEvent(
        created_at=utcnow(),
        event=event.value,
        user_id=user.id if user else None,
        actor_id=by.id if by else None,
        # None for maintenance commands run on the server.
        ip_address=client_address(request) if request else None,
        user_agent=client_agent(request) if request else None,
        details=details,
    )
    db.add(entry)
    return entry
