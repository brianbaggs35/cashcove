"""The data every end-to-end test starts from.

Specs reset the database to this baseline in a before block, so each one knows exactly what
it's working with. Keep it small and realistic. When a feature adds tables, add its baseline
rows to ``seed`` and describe them in ``describe`` (and in frontend/e2e/support/harness.ts
and frontend/e2e/README.md), so specs can find them by name instead of by hard-coded values.
"""

import base64
import hashlib
import hmac
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

import cbor2
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import sessions, totp
from app.auth.audit import Event
from app.auth.passkeys import provider_name
from app.auth.passwords import get_passwords
from app.auth.service import one_time_link, plaid_box, totp_box
from app.auth.tokens import hash_token, new_token
from app.auth.useragent import describe as describe_device
from app.config import Settings
from app.finance.categories import SUGGESTED
from app.models import (
    Account,
    AccountSource,
    AccountType,
    AppSettings,
    AuditEvent,
    Base,
    Category,
    CategoryGroup,
    CategoryKind,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    ConnectionSync,
    HistoryStatus,
    Invitation,
    Passkey,
    RecoveryCode,
    Role,
    SyncTrigger,
    Transaction,
    TransactionSource,
    User,
    UserSession,
)
from app.models.app_settings import SINGLETON_ID
from app.plaid.accounts import SharedAccount
from app.plaid.client import PlaidError
from app.plaid.errors import diagnose
from app.schemas.preferences import GeneralPreferences, Preferences
from e2e.plaid import BANKS, FIDELITY_ACCESS, FIDELITY_ITEM, LOGO, TARTAN_ACCESS, TARTAN_ITEM

HOUSEHOLD_NAME = "The Rivera household"
# Every baseline account signs in with this password. It's made-up test data that only
# exists in the e2e image's database.
PASSWORD = "harbor-maple-signal-72"  # nosec B105

# Their IDs come from their names, so they're the same after every reset.
_ID_NAMESPACE = uuid.UUID("0c4f3a52-7d1e-4b8a-9f36-2e5d8c1b7a40")


def stable_id(kind: str, name: str) -> uuid.UUID:
    return uuid.uuid5(_ID_NAMESPACE, f"{kind}:{name}")


def _fixed_bytes(label: str) -> bytes:
    """32 made-up bytes that are the same after every reset, for IDs and test keys."""
    return hashlib.sha256(f"cashcove e2e baseline:{label}".encode()).digest()


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


@dataclass(frozen=True)
class Person:
    # Their key in ``Baseline.users``.
    key: str
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
    # When they last signed in, and changed their password if not since they joined.
    last_sign_in_hours_ago: int | None = None
    password_changed_days_ago: int | None = None

    @property
    def webauthn_id(self) -> bytes:
        """The handle their passkeys are saved under, the same after every reset."""
        return _fixed_bytes(f"webauthn id:{self.key}")


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
    key="admin",
    id=uuid.UUID("11111111-1111-4111-8111-111111111111"),
    email="alex@example.com",
    name="Alex Rivera",
    role=Role.ADMIN,
    joined_days_ago=120,
    # The saved sign-ins below start at every reset.
    last_sign_in_hours_ago=0,
    password_changed_days_ago=45,
)
TWO_STEP = Person(
    key="two_step",
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
    last_sign_in_hours_ago=72,
)
VIEWER = Person(
    key="viewer",
    id=uuid.UUID("33333333-3333-4333-8333-333333333333"),
    email="sam@example.com",
    name="Sam Rivera",
    role=Role.VIEWER,
    joined_days_ago=60,
    last_sign_in_hours_ago=0,
)
DEACTIVATED = Person(
    key="deactivated",
    id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
    email="casey@example.com",
    name="Casey Rivera",
    role=Role.VIEWER,
    joined_days_ago=30,
    active=False,
    last_sign_in_hours_ago=12 * 24,
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


# ---- Where people are signed in -----------------------------------------------------------

CHROME_ON_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36"
)
FIREFOX_ON_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0"
)
SAFARI_ON_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
)
SAFARI_ON_IPAD = (
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/18.6 Mobile/15E148 Safari/604.1"
)
FIREFOX_ON_MACOS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0"
)
CHROME_ON_ANDROID = (
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Mobile Safari/537.36"
)

SavedSignInName = Literal["admin", "viewer"]


def _secret_token(settings: Settings, label: str) -> str:
    """A token made from the app secret: the same after every reset, but only this server
    knows it, so it never appears in the repository."""
    digest = hmac.new(
        settings.read_secret_key(), f"cashcove e2e:{label}".encode(), hashlib.sha256
    ).digest()
    return _b64url(digest)


