"""Automations that sort transactions into categories and subscriptions as they come in."""

import uuid
from decimal import Decimal
from typing import NamedTuple

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.finance.automations import (
    Looks,
    apply_to_existing,
    check_choices,
    distinct_payees,
    match_count,
    new_automation,
    overlaps,
    payee_keys,
)
from app.finance.budget import automation_counts, set_automation_counts
from app.models import (
    Automation,
    AutomationDirection,
    AutomationMatch,
    AutomationScope,
)
from app.schemas.automations import (
    MONEY_IN_LINK,
    NO_ACTION,
    AutomationCreate,
    AutomationOut,
    AutomationPreview,
    AutomationPreviewRequest,
    AutomationSaved,
    AutomationUpdate,
    OverlappingAutomation,
    amounts_in_order,
)
from app.schemas.budget import AutomationCount

router = APIRouter(prefix="/automations", tags=["automations"])


def _automation(db: Session, automation_id: uuid.UUID, *, lock: bool = False) -> Automation:
    automation = db.get(Automation, automation_id, with_for_update=lock)
    if automation is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That automation doesn't exist anymore."
        )
    return automation


def _count(db: Session, automation: Automation) -> int:
    return match_count(db, Looks.of(automation))


def _counts(db: Session, automation: Automation) -> list[AutomationCount]:
    return automation_counts(db, [automation.id]).get(automation.id, [])


def _out(
    db: Session,
    automation: Automation,
    counts: dict[uuid.UUID | None, list[AutomationCount]] | None = None,
) -> AutomationOut:
    budgets = counts.get(automation.id, []) if counts is not None else _counts(db, automation)
    return AutomationOut.model_validate(automation).model_copy(
        update={"matching_count": _count(db, automation), "counts": budgets}
    )


def _saved(db: Session, automation: Automation, applied: int) -> AutomationSaved:
    return AutomationSaved.model_validate(automation).model_copy(
        update={
            "matching_count": _count(db, automation),
            "counts": _counts(db, automation),
            "applied": applied,
        }
    )


@router.get("")
def list_automations(auth: CurrentAuth, db: Db) -> list[AutomationOut]:
    automations = list(
        db.scalars(
            select(Automation).order_by(
                Automation.active.desc(), Automation.created_at.desc(), Automation.id
            )
        )
    )
    counts = automation_counts(db, [automation.id for automation in automations])
    return [_out(db, automation, counts) for automation in automations]


