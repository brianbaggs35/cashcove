"""Household members. Everyone can see who's in the household; only admins change it."""

import uuid
from datetime import timedelta
from typing import Annotated, Any, NoReturn

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import Select, delete, exists, func, select
from sqlalchemy.orm import Session

from app.auth import audit, sessions
from app.auth.activity import list_activity
from app.auth.audit import Event
from app.auth.deps import AdminAuth, ApiError, AppSettings, CurrentAuth, Db, VerifiedAdmin
from app.auth.service import issue_password_reset, one_time_link, turn_off_two_factor
from app.auth.tokens import hash_token, new_token
from app.models import Invitation, Passkey, PasswordReset, Role, User
from app.models.base import utcnow
from app.schemas.auth import (
    ActivityOut,
    InvitationCreate,
    InvitationLink,
    InvitationOut,
    MemberDetails,
    MemberOut,
    ResetLink,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["users"])

INVITATION_LIFETIME = timedelta(days=7)

EMAIL_TAKEN = "Someone in this household already uses that email."


def _member(db: Session, user: User, *, details: bool) -> MemberOut:
    member = MemberOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
    )
    if not details:
        return member
    passkey_count = db.scalar(
        select(func.count()).select_from(Passkey).where(Passkey.user_id == user.id)
    )
    return member.model_copy(
        update={
            "details": MemberDetails(
                totp_enabled=user.totp_enabled,
                passkey_count=passkey_count or 0,
                last_sign_in_at=user.last_sign_in_at,
            )
        }
    )


def _not_found() -> NoReturn:
    raise ApiError(
        status.HTTP_404_NOT_FOUND, "not_found", "That person isn't in this household anymore."
    )


def _target(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        _not_found()
    return user


def _active_admins() -> Select[uuid.UUID]:
    return select(User.id).where(User.role == Role.ADMIN, User.is_active.is_(True))


def _lock_admins(db: Session) -> None:
    """Serialises changes to admins, so two admins can't demote each other at once."""
    db.execute(_active_admins().with_for_update())


def _ensure_an_admin_remains(db: Session) -> None:
    db.flush()
    if not db.scalar(select(exists(_active_admins()))):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "last_admin",
            "Cashcove needs at least one active admin. Make someone else an admin first.",
        )


@router.get("", response_model=list[MemberOut])
def list_members(auth: CurrentAuth, db: Db) -> list[MemberOut]:
    users = db.scalars(select(User).order_by(User.created_at, User.name)).all()
    return [_member(db, user, details=auth.user.is_admin) for user in users]


@router.get("/activity", response_model=list[ActivityOut])
def household_activity(
    auth: AdminAuth, db: Db, limit: Annotated[int, Query(ge=1, le=200)] = 100
) -> list[ActivityOut]:
    """Sign-ins and account changes across the household, including failed attempts."""
    return list_activity(db, user_id=None, limit=limit)


@router.patch("/{user_id}", response_model=MemberOut)
def update_member(
    user_id: uuid.UUID, body: UserUpdate, auth: VerifiedAdmin, request: Request, db: Db
) -> MemberOut:
    """Changes someone's role, or turns their account off or back on.

    Admins can step down to viewer themselves, as long as another admin remains.
    """
    _lock_admins(db)
    target = _target(db, user_id)
    if target.id == auth.user.id and body.is_active is False:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "cannot_deactivate_self",
            "You can't turn off your own account. Ask another admin to do it.",
        )
    changes: dict[str, Any] = {}
    if body.role is not None and body.role != target.role:
        target.role = body.role
        changes["role"] = body.role.value
    if body.is_active is not None and body.is_active != target.is_active:
        target.is_active = body.is_active
        changes["is_active"] = body.is_active
        if not body.is_active:
            sessions.end_all(db, target)
            db.execute(delete(PasswordReset).where(PasswordReset.user_id == target.id))
    if changes:
        _ensure_an_admin_remains(db)
        audit.record(db, request, Event.USER_UPDATED, user=target, actor=auth.user, **changes)
    db.commit()
    return _member(db, target, details=True)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(user_id: uuid.UUID, auth: VerifiedAdmin, request: Request, db: Db) -> None:
    """Deletes someone's account along with their sessions and passkeys."""
    _lock_admins(db)
    target = _target(db, user_id)
    if target.id == auth.user.id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "cannot_remove_self",
            "You can't remove your own account. Ask another admin to do it.",
        )
    name, email = target.name, target.email
    db.delete(target)
    _ensure_an_admin_remains(db)
    audit.record(
        db, request, Event.USER_REMOVED, user=None, actor=auth.user, name=name, email=email
    )
    db.commit()