@dataclass(frozen=True)
class Device:
    """A browser someone is signed in on: a remembered session."""

    key: str
    person: Person
    user_agent: str
    ip_address: str
    signed_in_hours_ago: int
    last_seen_hours_ago: int
    # Set for the admin's and the viewer's saved sign-ins, whose cookies global setup saves
    # to frontend/e2e/.auth/<name>.json, so specs can start signed in with
    # test.use({ storageState }). Every reset puts them back with the same token.
    saved_as: SavedSignInName | None = None

    @property
    def id(self) -> uuid.UUID:
        return stable_id("session", self.key)

    @property
    def label(self) -> str:
        return describe_device(self.user_agent).label

    def token(self, settings: Settings) -> str:
        if self.saved_as is None:
            return new_token()
        return _secret_token(settings, f"saved sign-in:{self.saved_as}")

    def csrf_token(self, settings: Settings) -> str:
        # Kept too, so a page opened before a reset can still make changes after it.
        if self.saved_as is None:
            return new_token()
        return _secret_token(settings, f"saved sign-in csrf:{self.saved_as}")


# The saved sign-ins start at the reset, on the computer the tests run on.
ADMIN_COMPUTER = Device(
    "admin_computer",
    ADMIN,
    CHROME_ON_WINDOWS,
    "192.168.1.20",
    signed_in_hours_ago=0,
    last_seen_hours_ago=0,
    saved_as="admin",
)
VIEWER_COMPUTER = Device(
    "viewer_computer",
    VIEWER,
    CHROME_ON_WINDOWS,
    "192.168.1.52",
    signed_in_hours_ago=0,
    last_seen_hours_ago=0,
    saved_as="viewer",
)
DEVICES = (
    ADMIN_COMPUTER,
    Device(
        "admin_phone",
        ADMIN,
        SAFARI_ON_IPHONE,
        "192.168.1.31",
        signed_in_hours_ago=9 * 24,
        last_seen_hours_ago=2,
    ),
    Device(
        "admin_laptop",
        ADMIN,
        FIREFOX_ON_MACOS,
        "192.168.1.44",
        signed_in_hours_ago=26,
        last_seen_hours_ago=20,
    ),
    VIEWER_COMPUTER,
    Device(
        "viewer_phone",
        VIEWER,
        CHROME_ON_ANDROID,
        "192.168.1.53",
        signed_in_hours_ago=5 * 24,
        last_seen_hours_ago=20,
    ),
    Device(
        "two_step_tablet",
        TWO_STEP,
        SAFARI_ON_IPAD,
        "192.168.1.60",
        signed_in_hours_ago=3 * 24,
        last_seen_hours_ago=50,
    ),
)
SAVED_SIGN_INS: dict[SavedSignInName, Device] = {
    "admin": ADMIN_COMPUTER,
    "viewer": VIEWER_COMPUTER,
}

# The order of the P-256 curve, which a private key must be below.
_P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
ICLOUD_KEYCHAIN = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd"


@dataclass(frozen=True)
class SeedPasskey:
    """A passkey with a made-up key pair, so a spec can give its private key to Chromium's
    virtual authenticator and sign in with it."""

    key: str
    person: Person
    name: str
    aaguid: str
    added_days_ago: int
    last_used_hours_ago: int | None

    @property
    def id(self) -> uuid.UUID:
        return stable_id("passkey", self.key)

    @property
    def credential_id(self) -> bytes:
        return _fixed_bytes(f"passkey credential:{self.key}")

    @property
    def private_key(self) -> ec.EllipticCurvePrivateKey:
        number = int.from_bytes(_fixed_bytes(f"passkey key:{self.key}")) % (_P256_ORDER - 1)
        return ec.derive_private_key(number + 1, ec.SECP256R1())

    @property
    def public_key(self) -> bytes:
        """As a WebAuthn authenticator reports it: a COSE key."""
        point = self.private_key.public_key().public_numbers()
        return cbor2.dumps(
            {
                1: 2,  # EC2 key
                3: -7,  # ES256
                -1: 1,  # P-256
                -2: point.x.to_bytes(32),
                -3: point.y.to_bytes(32),
            }
        )


# Added from Alex's iPhone, then renamed.
PASSKEYS = (SeedPasskey("admin_phone", ADMIN, "Alex's iPhone", ICLOUD_KEYCHAIN, 29, 9 * 24),)


@dataclass(frozen=True)
class Activity:
    """A sign-in or security change in someone's activity log."""

    hours_ago: int
    event: Event
    # Whose account it was about, and who did it when it wasn't them (an admin).
    user: Person | None
    user_agent: str
    ip_address: str
    details: Mapping[str, Any]
    actor: Person | None = None


