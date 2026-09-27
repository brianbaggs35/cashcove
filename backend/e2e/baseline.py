"""The data every end-to-end test starts from.

Specs reset the database to this baseline in a before block, so each one knows exactly what
it's working with. Keep it small and realistic. When a feature adds tables, add its baseline
rows to ``seed`` and describe them in ``describe`` (and in frontend/e2e/support/harness.ts
and frontend/e2e/README.md), so specs can find them by name instead of by hard-coded values.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import totp
from app.auth.passwords import get_passwords
from app.auth.service import one_time_link, totp_box
from app.auth.tokens import hash_token
from app.config import Settings
from app.finance.categories import SUGGESTED
from app.models import (
    Account,
    AccountSource,
    AccountType,
    AppSettings,
    Base,
    Category,
    CategoryGroup,
    CategoryKind,
    Invitation,
    RecoveryCode,
    Role,
    Transaction,
    TransactionSource,
    User,
)
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


# ---- Money: accounts, categories and transactions ----------------------------------------

CURRENCY = "USD"

# Their IDs come from their names, so they're the same after every reset.
_ID_NAMESPACE = uuid.UUID("0c4f3a52-7d1e-4b8a-9f36-2e5d8c1b7a40")


def stable_id(kind: str, name: str) -> uuid.UUID:
    return uuid.uuid5(_ID_NAMESPACE, f"{kind}:{name}")


@dataclass(frozen=True)
class SeedAccount:
    key: str
    name: str
    type: AccountType
    institution: str
    mask: str
    # Signed as the API sends it: negative when money is owed.
    balance: str
    # How long ago its balance last changed.
    updated_hours_ago: int
    source: AccountSource = AccountSource.MANUAL
    # What a linked account's bank reports.
    available_balance: str | None = None
    credit_limit: str | None = None
    official_name: str | None = None
    subtype: str | None = None
    notes: str | None = None
    closed_days_ago: int | None = None

    @property
    def id(self) -> uuid.UUID:
        return stable_id("account", self.key)

    @property
    def external_id(self) -> str | None:
        """Plaid's ID for a linked account."""
        return f"e2e-{self.key}" if self.source == AccountSource.PLAID else None


@dataclass(frozen=True)
class SeedTransaction:
    key: str
    account: SeedAccount
    days_ago: int
    # Positive when money came in, negative when it went out.
    amount: str
    payee: str
    # One of the suggested categories, by name.
    category: str | None
    notes: str | None = None
    pending: bool = False
    # What the bank called it, for a linked account's transactions.
    original_description: str | None = None

    @property
    def id(self) -> uuid.UUID:
        return stable_id("transaction", self.key)

    @property
    def source(self) -> TransactionSource:
        # Linked accounts' transactions come from the bank; the rest were entered by hand.
        if self.account.source == AccountSource.PLAID:
            return TransactionSource.PLAID
        return TransactionSource.MANUAL

    @property
    def external_id(self) -> str | None:
        return f"e2e-{self.key}" if self.source == TransactionSource.PLAID else None


CHECKING = SeedAccount(
    key="checking",
    name="Everyday checking",
    type=AccountType.CHECKING,
    institution="Harbor Credit Union",
    mask="4410",
    balance="2450.18",
    updated_hours_ago=26,
)
SAVINGS = SeedAccount(
    key="savings",
    name="Rainy day fund",
    type=AccountType.SAVINGS,
    institution="Harbor Credit Union",
    mask="9921",
    balance="12500.00",
    updated_hours_ago=5 * 24,
    notes="Three months of expenses",
)
CARD = SeedAccount(
    key="card",
    name="Rewards Visa",
    type=AccountType.CREDIT_CARD,
    institution="Tartan Bank",
    mask="3333",
    balance="-612.40",
    updated_hours_ago=3,
    source=AccountSource.PLAID,
    available_balance="4387.60",
    credit_limit="5000.00",
    official_name="Tartan Rewards Visa Signature",
    subtype="credit card",
)
CLOSED = SeedAccount(
    key="closed",
    name="Old store card",
    type=AccountType.CREDIT_CARD,
    institution="Maple Department Store",
    mask="7788",
    balance="0.00",
    updated_hours_ago=20 * 24,
    closed_days_ago=20,
)
ACCOUNTS = (CHECKING, SAVINGS, CARD, CLOSED)

# Newest first, each on its own day, so every sort order is stable.
TRANSACTIONS = (
    SeedTransaction(
        "coffee",
        CARD,
        0,
        "-4.50",
        "Blue Bottle Coffee",
        "Coffee",
        pending=True,
        original_description="BLUE BOTTLE COFFEE #12",
    ),
    SeedTransaction("venmo", CHECKING, 1, "-40.00", "Venmo", None),
    SeedTransaction(
        "groceries", CHECKING, 3, "-84.12", "Whole Foods", "Groceries", notes="Weekly shop"
    ),
    SeedTransaction(
        "refund",
        CARD,
        4,
        "18.20",
        "Target",
        "Shopping",
        original_description="TARGET T-1234 REFUND",
    ),
    SeedTransaction("interest", SAVINGS, 5, "10.42", "Harbor Credit Union", "Interest & dividends"),
    SeedTransaction(
        "netflix",
        CARD,
        6,
        "-15.49",
        "Netflix",
        "Subscriptions",
        original_description="NETFLIX.COM",
    ),
    SeedTransaction("card_payment", CHECKING, 7, "-300.00", "Tartan Bank", "Credit card payments"),
    SeedTransaction("power", CHECKING, 9, "-96.40", "City Power & Light", "Utilities"),
    SeedTransaction("rent", CHECKING, 11, "-1850.00", "Parkside Apartments", "Rent & mortgage"),
    SeedTransaction("paycheck", CHECKING, 13, "2400.00", "Acme Corp", "Paycheck"),
    SeedTransaction("store", CLOSED, 45, "-35.00", "Maple Department Store", "Clothing"),
)


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