@router.post(
    "/{user_id}/password-reset", response_model=ResetLink, status_code=status.HTTP_201_CREATED
)
def create_password_reset(
    user_id: uuid.UUID, auth: VerifiedAdmin, request: Request, db: Db, settings: AppSettings
) -> ResetLink:
    """A one-time link, valid for a day, that lets someone choose a new password."""
    target = _target(db, user_id)
    if not target.is_active:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "user_inactive",
            "Turn this account back on before creating a reset link.",
        )
    token, reset = issue_password_reset(db, target, created_by=auth.user, now=utcnow())
    audit.record(db, request, Event.PASSWORD_RESET_CREATED, user=target, actor=auth.user)
    db.commit()
    return ResetLink(
        link=one_time_link(settings, "reset-password", token), expires_at=reset.expires_at
    )


@router.delete("/{user_id}/two-factor", status_code=status.HTTP_204_NO_CONTENT)
def reset_two_factor(user_id: uuid.UUID, auth: VerifiedAdmin, request: Request, db: Db) -> None:
    """For someone who lost their authenticator app and recovery codes."""
    target = _target(db, user_id)
    if target.totp_enabled:
        turn_off_two_factor(db, target)
        audit.record(db, request, Event.TWO_FACTOR_RESET, user=target, actor=auth.user)
    db.commit()


# ---- Invitations ----------------------------------------------------------------------


def _invitation_out(invitation: Invitation) -> InvitationOut:
    return InvitationOut(
        id=invitation.id,
        email=invitation.email,
        name=invitation.name,
        role=invitation.role,
        invited_by=invitation.invited_by.name if invitation.invited_by else None,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
    )


def _invitation(db: Session, invitation_id: uuid.UUID) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    if invitation is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That invitation was already used or removed."
        )
    return invitation


@router.get("/invitations", response_model=list[InvitationOut])
def list_invitations(auth: AdminAuth, db: Db) -> list[InvitationOut]:
    """Invitations nobody has accepted yet, including expired ones that can be renewed."""
    rows = db.scalars(select(Invitation).order_by(Invitation.created_at.desc())).all()
    return [_invitation_out(row) for row in rows]


@router.post("/invitations", response_model=InvitationLink, status_code=status.HTTP_201_CREATED)
def invite_member(
    body: InvitationCreate,
    auth: VerifiedAdmin,
    request: Request,
    db: Db,
    settings: AppSettings,
) -> InvitationLink:
    """A one-time link, valid for a week, that lets someone create their own account."""
    if db.scalar(select(exists().where(User.email == body.email))):
        raise ApiError(status.HTTP_409_CONFLICT, "email_taken", EMAIL_TAKEN)
    if db.scalar(select(exists().where(Invitation.email == body.email))):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "already_invited",
            "This email already has an invitation. Create a new link from it instead.",
        )
    now = utcnow()
    token = new_token()
    invitation = Invitation(
        token_hash=hash_token(token),
        email=body.email,
        name=body.name,
        role=body.role,
        invited_by=auth.user,
        created_at=now,
        expires_at=now + INVITATION_LIFETIME,
    )
    db.add(invitation)
    audit.record(
        db,
        request,
        Event.USER_INVITED,
        user=None,
        actor=auth.user,
        email=body.email,
        role=body.role.value,
    )
    db.commit()
    return InvitationLink(
        invitation=_invitation_out(invitation), link=one_time_link(settings, "invite", token)
    )


@router.post("/invitations/{invitation_id}/link", response_model=InvitationLink)
def renew_invitation(
    invitation_id: uuid.UUID,
    auth: VerifiedAdmin,
    request: Request,
    db: Db,
    settings: AppSettings,
) -> InvitationLink:
    """Replaces an invitation's link with a new one, valid for another week."""
    invitation = _invitation(db, invitation_id)
    now = utcnow()
    token = new_token()
    invitation.token_hash = hash_token(token)
    invitation.expires_at = now + INVITATION_LIFETIME
    audit.record(
        db,
        request,
        Event.USER_INVITED,
        user=None,
        actor=auth.user,
        email=invitation.email,
        role=invitation.role.value,
        renewed=True,
    )
    db.commit()
    return InvitationLink(
        invitation=_invitation_out(invitation), link=one_time_link(settings, "invite", token)
    )


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: uuid.UUID, auth: VerifiedAdmin, request: Request, db: Db
) -> None:
    invitation = _invitation(db, invitation_id)
    db.delete(invitation)
    audit.record(
        db,
        request,
        Event.INVITATION_REVOKED,
        user=None,
        actor=auth.user,
        email=invitation.email,
    )
    db.commit()
