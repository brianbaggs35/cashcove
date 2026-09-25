"""The data every end-to-end test starts from.

Specs reset the database to this baseline in a before block, so each one knows exactly what
it's working with. Keep it small and realistic. When a feature adds tables, add its baseline
rows to ``seed`` and describe them in ``describe`` (and in frontend/e2e/support/harness.ts
and frontend/e2e/README.md), so specs can find them by name instead of by hard-coded values.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import totp
from app.auth.passwords import get_passwords
from app.auth.service import one_time_link, totp_box
from app.auth.tokens import hash_token
from app.config import Settings
from app.models import AppSettings, Base, Invitation, RecoveryCode, Role, User
from app.models.app_settings import SINGLETON_ID
from app.schemas.preferences import GeneralPreferences, Preferences

HOUSEHOLD_NAME = "The Rivera household"
# Every baseline account signs in with this password. It's made-up test data that only
# exists in the e2e image's database.
PASSWORD = "harbor-maple-signal-72"  # nosec B105


@dataclass(frozen=True)
class Person:
    id: uuid.UUID
    email: str
    name: str
    role: Role
    # How long ago the account was created, so lists have a stable, realistic order.
    joined_days_ago: int
    active: bool = True
    # Authenticator-app key and recovery codes, for someone with two-step verification on.
    totp_secret: str | None = None
    recovery_codes: tuple[str, ...] = ()


@dataclass(frozen=True)
class PendingInvitation:
    id: uuid.UUID
    email: str
    name: str
    role: Role
    token: str
    invited_by: Person
    sent_days_ago: int


ADMIN = Person(
    id=uuid.UUID("11111111-1111-4111-8111-111111111111"),
    email="alex@example.com",
    name="Alex Rivera",
    role=Role.ADMIN,
    joined_days_ago=120,
)
TWO_STEP = Person(
    id=uuid.UUID("22222222-2222-4222-8222-222222222222"),
    email="jordan@example.com",
    name="Jordan Rivera",
    role=Role.ADMIN,
    joined_days_ago=90,
    totp_secret="TY7HKSTL4IWXAXM5ZRJERBI5GNZAQOHC",  # nosec B106
    recovery_codes=(
        "vrya-bpaz-3vea-5adk",
        "69pk-rtvx-ccmc-nx8u",
        "2m84-fvak-2raq-gsth",
        "wus5-qv9t-bp6e-gfug",
        "gwvs-eja4-pc3z-58y8",
        "eu3d-jcnq-qs9t-vfpf",
        "5rh4-szqn-ua7u-5auk",
        "42a6-25db-w7dm-a28z",
        "awtr-4sxp-acw6-44y8",
        "vap6-v8tn-uphx-wjqc",
    ),
)
VIEWER = Person(
    id=uuid.UUID("33333333-3333-4333-8333-333333333333"),
    email="sam@example.com",
    name="Sam Rivera",
    role=Role.VIEWER,
    joined_days_ago=60,
)
DEACTIVATED = Person(
    id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
    email="casey@example.com",
    name="Casey Rivera",
    role=Role.VIEWER,
    joined_days_ago=30,
    active=False,
)
PEOPLE = (ADMIN, TWO_STEP, VIEWER, DEACTIVATED)

INVITATION = PendingInvitation(
    id=uuid.UUID("55555555-5555-4555-8555-555555555555"),
    email="riley@example.com",
    name="Riley Chen",
    role=Role.VIEWER,
    token="S8C-RXdIw0AUSrQbso5YmfPAF4v6AA0WRTlBpPgWCKc",  # nosec B106
    invited_by=ADMIN,
    sent_days_ago=2,
)
INVITATION_LIFETIME = timedelta(days=7)


# ---- What specs are told about the baseline --------------------------------------------


class BaselineUser(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: Role
    password: str
    is_active: bool
    totp_secret: str | None
    recovery_codes: list[str]


class BaselineUsers(BaseModel):
    admin: BaselineUser
    two_step: BaselineUser
    viewer: BaselineUser
    deactivated: BaselineUser


class BaselineInvitation(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: Role
    token: str
    # The one-time link the admin would share, which opens the invitation page.
    link: str


class BaselineInvitations(BaseModel):
    pending: BaselineInvitation


class Baseline(BaseModel):
    household_name: str
    users: BaselineUsers
    invitations: BaselineInvitations


def _user(person: Person) -> BaselineUser:
    return BaselineUser(
        id=person.id,
        email=person.email,
        name=person.name,
        role=person.role,
        password=PASSWORD,
        is_active=person.active,
        totp_secret=person.totp_secret,
        recovery_codes=list(person.recovery_codes),
    )


def describe(settings: Settings) -> Baseline:
    return Baseline(
        household_name=HOUSEHOLD_NAME,
        users=BaselineUsers(
            admin=_user(ADMIN),
            two_step=_user(TWO_STEP),
            viewer=_user(VIEWER),
            deactivated=_user(DEACTIVATED),
        ),
        invitations=BaselineInvitations(
            pending=BaselineInvitation(
                id=INVITATION.id,
                email=INVITATION.email,
                name=INVITATION.name,
                role=INVITATION.role,
                token=INVITATION.token,
                link=one_time_link(settings, "invite", INVITATION.token),
            )
        ),
    )


# ---- Writing it to the database --------------------------------------------------------

# Hashing with the production Argon2 cost takes a moment, so each API process hashes the
# baseline password once per cost setting and reuses it for every reset.
_password_hashes: dict[tuple[int, int, int], str] = {}


def password_hash(settings: Settings) -> str:
    cost = (
        settings.password_time_cost,
        settings.password_memory_kib,
        settings.password_parallelism,
    )
    if cost not in _password_hashes:
        _password_hashes[cost] = get_passwords(settings).hash(PASSWORD)
    return _password_hashes[cost]


def clear(db: Session) -> None:
    """Deletes every row, dependents first, leaving the schema and its migrations alone."""
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())


def seed(db: Session, settings: Settings, now: datetime) -> None:
    """Writes the baseline into an empty database. The caller commits."""
    preferences = Preferences(general=GeneralPreferences(household_name=HOUSEHOLD_NAME))
    db.add(AppSettings(id=SINGLETON_ID, data=preferences.model_dump(mode="json")))
    hashed = password_hash(settings)
    box = totp_box(settings)
    for person in PEOPLE:
        joined = now - timedelta(days=person.joined_days_ago)
        db.add(
            User(
                id=person.id,
                email=person.email,
                name=person.name,
                role=person.role,
                password_hash=hashed,
                is_active=person.active,
                totp_secret=box.encrypt(person.totp_secret) if person.totp_secret else None,
                password_changed_at=joined,
                created_at=joined,
                updated_at=joined,
            )
        )
    # Users first: the rows below refer to them.
    db.flush()
    for person in PEOPLE:
        db.add_all(
            RecoveryCode(user_id=person.id, code_hash=totp.hash_recovery_code(code))
            for code in person.recovery_codes
        )
    sent = now - timedelta(days=INVITATION.sent_days_ago)
    db.add(
        Invitation(
            id=INVITATION.id,
            token_hash=hash_token(INVITATION.token),
            email=INVITATION.email,
            name=INVITATION.name,
            role=INVITATION.role,
            invited_by_id=INVITATION.invited_by.id,
            created_at=sent,
            expires_at=sent + INVITATION_LIFETIME,
        )
    )