def _invited(hours_ago: int, email: str, role: Role) -> Activity:
    return Activity(
        hours_ago,
        Event.USER_INVITED,
        None,
        CHROME_ON_WINDOWS,
        "192.168.1.20",
        {"email": email, "role": role.value},
        actor=ADMIN,
    )


def _joined(hours_ago: int, person: Person, user_agent: str, ip_address: str) -> Activity:
    details = {"role": person.role.value, "invited_by": ADMIN.name}
    return Activity(hours_ago, Event.INVITATION_ACCEPTED, person, user_agent, ip_address, details)


# The household's history, oldest first, in step with the people and devices above.
ACTIVITY = (
    Activity(120 * 24, Event.SETUP_COMPLETED, ADMIN, CHROME_ON_WINDOWS, "192.168.1.20", {}),
    Activity(
        100 * 24,
        Event.PROFILE_UPDATED,
        ADMIN,
        CHROME_ON_WINDOWS,
        "192.168.1.20",
        {"changed": ["name"]},
    ),
    _invited(91 * 24, TWO_STEP.email, Role.ADMIN),
    _joined(90 * 24, TWO_STEP, SAFARI_ON_IPAD, "192.168.1.60"),
    Activity(89 * 24, Event.TWO_FACTOR_ENABLED, TWO_STEP, SAFARI_ON_IPAD, "192.168.1.60", {}),
    Activity(62 * 24, Event.RECOVERY_CODES_CREATED, TWO_STEP, SAFARI_ON_IPAD, "192.168.1.60", {}),
    _invited(61 * 24, VIEWER.email, Role.VIEWER),
    _joined(60 * 24, VIEWER, CHROME_ON_ANDROID, "192.168.1.53"),
    Activity(
        45 * 24,
        Event.PASSWORD_CHANGED,
        ADMIN,
        CHROME_ON_WINDOWS,
        "192.168.1.20",
        {"other_sessions_ended": 1},
    ),
    _invited(31 * 24, DEACTIVATED.email, Role.VIEWER),
    _joined(30 * 24, DEACTIVATED, FIREFOX_ON_WINDOWS, "192.168.1.70"),
    Activity(
        29 * 24,
        Event.PASSKEY_ADDED,
        ADMIN,
        SAFARI_ON_IPHONE,
        "192.168.1.31",
        {"name": "iCloud Keychain"},
    ),
    Activity(25 * 24, Event.SIGNED_OUT, ADMIN, CHROME_ON_WINDOWS, "192.168.1.20", {}),
    Activity(
        21 * 24,
        Event.SESSION_REVOKED,
        ADMIN,
        CHROME_ON_WINDOWS,
        "192.168.1.20",
        {"device": "Edge on Windows"},
    ),
    Activity(
        12 * 24,
        Event.SIGNED_IN,
        DEACTIVATED,
        FIREFOX_ON_WINDOWS,
        "192.168.1.70",
        {"method": "password", "remember": False},
    ),
    Activity(
        10 * 24,
        Event.USER_UPDATED,
        DEACTIVATED,
        CHROME_ON_WINDOWS,
        "192.168.1.20",
        {"is_active": False},
        actor=ADMIN,
    ),
    Activity(
        9 * 24,
        Event.SIGNED_IN,
        ADMIN,
        SAFARI_ON_IPHONE,
        "192.168.1.31",
        {"method": "passkey", "remember": True},
    ),
    Activity(
        5 * 24,
        Event.SIGNED_IN,
        VIEWER,
        CHROME_ON_ANDROID,
        "192.168.1.53",
        {"method": "password", "remember": True},
    ),
    # Someone tried an email nobody in the household uses.
    Activity(
        4 * 24,
        Event.SIGN_IN_FAILED,
        None,
        FIREFOX_ON_WINDOWS,
        "192.168.1.99",
        {"method": "password"},
    ),
    Activity(
        3 * 24,
        Event.SIGNED_IN,
        TWO_STEP,
        SAFARI_ON_IPAD,
        "192.168.1.60",
        {"method": "totp", "remember": True},
    ),
    _invited(INVITATION.sent_days_ago * 24, INVITATION.email, INVITATION.role),
    Activity(
        27, Event.SIGN_IN_FAILED, ADMIN, FIREFOX_ON_MACOS, "192.168.1.44", {"method": "password"}
    ),
    Activity(
        26,
        Event.SIGNED_IN,
        ADMIN,
        FIREFOX_ON_MACOS,
        "192.168.1.44",
        {"method": "password", "remember": True},
    ),
)


# ---- Money: accounts, categories and transactions ----------------------------------------

