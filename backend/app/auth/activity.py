"""The security activity people can review: sign-ins and changes to accounts."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.auth.useragent import describe
from app.models import AuditEvent, User
from app.schemas.auth import ActivityOut


def list_activity(db: Session, *, user_id: uuid.UUID | None, limit: int) -> list[ActivityOut]:
    """The newest events first; only those about one person when ``user_id`` is given."""
    subject = aliased(User)
    actor = aliased(User)
    query = (
        select(AuditEvent, subject.name, actor.name)
        .outerjoin(subject, AuditEvent.user_id == subject.id)
        .outerjoin(actor, AuditEvent.actor_id == actor.id)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id)
        .limit(limit)
    )
    if user_id is not None:
        query = query.where(AuditEvent.user_id == user_id)
    return [
        ActivityOut(
            id=event.id,
            event=event.event,
            created_at=event.created_at,
            user_name=user_name,
            actor_name=actor_name,
            ip_address=event.ip_address,
            device=describe(event.user_agent).label if event.user_agent else None,
            details=event.details,
        )
        for event, user_name, actor_name in db.execute(query).all()
    ]