class BaselineAccount(BaseModel):
    id: uuid.UUID
    name: str
    type: AccountType
    source: AccountSource
    institution: str
    mask: str
    currency: str
    # Amounts are strings, as the API sends them ("-612.40").
    balance: str
    available_balance: str | None
    credit_limit: str | None
    notes: str | None
    closed: bool


class BaselineCategoryGroup(BaseModel):
    id: uuid.UUID
    name: str
    kind: CategoryKind


class BaselineCategory(BaseModel):
    id: uuid.UUID
    name: str
    emoji: str
    # Its group's name, the key in ``category_groups``.
    group: str
    group_id: uuid.UUID


class BaselineTransaction(BaseModel):
    id: uuid.UUID
    # Its account's key in ``accounts``.
    account: str
    account_id: uuid.UUID
    # Its date is this many days before the reset, in UTC.
    days_ago: int
    amount: str
    payee: str
    # Its category's name, the key in ``categories``.
    category: str | None
    category_id: uuid.UUID | None
    notes: str | None
    pending: bool
    source: TransactionSource
    original_description: str | None


class Baseline(BaseModel):
    household_name: str
    users: BaselineUsers
    invitations: BaselineInvitations
    # Accounts and transactions by their keys ("checking", "groceries"), and every suggested
    # category and group by name ("Groceries", "Food & drink").
    accounts: dict[str, BaselineAccount]
    category_groups: dict[str, BaselineCategoryGroup]
    categories: dict[str, BaselineCategory]
    transactions: dict[str, BaselineTransaction]


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
        accounts={account.key: _account(account) for account in ACCOUNTS},
        category_groups={
            group.name: BaselineCategoryGroup(
                id=stable_id("group", group.name), name=group.name, kind=group.kind
            )
            for group in SUGGESTED
        },
        categories={
            name: BaselineCategory(
                id=stable_id("category", name),
                name=name,
                emoji=emoji,
                group=group.name,
                group_id=stable_id("group", group.name),
            )
            for group in SUGGESTED
            for emoji, name in group.categories
        },
        transactions={transaction.key: _transaction(transaction) for transaction in TRANSACTIONS},
    )


def _account(account: SeedAccount) -> BaselineAccount:
    return BaselineAccount(
        id=account.id,
        name=account.name,
        type=account.type,
        source=account.source,
        institution=account.institution,
        mask=account.mask,
        currency=CURRENCY,
        balance=account.balance,
        available_balance=account.available_balance,
        credit_limit=account.credit_limit,
        notes=account.notes,
        closed=account.closed_days_ago is not None,
    )


def _category_id(name: str | None) -> uuid.UUID | None:
    return None if name is None else stable_id("category", name)


def _transaction(transaction: SeedTransaction) -> BaselineTransaction:
    return BaselineTransaction(
        id=transaction.id,
        account=transaction.account.key,
        account_id=transaction.account.id,
        days_ago=transaction.days_ago,
        amount=transaction.amount,
        payee=transaction.payee,
        category=transaction.category,
        category_id=_category_id(transaction.category),
        notes=transaction.notes,
        pending=transaction.pending,
        source=transaction.source,
        original_description=transaction.original_description,
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
    # Forget the rows the session already loaded, so seeding can add them again by the same IDs.
    db.expunge_all()


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
    _seed_money(db, now)


def _money(amount: str | None) -> Decimal | None:
    return None if amount is None else Decimal(amount)


def _seed_money(db: Session, now: datetime) -> None:
    # The categories a new household starts with, as setup adds them.
    for suggested in SUGGESTED:
        group = CategoryGroup(
            id=stable_id("group", suggested.name), name=suggested.name, kind=suggested.kind
        )
        db.add(group)
        db.add_all(
            Category(id=stable_id("category", name), group=group, name=name, emoji=emoji)
            for emoji, name in suggested.categories
        )
    for account in ACCOUNTS:
        db.add(
            Account(
                id=account.id,
                name=account.name,
                type=account.type,
                institution=account.institution,
                mask=account.mask,
                currency=CURRENCY,
                balance=Decimal(account.balance),
                available_balance=_money(account.available_balance),
                credit_limit=_money(account.credit_limit),
                balance_updated_at=now - timedelta(hours=account.updated_hours_ago),
                notes=account.notes,
                source=account.source,
                external_id=account.external_id,
                official_name=account.official_name,
                subtype=account.subtype,
                closed_at=(
                    None
                    if account.closed_days_ago is None
                    else now - timedelta(days=account.closed_days_ago)
                ),
            )
        )
    # Accounts and categories first: transactions refer to them.
    db.flush()
    db.add_all(
        Transaction(
            id=transaction.id,
            account_id=transaction.account.id,
            date=(now - timedelta(days=transaction.days_ago)).date(),
            amount=Decimal(transaction.amount),
            payee=transaction.payee,
            original_description=transaction.original_description,
            category_id=_category_id(transaction.category),
            notes=transaction.notes,
            pending=transaction.pending,
            source=transaction.source,
            external_id=transaction.external_id,
        )
        for transaction in TRANSACTIONS
    )