CURRENCY = "USD"


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
    # What the bank called it, for a linked account's transactions and imported ones.
    original_description: str | None = None
    # Imported from the bank's CSV export, from before the household used Cashcove.
    imported: bool = False

    @property
    def id(self) -> uuid.UUID:
        return stable_id("transaction", self.key)

    @property
    def source(self) -> TransactionSource:
        # Linked accounts' transactions come from the bank; the rest were entered by hand or
        # imported from a file.
        if self.account.source == AccountSource.PLAID:
            return TransactionSource.PLAID
        return TransactionSource.FILE if self.imported else TransactionSource.MANUAL

    @property
    def external_id(self) -> str | None:
        return None if self.source == TransactionSource.MANUAL else f"e2e-{self.key}"


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
LOAN = SeedAccount(
    key="loan",
    name="Car loan",
    type=AccountType.LOAN,
    institution="Harbor Credit Union",
    mask="5521",
    balance="-9120.00",
    updated_hours_ago=22 * 24,
    notes="5.9% APR, paid off in 2029",
)
RETIREMENT = SeedAccount(
    key="retirement",
    name="Retirement 401(k)",
    type=AccountType.INVESTMENT,
    institution="Fidelity",
    mask="8812",
    balance="48210.55",
    # Fidelity has wanted a new sign-in since the sync after this one.
    updated_hours_ago=50,
    source=AccountSource.PLAID,
    official_name="Fidelity 401(k) Plan",
    subtype="401k",
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
ACCOUNTS = (CHECKING, SAVINGS, CARD, LOAN, RETIREMENT, CLOSED)


@dataclass(frozen=True)
class SkippedAccount:
    """An account a bank shares that the household chose not to import."""

    plaid_id: str
    name: str
    type: AccountType
    subtype: str
    mask: str
    balance: str


@dataclass(frozen=True)
class SeedSync:
    hours_ago: int
    trigger: SyncTrigger
    added: int = 0
    updated: int = 0
    removed: int = 0
    # Plaid's error code, for one that failed.
    error: str | None = None


@dataclass(frozen=True)
class SeedConnection:
    # Its key in ``Baseline.connections``, which is also the stand-in Plaid's key for its bank
    # (e2e/plaid.py), e.g. for adding a transaction for the next sync to bring in.
    key: str
    item_id: str
    access_token: str
    connected_days_ago: int
    # The accounts it keeps up to date.
    accounts: tuple[SeedAccount, ...]
    skipped: tuple[SkippedAccount, ...]
    # Newest first.
    syncs: tuple[SeedSync, ...]

    @property
    def id(self) -> uuid.UUID:
        return stable_id("connection", self.key)

    @property
    def institution(self) -> str:
        return BANKS[self.key].name

    @property
    def error(self) -> str | None:
        """Why its latest sync failed, if it did."""
        return self.syncs[0].error

    @property
    def status(self) -> ConnectionStatus:
        return diagnose(_plaid_error(self.error)).status if self.error else ConnectionStatus.HEALTHY

    @property
    def last_synced_hours_ago(self) -> int | None:
        return next((sync.hours_ago for sync in self.syncs if sync.error is None), None)


def _plaid_error(code: str) -> PlaidError:
    return PlaidError("ITEM_ERROR", code, "The bank needs attention")


# Tartan Bank shares a checking account the household doesn't import, and syncs every six
# hours. Fidelity wants someone to sign in again, so it's waiting on a reconnect.
TARTAN = SeedConnection(
    key="tartan",
    item_id=TARTAN_ITEM,
    access_token=TARTAN_ACCESS,
    connected_days_ago=110,
    accounts=(CARD,),
    skipped=(
        SkippedAccount(
            "e2e-tartan-checking",
            "Tartan Checking",
            AccountType.CHECKING,
            "checking",
            "0042",
            "2310.55",
        ),
    ),
    syncs=(
        SeedSync(3, SyncTrigger.SCHEDULED, added=1, updated=1),
        SeedSync(9, SyncTrigger.SCHEDULED),
        SeedSync(15, SyncTrigger.SCHEDULED, added=2),
        SeedSync(21, SyncTrigger.MANUAL, removed=1),
    ),
)
FIDELITY = SeedConnection(
    key="fidelity",
    item_id=FIDELITY_ITEM,
    access_token=FIDELITY_ACCESS,
    connected_days_ago=100,
    accounts=(RETIREMENT,),
    skipped=(),
    syncs=(
        SeedSync(2, SyncTrigger.SCHEDULED, error="ITEM_LOGIN_REQUIRED"),
        SeedSync(26, SyncTrigger.SCHEDULED, error="ITEM_LOGIN_REQUIRED"),
        SeedSync(50, SyncTrigger.SCHEDULED, updated=1),
    ),
)
CONNECTIONS = (TARTAN, FIDELITY)

# The ones specs act on: the newest, each on its own day and the only transaction with its
# payee, so every sort order is stable and a spec can find one by its payee.
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

# Cashcove was set up this long ago; the accounts kept by hand have their older history from
# the bank's CSV exports.
SET_UP_DAYS_AGO = ADMIN.joined_days_ago


@dataclass(frozen=True)
class Series:
    """Transactions that repeat, like a paycheck, a bill or a shop visited often."""

    payee: str
    account: SeedAccount
    category: str | None
    # Used in turn, one per transaction.
    amounts: tuple[str, ...]
    # What the bank calls it, on its statements and in its CSV exports.
    bank_text: str
    days_ago: tuple[int, ...]


def every(days: int, *, first: int, count: int) -> tuple[int, ...]:
    return tuple(range(first, first + days * count, days))


# About a year of history behind the transactions above, so the list has several pages, every
# period has some, and totals add up over months. None of it uses their payees.
HISTORY_SERIES = (
    # Everyday checking
    Series(
        "Northwind Health",
        CHECKING,
        "Paycheck",
        ("1875.00",),
        "NORTHWIND HEALTH PAYROLL PPD",
        every(14, first=20, count=28),
    ),
    Series(
        "Savings transfer",
        CHECKING,
        "Transfers",
        ("-250.00",),
        "ONLINE TRANSFER TO SAV 9921",
        every(30, first=15, count=13),
    ),
    Series(
        "Auto loan payment",
        CHECKING,
        "Loan payments",
        ("-325.00",),
        "LOAN PMT 5521",
        every(30, first=22, count=13),
    ),
    Series(
        "Comcast Xfinity",
        CHECKING,
        "Phone & internet",
        ("-79.99",),
        "COMCAST XFINITY 800-266-2278",
        every(30, first=24, count=13),
    ),
    Series(
        "State Farm",
        CHECKING,
        "Insurance",
        ("-138.20",),
        "STATE FARM RO 27 SFPP",
        every(30, first=27, count=13),
    ),
    Series(
        "Trader Joe's",
        CHECKING,
        "Groceries",
        ("-62.18", "-91.40", "-47.95", "-118.07", "-73.66"),
        "TRADER JOE S #552",
        every(7, first=16, count=13),
    ),
    Series(
        "ATM withdrawal",
        CHECKING,
        "Cash & ATM",
        ("-100.00", "-60.00"),
        "ATM WITHDRAWAL 1102 MAIN ST",
        every(30, first=33, count=6),
    ),
    # Three the household never got round to categorizing.
    Series(
        "Zelle payment",
        CHECKING,
        None,
        ("-45.00", "-120.00", "-30.00"),
        "ZELLE PAYMENT SENT",
        (38, 95, 210),
    ),
    Series(
        "Monthly service fee",
        CHECKING,
        "Bank fees",
        ("-5.00",),
        "MONTHLY MAINTENANCE FEE",
        (62, 305),
    ),
    Series("IRS", CHECKING, "Other income", ("1284.00",), "IRS TREAS 310 TAX REF", (160,)),
    # Rainy day fund
    Series(
        "Savings transfer",
        SAVINGS,
        "Transfers",
        ("250.00",),
        "ONLINE TRANSFER FROM CHK 4410",
        every(30, first=15, count=13),
    ),
    Series(
        "Interest paid",
        SAVINGS,
        "Interest & dividends",
        ("9.87", "10.02", "10.15", "9.94"),
        "INTEREST PAYMENT",
        every(30, first=35, count=13),
    ),
    # Rewards Visa, from its bank
    Series(
        "Spotify",
        CARD,
        "Subscriptions",
        ("-11.99",),
        "SPOTIFY USA",
        every(30, first=16, count=13),
    ),
    Series(
        "Verizon Wireless",
        CARD,
        "Phone & internet",
        ("-85.00",),
        "VZWRLSS*APOCC VISB",
        every(30, first=18, count=13),
    ),
    Series(
        "Planet Fitness",
        CARD,
        "Fitness",
        ("-24.99",),
        "PLANET FIT CLUB FEES",
        every(30, first=29, count=13),
    ),
    Series(
        "Shell",
        CARD,
        "Gas & fuel",
        ("-41.26", "-55.80", "-38.94", "-60.12"),
        "SHELL OIL 57444",
        every(12, first=19, count=8),
    ),
    Series(
        "Chipotle",
        CARD,
        "Restaurants",
        ("-13.45", "-24.90", "-18.75"),
        "CHIPOTLE 2291",
        every(10, first=21, count=9),
    ),
    Series(
        "Amazon",
        CARD,
        "Shopping",
        ("-27.99", "-64.12", "-15.49", "-89.30"),
        "AMZN MKTP US*2K4",
        every(20, first=23, count=5),
    ),
    Series(
        "Costco",
        CARD,
        "Groceries",
        ("-187.44", "-243.10", "-162.87"),
        "COSTCO WHSE #1102",
        every(30, first=26, count=3),
    ),
    Series("CVS Pharmacy", CARD, "Pharmacy", ("-23.47",), "CVS/PHARMACY #04512", (52,)),
    Series("Home Depot", CARD, "Home maintenance", ("-156.38",), "THE HOME DEPOT #0617", (67,)),
    Series("Marriott", CARD, "Travel", ("-612.00",), "MARRIOTT BOSTON", (211,)),
    Series("Delta Air Lines", CARD, "Travel", ("-486.20",), "DELTA AIR 0062341", (214,)),
)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _history() -> tuple[SeedTransaction, ...]:
    history: list[SeedTransaction] = []
    for series in HISTORY_SERIES:
        linked = series.account.source == AccountSource.PLAID
        for index, days_ago in enumerate(series.days_ago):
            imported = not linked and days_ago > SET_UP_DAYS_AGO
            history.append(
                SeedTransaction(
                    key=f"{series.account.key}-{_slug(series.payee)}-{days_ago}",
                    account=series.account,
                    days_ago=days_ago,
                    amount=series.amounts[index % len(series.amounts)],
                    payee=series.payee,
                    category=series.category,
                    original_description=series.bank_text if linked or imported else None,
                    imported=imported,
                )
            )
    # Newest first, as the Transactions tab lists them.
    return tuple(sorted(history, key=lambda item: (item.days_ago, item.payee, item.account.key)))


HISTORY = _history()


# ---- What specs are told about the baseline --------------------------------------------


class BaselineDevice(BaseModel):
    id: uuid.UUID
    # What Settings > Security calls it, e.g. "Safari on iPhone".
    device: str
    ip_address: str
    signed_in_hours_ago: int
    last_seen_hours_ago: int
    # "admin" or "viewer" for the saved sign-ins that frontend/e2e/.auth holds.
    saved_sign_in: SavedSignInName | None


class BaselinePasskey(BaseModel):
    id: uuid.UUID
    name: str
    # The password manager that holds it, as Settings > Security shows it.
    provider: str | None
    added_days_ago: int
    last_used_hours_ago: int | None
    # What Chromium's virtual authenticator needs to hold it (addPasskey in the e2e support),
    # all base64url: the credential's ID, its account's handle and its PKCS #8 private key.
    rp_id: str
    credential_id: str
    user_handle: str
    private_key: str


class BaselineUser(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: Role
    password: str
    is_active: bool
    totp_secret: str | None
    recovery_codes: list[str]
    last_sign_in_hours_ago: int | None
    # The browsers they're signed in on, most recently used first.
    devices: list[BaselineDevice]
    passkeys: list[BaselinePasskey]


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


class BaselineActivity(BaseModel):
    id: uuid.UUID
    event: Event
    # Keys in ``users``: whose account it was about (none for an invitation, or for an email
    # nobody uses) and who did it.
    user: str | None
    actor: str | None
    hours_ago: int
    device: str
    ip_address: str
    details: dict[str, Any]


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


class BaselineConnection(BaseModel):
    id: uuid.UUID
    institution: str
    status: ConnectionStatus
    # Plaid's error code, while the bank needs attention.
    error_code: str | None
    # The keys in ``accounts`` of the accounts it keeps up to date.
    accounts: list[str]
    # What the bank calls the accounts it shares that aren't imported.
    skipped: list[str]
    last_synced_hours_ago: int | None


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
    # Every sign-in and security change on record, newest first.
    activity: list[BaselineActivity]
    # Accounts and transactions by their keys ("checking", "groceries"), and every suggested
    # category and group by name ("Groceries", "Food & drink").
    accounts: dict[str, BaselineAccount]
    # Banks connected through Plaid, by key ("tartan", "fidelity").
    connections: dict[str, BaselineConnection]
    category_groups: dict[str, BaselineCategoryGroup]
    categories: dict[str, BaselineCategory]
    transactions: dict[str, BaselineTransaction]
    # The rest of the year's transactions, older than all of those, newest first.
    history: list[BaselineTransaction]


def _device(device: Device) -> BaselineDevice:
    return BaselineDevice(
        id=device.id,
        device=device.label,
        ip_address=device.ip_address,
        signed_in_hours_ago=device.signed_in_hours_ago,
        last_seen_hours_ago=device.last_seen_hours_ago,
        saved_sign_in=device.saved_as,
    )


def _passkey(settings: Settings, passkey: SeedPasskey) -> BaselinePasskey:
    private_key = passkey.private_key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return BaselinePasskey(
        id=passkey.id,
        name=passkey.name,
        provider=provider_name(passkey.aaguid),
        added_days_ago=passkey.added_days_ago,
        last_used_hours_ago=passkey.last_used_hours_ago,
        rp_id=settings.server_name,
        credential_id=_b64url(passkey.credential_id),
        user_handle=_b64url(passkey.person.webauthn_id),
        private_key=_b64url(private_key),
    )


def _user(settings: Settings, person: Person) -> BaselineUser:
    devices = sorted(
        (device for device in DEVICES if device.person == person),
        key=lambda device: device.last_seen_hours_ago,
    )
    return BaselineUser(
        id=person.id,
        email=person.email,
        name=person.name,
        role=person.role,
        password=PASSWORD,
        is_active=person.active,
        totp_secret=person.totp_secret,
        recovery_codes=list(person.recovery_codes),
        last_sign_in_hours_ago=person.last_sign_in_hours_ago,
        devices=[_device(device) for device in devices],
        passkeys=[_passkey(settings, passkey) for passkey in PASSKEYS if passkey.person == person],
    )


def _activity(index: int, entry: Activity) -> BaselineActivity:
    actor = entry.actor or entry.user
    return BaselineActivity(
        id=stable_id("activity", str(index)),
        event=entry.event,
        user=entry.user.key if entry.user else None,
        actor=actor.key if actor else None,
        hours_ago=entry.hours_ago,
        device=describe_device(entry.user_agent).label,
        ip_address=entry.ip_address,
        details=dict(entry.details),
    )


def describe(settings: Settings) -> Baseline:
    activity = [_activity(index, entry) for index, entry in enumerate(ACTIVITY)]
    return Baseline(
        household_name=HOUSEHOLD_NAME,
        users=BaselineUsers(
            admin=_user(settings, ADMIN),
            two_step=_user(settings, TWO_STEP),
            viewer=_user(settings, VIEWER),
            deactivated=_user(settings, DEACTIVATED),
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
        activity=sorted(activity, key=lambda entry: entry.hours_ago),
        accounts={account.key: _account(account) for account in ACCOUNTS},
        connections={
            connection.key: BaselineConnection(
                id=connection.id,
                institution=connection.institution,
                status=connection.status,
                error_code=connection.error,
                accounts=[account.key for account in connection.accounts],
                skipped=[account.name for account in connection.skipped],
                last_synced_hours_ago=connection.last_synced_hours_ago,
            )
            for connection in CONNECTIONS
        },
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
        history=[_transaction(transaction) for transaction in HISTORY],
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
    _seed_people(db, settings, now)
    # Users first: the rows below refer to them.
    db.flush()
    _seed_sign_ins(db, settings, now)
    _seed_connections(db, settings, now)
    _seed_money(db, now)


def _hours_before(now: datetime, hours: int | None) -> datetime | None:
    return None if hours is None else now - timedelta(hours=hours)


def _seed_people(db: Session, settings: Settings, now: datetime) -> None:
    hashed = password_hash(settings)
    box = totp_box(settings)
    for person in PEOPLE:
        joined = now - timedelta(days=person.joined_days_ago)
        password_changed = (
            joined
            if person.password_changed_days_ago is None
            else now - timedelta(days=person.password_changed_days_ago)
        )
        db.add(
            User(
                id=person.id,
                email=person.email,
                name=person.name,
                role=person.role,
                password_hash=hashed,
                is_active=person.active,
                webauthn_id=person.webauthn_id,
                totp_secret=box.encrypt(person.totp_secret) if person.totp_secret else None,
                password_changed_at=password_changed,
                last_sign_in_at=_hours_before(now, person.last_sign_in_hours_ago),
                created_at=joined,
                updated_at=joined,
            )
        )


def _seed_sign_ins(db: Session, settings: Settings, now: datetime) -> None:
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
    for device in DEVICES:
        signed_in = now - timedelta(hours=device.signed_in_hours_ago)
        db.add(
            UserSession(
                id=device.id,
                user_id=device.person.id,
                token_hash=hash_token(device.token(settings)),
                csrf_token=device.csrf_token(settings),
                remember=True,
                created_at=signed_in,
                last_seen_at=now - timedelta(hours=device.last_seen_hours_ago),
                # Signing in counts as a recent check, so the saved sign-ins can make changes
                # that need one right after a reset.
                verified_at=signed_in,
                expires_at=signed_in + sessions.REMEMBERED.absolute,
                ip_address=device.ip_address,
                user_agent=device.user_agent,
            )
        )
    db.add_all(
        Passkey(
            id=passkey.id,
            user_id=passkey.person.id,
            credential_id=passkey.credential_id,
            public_key=passkey.public_key,
            sign_count=0,
            transports=["internal", "hybrid"],
            aaguid=passkey.aaguid,
            backed_up=True,
            name=passkey.name,
            created_at=now - timedelta(days=passkey.added_days_ago),
            last_used_at=_hours_before(now, passkey.last_used_hours_ago),
        )
        for passkey in PASSKEYS
    )
    for index, entry in enumerate(ACTIVITY):
        actor = entry.actor or entry.user
        db.add(
            AuditEvent(
                id=stable_id("activity", str(index)),
                created_at=now - timedelta(hours=entry.hours_ago),
                event=entry.event.value,
                user_id=entry.user.id if entry.user else None,
                actor_id=actor.id if actor else None,
                ip_address=entry.ip_address,
                user_agent=entry.user_agent,
                details=dict(entry.details),
            )
        )


def _money(amount: str | None) -> Decimal | None:
    return None if amount is None else Decimal(amount)


def _shared(connection: SeedConnection) -> list[dict[str, Any]]:
    """What the connection remembers of the accounts its bank shares."""
    shared = [
        SharedAccount(
            id=account.external_id or "",
            name=account.name,
            official_name=account.official_name,
            mask=account.mask,
            type=account.type,
            subtype=account.subtype,
            balance=Decimal(account.balance),
            available_balance=_money(account.available_balance),
            credit_limit=_money(account.credit_limit),
            currency=CURRENCY,
        )
        for account in connection.accounts
    ] + [
        SharedAccount(
            id=account.plaid_id,
            name=account.name,
            mask=account.mask,
            type=account.type,
            subtype=account.subtype,
            balance=Decimal(account.balance),
            currency=CURRENCY,
        )
        for account in connection.skipped
    ]
    return [account.model_dump(mode="json") for account in shared]


def _seed_connections(db: Session, settings: Settings, now: datetime) -> None:
    box = plaid_box(settings)
    for connection in CONNECTIONS:
        error = connection.error
        bank = BANKS[connection.key]
        db.add(
            Connection(
                id=connection.id,
                provider=ConnectionProvider.PLAID,
                external_id=connection.item_id,
                access_token=box.encrypt(connection.access_token),
                institution_id=bank.institution_id,
                institution_name=bank.name,
                institution_url=bank.url,
                institution_color=bank.color,
                institution_logo=LOGO,
                status=connection.status,
                error_code=error,
                error_message=diagnose(_plaid_error(error)).message if error else None,
                available_accounts=_shared(connection),
                skipped_accounts=[account.plaid_id for account in connection.skipped],
                history=HistoryStatus.COMPLETE,
                last_synced_at=_hours_before(now, connection.last_synced_hours_ago),
                last_attempt_at=now - timedelta(hours=connection.syncs[0].hours_ago),
                created_by_id=ADMIN.id,
                created_at=now - timedelta(days=connection.connected_days_ago),
                updated_at=now - timedelta(hours=connection.syncs[0].hours_ago),
            )
        )
        for index, sync in enumerate(connection.syncs):
            started = now - timedelta(hours=sync.hours_ago)
            db.add(
                ConnectionSync(
                    id=stable_id("sync", f"{connection.key}:{index}"),
                    connection_id=connection.id,
                    trigger=sync.trigger,
                    started_at=started,
                    finished_at=started + timedelta(seconds=4),
                    succeeded=sync.error is None,
                    added=sync.added,
                    updated=sync.updated,
                    removed=sync.removed,
                    error_code=sync.error,
                    error_message=(
                        diagnose(_plaid_error(sync.error)).message if sync.error else None
                    ),
                )
            )
    # Before the accounts, which refer to them.
    db.flush()


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
    connected = {
        account.key: connection.id for connection in CONNECTIONS for account in connection.accounts
    }
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
                connection_id=connected.get(account.key),
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
    for transaction in (*TRANSACTIONS, *HISTORY):
        # Entered on the day it happened, so transactions on the same day keep one order.
        entered = now - timedelta(days=transaction.days_ago)
        db.add(
            Transaction(
                id=transaction.id,
                account_id=transaction.account.id,
                date=entered.date(),
                amount=Decimal(transaction.amount),
                payee=transaction.payee,
                original_description=transaction.original_description,
                category_id=_category_id(transaction.category),
                notes=transaction.notes,
                pending=transaction.pending,
                source=transaction.source,
                external_id=transaction.external_id,
                created_at=entered,
                updated_at=entered,
            )
        )
