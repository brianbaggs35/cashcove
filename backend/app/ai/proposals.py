"""Changes the AI proposed, and what the admin who was chatting decides about them.

The AI never changes anything. What it asks for is checked and kept here, in Cashcove's words,
and runs only when the admin approves it, by id, after being checked again:

- **Only the one it was proposed to can decide.** Anyone else is told it doesn't exist.
- **A decision is made once.** The proposal is locked while it is decided, so approving it
  twice (a double click, a retry) runs it once and answers the same both times, and a proposal
  that was turned down can't be approved afterwards.
- **It all happens or none of it does.** The changes of a proposal run together in one
  transaction, in order, so a later one can rely on an earlier one (a category it adds); if one
  fails, nothing is changed and the proposal stays open.
- **It goes stale.** A day on, it can't be approved: the household will have moved on.
- **Every decision is on record**, with who made it, when, and what was said when it was turned
  down, in the proposal and in the audit log.
"""

import datetime as dt
import uuid
from typing import Any

from fastapi import Request, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.service import AIConfig
from app.ai.tools.base import Prepared, ToolError, explain
from app.ai.tools.registry import CHANGE_BY_NAME
from app.auth import audit
from app.auth.audit import Event
from app.auth.deps import ApiError
from app.models import AIProposal, ProposalStatus, User
from app.models.base import utcnow
from app.schemas.ai import ProposalOut, ProposalPage, ProposalQuery, ProposalState, ProposalStepOut

# How long a proposal can be approved for.
EXPIRES_AFTER = dt.timedelta(hours=24)
# The most changes in one proposal, and the longest title and message that are kept.
MAX_CHANGES = 8
TITLE_LENGTH = 160
MESSAGE_LENGTH = 4000


def create(
    db: Session,
    config: AIConfig,
    user: User,
    message: str,
    changes: list[tuple[str, Prepared]],
) -> AIProposal:
    """Keeps the changes an AI proposed, which are not made. Doesn't commit."""
    first = changes[0][1].title
    title = first if len(changes) == 1 else f"{first} and {len(changes) - 1} more"
    proposal = AIProposal(
        user_id=user.id,
        provider=config.provider,
        model=config.model,
        title=title[:TITLE_LENGTH],
        message=message[:MESSAGE_LENGTH],
        steps=[
            {
                "tool": tool,
                "title": prepared.title,
                "summary": prepared.summary,
                "details": prepared.details,
                "step": prepared.step,
            }
            for tool, prepared in changes
        ],
        status=ProposalStatus.PENDING,
        created_at=utcnow(),
        results=[],
    )
    db.add(proposal)
    db.flush()
    return proposal


def expires_at(proposal: AIProposal) -> dt.datetime:
    return proposal.created_at + EXPIRES_AFTER


_STATES: dict[ProposalStatus, ProposalState] = {
    ProposalStatus.PENDING: "pending",
    ProposalStatus.APPROVED: "approved",
    ProposalStatus.REJECTED: "rejected",
}


def state_of(proposal: AIProposal, now: dt.datetime) -> ProposalState:
    """Where it stands: a pending proposal nobody decided on in time is expired."""
    if proposal.status == ProposalStatus.PENDING and now >= expires_at(proposal):
        return "expired"
    return _STATES[proposal.status]


def to_out(proposal: AIProposal, now: dt.datetime | None = None) -> ProposalOut:
    return ProposalOut(
        id=proposal.id,
        state=state_of(proposal, now or utcnow()),
        title=proposal.title,
        message=proposal.message,
        steps=[
            ProposalStepOut(
                tool=entry["tool"],
                title=entry["title"],
                summary=entry["summary"],
                details=entry["details"],
            )
            for entry in proposal.steps
        ],
        created_at=proposal.created_at,
        expires_at=expires_at(proposal),
        decided_at=proposal.decided_at,
        note=proposal.note,
        results=proposal.results,
    )