@router.post("/preview")
def preview_automation(
    body: AutomationPreviewRequest, auth: AdminAuth, db: Db
) -> AutomationPreview:
    """What an automation like this would sort, and which other automations already give some of
    the same transactions the same kind of thing. Nothing is saved."""
    looks = Looks(
        distinct_payees(body.payees),
        body.match,
        body.account_id,
        body.min_amount,
        body.max_amount,
        body.direction,
    )
    return AutomationPreview(
        matching=match_count(db, looks),
        overlaps=[
            OverlappingAutomation(
                automation_id=overlap.automation.id,
                automation_name=overlap.automation.name,
                count=overlap.count,
            )
            for overlap in overlaps(
                db,
                looks,
                category=body.category,
                subscription=body.subscription,
                except_id=body.automation_id,
            )
        ],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_automation(body: AutomationCreate, auth: AdminAuth, db: Db) -> AutomationSaved:
    """Adds an automation. One that covers the past sorts the transactions already there."""
    automation = new_automation(db, body)
    set_automation_counts(db, automation, body.counts)
    applied = apply_to_existing(db, automation) if body.apply_to == AutomationScope.ALL else 0
    db.commit()
    return _saved(db, automation, applied)


@router.get("/{automation_id}")
def read_automation(automation_id: uuid.UUID, auth: CurrentAuth, db: Db) -> AutomationOut:
    return _out(db, _automation(db, automation_id))


def _limit(
    fields: set[str], name: str, given: Decimal | None, current: Decimal | None
) -> Decimal | None:
    """An amount limit as changed: left as it is when not mentioned, taken away by null."""
    return given if name in fields else current


class _Settings(NamedTuple):
    """What an automation looks for and does, as a change would leave it."""

    payees: list[str]
    match: AutomationMatch
    direction: AutomationDirection
    account_id: uuid.UUID | None
    min_amount: Decimal | None
    max_amount: Decimal | None
    category_id: uuid.UUID | None
    subscription_id: uuid.UUID | None
    apply_to: AutomationScope
    active: bool


def _settings(automation: Automation, body: AutomationUpdate) -> _Settings:
    """The automation's settings, with the ones the change mentions replaced."""
    fields = body.model_fields_set
    return _Settings(
        payees=automation.payees if body.payees is None else distinct_payees(body.payees),
        match=body.match or automation.match,
        direction=body.direction or automation.direction,
        account_id=body.account_id if "account_id" in fields else automation.account_id,
        min_amount=_limit(fields, "min_amount", body.min_amount, automation.min_amount),
        max_amount=_limit(fields, "max_amount", body.max_amount, automation.max_amount),
        category_id=body.category_id if "category_id" in fields else automation.category_id,
        subscription_id=(
            body.subscription_id if "subscription_id" in fields else automation.subscription_id
        ),
        apply_to=body.apply_to or automation.apply_to,
        active=automation.active if body.active is None else body.active,
    )


def _sorts_everything_again(automation: Automation, new: _Settings) -> bool:
    """Everything it sorts changes when what it does or where it looks does, when it starts
    covering the past or comes back from a pause. Otherwise only new texts need sorting."""
    return (
        (new.active and not automation.active)
        or (new.apply_to == AutomationScope.ALL and automation.apply_to != new.apply_to)
        or new.match != automation.match
        or new.direction != automation.direction
        or new.account_id != automation.account_id
        or (new.min_amount, new.max_amount) != (automation.min_amount, automation.max_amount)
        or new.category_id != automation.category_id
        or new.subscription_id != automation.subscription_id
    )


@router.patch("/{automation_id}")
def update_automation(
    automation_id: uuid.UUID, body: AutomationUpdate, auth: AdminAuth, db: Db
) -> AutomationSaved:
    """Changes an automation. Where that would sort more of the transactions already there,
    an automation that covers the past sorts them."""
    automation = _automation(db, automation_id, lock=True)
    new = _settings(automation, body)
    counts = _counts(db, automation) if body.counts is None else body.counts
    if new.category_id is None and new.subscription_id is None and not counts:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "no_action", NO_ACTION)
    if new.subscription_id is not None and new.direction == AutomationDirection.IN:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "money_in_link", MONEY_IN_LINK)
    if not amounts_in_order(new.min_amount, new.max_amount):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "amount_range",
            "The smallest amount can't be more than the largest.",
        )
    check_choices(db, new.account_id, new.category_id, new.subscription_id)

    everything = _sorts_everything_again(automation, new)
    before = payee_keys(automation.payees)
    added = [key for key in payee_keys(new.payees) if key not in before]
    automation.name = body.name or automation.name
    automation.payees = new.payees
    automation.match = new.match
    automation.direction = new.direction
    automation.account_id = new.account_id
    automation.min_amount = new.min_amount
    automation.max_amount = new.max_amount
    automation.category_id = new.category_id
    automation.subscription_id = new.subscription_id
    automation.apply_to = new.apply_to
    automation.active = new.active
    db.flush()
    if body.counts is not None:
        set_automation_counts(db, automation, body.counts)
    applied = 0
    if new.active and new.apply_to == AutomationScope.ALL and (everything or added):
        applied = apply_to_existing(db, automation, None if everything else added)
    db.commit()
    return _saved(db, automation, applied)


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_automation(automation_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Removes an automation. The transactions it sorted keep their categories and links."""
    db.delete(_automation(db, automation_id, lock=True))
    db.commit()