def find(db: Session, user: User, proposal_id: uuid.UUID, *, lock: bool = False) -> AIProposal:
    """A proposal made in this admin's own conversations, or a 404."""
    proposal = db.get(AIProposal, proposal_id, with_for_update=lock)
    if proposal is None or proposal.user_id != user.id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That suggestion doesn't exist anymore."
        )
    return proposal


def listing(db: Session, user: User, query: ProposalQuery) -> ProposalPage:
    """This admin's proposals, newest first."""
    now = utcnow()
    where = [AIProposal.user_id == user.id]
    if query.state == "expired":
        where += [
            AIProposal.status == ProposalStatus.PENDING,
            AIProposal.created_at <= now - EXPIRES_AFTER,
        ]
    elif query.state == "pending":
        where += [
            AIProposal.status == ProposalStatus.PENDING,
            AIProposal.created_at > now - EXPIRES_AFTER,
        ]
    elif query.state is not None:
        where.append(AIProposal.status == ProposalStatus(query.state))
    rows = db.scalars(
        select(AIProposal)
        .where(*where)
        .order_by(AIProposal.created_at.desc(), AIProposal.id)
        .offset((query.page - 1) * query.page_size)
        .limit(query.page_size)
    ).all()
    total = db.scalar(select(func.count()).select_from(AIProposal).where(*where)) or 0
    return ProposalPage(
        items=[to_out(row, now) for row in rows],
        total=total,
        page=query.page,
        page_size=query.page_size,
    )


def _reason(error: Exception) -> str:
    if isinstance(error, ToolError):
        return str(error)
    if isinstance(error, ApiError):
        return explain(error)
    if isinstance(error, IntegrityError):
        return "Something changed while it was being saved."
    return "One of the changes can't be read any more."


def _run(db: Session, entry: dict[str, Any]) -> str:
    change = CHANGE_BY_NAME.get(entry["tool"])
    if change is None:
        raise ToolError(f"{entry['tool']} isn't something Cashcove does any more.")
    return change.apply(db, entry["step"])


def approve(db: Session, user: User, proposal_id: uuid.UUID, request: Request | None) -> AIProposal:
    """Makes the changes. Approving what was already approved changes nothing and answers the
    same; what was turned down, or is too old, can't be approved."""
    proposal = find(db, user, proposal_id, lock=True)
    if proposal.status == ProposalStatus.APPROVED:
        return proposal
    if proposal.status == ProposalStatus.REJECTED:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "proposal_rejected",
            "You turned this down, so it can't be approved.",
        )
    if state_of(proposal, utcnow()) == "expired":
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "proposal_expired",
            "This suggestion is too old to apply. Ask for it again.",
        )
    try:
        results = [_run(db, entry) for entry in proposal.steps]
        proposal.results = results
        proposal.status = ProposalStatus.APPROVED
        proposal.decided_at = utcnow()
        proposal.decided_by_id = user.id
        audit.record(
            db,
            request,
            Event.AI_CHANGES_APPROVED,
            user=user,
            proposal=str(proposal.id),
            changes=len(proposal.steps),
        )
        db.commit()
    except (ToolError, ApiError, ValidationError, IntegrityError) as error:
        db.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT, "proposal_failed", f"Nothing was changed. {_reason(error)}"
        ) from error
    return proposal


def reject(
    db: Session, user: User, proposal_id: uuid.UUID, note: str | None, request: Request | None
) -> AIProposal:
    """Turns the changes down, and records why if the admin said. Turning down what was already
    turned down changes nothing; what was approved can't be turned down."""
    proposal = find(db, user, proposal_id, lock=True)
    if proposal.status == ProposalStatus.REJECTED:
        return proposal
    if proposal.status == ProposalStatus.APPROVED:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "proposal_approved",
            "You approved this, so it can't be turned down.",
        )
    proposal.status = ProposalStatus.REJECTED
    proposal.decided_at = utcnow()
    proposal.decided_by_id = user.id
    proposal.note = note
    audit.record(
        db,
        request,
        Event.AI_CHANGES_REJECTED,
        user=user,
        proposal=str(proposal.id),
        changes=len(proposal.steps),
        said_why=note is not None,
    )
    db.commit()
    return proposal
