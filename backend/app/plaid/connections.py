"""Connecting banks through Plaid Link, choosing which of their accounts to import, and
removing them again."""

import base64
import binascii
import logging
import re
import uuid
from datetime import datetime

from fastapi import Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import audit
from app.auth.audit import Event
from app.auth.crypto import DecryptionError, SecretBox
from app.auth.deps import ApiError
from app.models import (
    Account,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    ConnectionSync,
    HistoryStatus,
    User,
)
from app.plaid.accounts import (
    SharedAccount,
    import_account,
    linked_accounts,
    share,
    shared_accounts,
    unlink,
)
from app.plaid.client import Institution, LinkToken, PlaidClient, PlaidError
from app.plaid.errors import GONE, plaid_failed
from app.plaid.schedule import next_sync
from app.plaid.sync import LEASE
from app.schemas.connections import (
    AccountsChoice,
    AccountState,
    ConnectionOut,
    SharedAccountOut,
    SyncOut,
)
from app.schemas.preferences import Preferences

log = logging.getLogger(__name__)

# The languages Plaid Link speaks.
LINK_LANGUAGES = frozenset(
    {"da", "de", "en", "es", "et", "fr", "hi", "it", "lt", "lv", "nl", "no", "pl", "pt", "ro"}
    | {"sv", "vi"}
)
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_PNG = b"\x89PNG\r\n\x1a\n"
# Bank logos are small; anything bigger isn't one.
_MAX_LOGO = 200_000


def link_language(locale: str) -> str:
    language = locale.split("-")[0]
    return language if language in LINK_LANGUAGES else "en"


def get_connection(db: Session, connection_id: uuid.UUID, *, lock: bool = False) -> Connection:
    connection = db.get(Connection, connection_id, with_for_update=lock)
    if connection is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "That bank isn't connected anymore.")
    return connection


def connection_out(
    db: Session, connection: Connection, preferences: Preferences, now: datetime
) -> ConnectionOut:
    linked = {account.external_id: account.id for account in linked_accounts(db, connection)}
    skipped = set(connection.skipped_accounts)

    def state(shared: SharedAccount) -> AccountState:
        if shared.id in linked:
            return "imported"
        return "skipped" if shared.id in skipped else "new"

    last = db.scalar(
        select(ConnectionSync)
        .where(ConnectionSync.connection_id == connection.id)
        .order_by(ConnectionSync.started_at.desc(), ConnectionSync.id)
        .limit(1)
    )
    upcoming = next_sync(connection, preferences.sync, has_accounts=bool(linked), now=now)
    started = connection.sync_started_at
    return ConnectionOut(
        id=connection.id,
        provider=connection.provider,
        institution_name=connection.institution_name,
        institution_url=connection.institution_url,
        institution_color=connection.institution_color,
        institution_logo=connection.institution_logo,
        status=connection.status,
        error_code=connection.error_code,
        error_message=connection.error_message,
        consent_expires_at=connection.consent_expires_at,
        history=connection.history,
        syncing=started is not None and now - started < LEASE,
        last_synced_at=connection.last_synced_at,
        last_attempt_at=connection.last_attempt_at,
        next_sync_at=upcoming[0] if upcoming else None,
        created_at=connection.created_at,
        accounts=[
            SharedAccountOut(
                id=shared.id,
                name=shared.name,
                official_name=shared.official_name,
                mask=shared.mask,
                type=shared.type,
                subtype=shared.subtype,
                balance=shared.balance,
                currency=shared.currency,
                state=state(shared),
                account_id=linked.get(shared.id),
            )
            for shared in shared_accounts(connection)
        ],
        last_sync=SyncOut.model_validate(last) if last else None,
    )


def create_link_token(
    plaid: PlaidClient,
    user: User,
    preferences: Preferences,
    history_days: int | None,
    connection: Connection | None = None,
    *,
    box: SecretBox | None = None,
    choose_accounts: bool = False,
) -> LinkToken:
    """A token to open Plaid Link with: to connect a new bank, or with a connection, in update
    mode to sign in to it again or change which accounts it shares."""
    access_token = None
    if connection is not None and box is not None:
        try:
            access_token = box.decrypt(connection.access_token)
        except DecryptionError:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "connection_lost",
                "Cashcove's secret key changed since this bank was connected, so it can't be "
                "reconnected. Remove it and connect the bank again.",
            ) from None
    try:
        return plaid.create_link_token(
            user_id=str(user.id),
            language=link_language(preferences.general.locale),
            days_requested=history_days or preferences.sync.history_days,
            access_token=access_token,
            account_selection=choose_accounts,
        )
    except PlaidError as error:
        raise plaid_failed(error) from error


def _institution(plaid: PlaidClient, institution_id: str | None) -> Institution | None:
    if not institution_id:
        return None
    try:
        return plaid.get_institution(institution_id)
    except PlaidError as error:
        # Only its logo and colors are missing without it.
        log.warning("Couldn't look up institution %s: %s", institution_id, error.code)
        return None


def valid_logo(logo: str | None) -> str | None:
    """The bank's logo, if it's really a small PNG."""
    if not logo or len(logo) > _MAX_LOGO:
        return None
    try:
        image = base64.b64decode(logo, validate=True)
    except binascii.Error:
        return None
    return logo if image.startswith(_PNG) else None


def _duplicate(
    db: Session, institution_id: str | None, accounts: list[SharedAccount]
) -> Connection | None:
    """A connection to the same accounts at the same bank, which Plaid would bill for twice."""
    if not institution_id:
        return None
    new = {(account.name.casefold(), account.mask) for account in accounts}
    for connection in db.scalars(
        select(Connection).where(Connection.institution_id == institution_id)
    ):
        existing = {
            (account.name.casefold(), account.mask) for account in shared_accounts(connection)
        }
        if new & existing:
            return connection
    return None


def _forget(plaid: PlaidClient, access_token: str) -> None:
    """Removes a bank Cashcove won't keep, so Plaid doesn't bill for it."""
    try:
        plaid.remove_item(access_token)
    except PlaidError as error:
        log.warning("Couldn't remove an unused Plaid item: %s", error.code)


def connect(
    db: Session,
    plaid: PlaidClient,
    box: SecretBox,
    request: Request,
    user: User,
    public_token: str,
    default_currency: str,
) -> Connection:
    """Turns what Plaid Link handed back into a connection. Nothing is imported until someone
    chooses which of its accounts to import."""
    try:
        exchange = plaid.exchange_public_token(public_token)
    except PlaidError as error:
        raise plaid_failed(error) from error
    try:
        shared = plaid.get_accounts(exchange.access_token)
        accounts = [share(account, default_currency) for account in shared.accounts]
        duplicate = _duplicate(db, shared.item.institution_id, accounts)
        if duplicate is not None:
            raise ApiError(
                status.HTTP_409_CONFLICT,
                "already_connected",
                f"{duplicate.institution_name} is already connected. Use Reconnect or Choose "
                "accounts on it instead.",
            )
        institution = _institution(plaid, shared.item.institution_id)
    except BaseException as error:
        _forget(plaid, exchange.access_token)
        if isinstance(error, PlaidError):
            raise plaid_failed(error) from error
        raise
    name = (institution.name if institution else None) or shared.item.institution_name
    color = institution.primary_color if institution else None
    url = institution.url if institution else None
    connection = Connection(
        provider=ConnectionProvider.PLAID,
        external_id=exchange.item_id,
        access_token=box.encrypt(exchange.access_token),
        institution_id=shared.item.institution_id,
        institution_name=(name or "Your bank")[:120],
        institution_url=url if url and url.startswith("https://") and len(url) <= 255 else None,
        institution_color=color if color and _COLOR.match(color) else None,
        institution_logo=valid_logo(institution.logo if institution else None),
        status=ConnectionStatus.HEALTHY,
        history=HistoryStatus.PENDING,
        available_accounts=[account.model_dump(mode="json") for account in accounts],
        skipped_accounts=[],
        consent_expires_at=shared.item.consent_expiration_time,
        created_by_id=user.id,
    )
    db.add(connection)
    audit.record(db, request, Event.BANK_CONNECTED, user=user, bank=connection.institution_name)
    db.commit()
    log.info("Connected %s", connection.institution_name)
    return connection


def choose_accounts(
    db: Session, connection: Connection, choice: AccountsChoice, now: datetime
) -> None:
    """Imports the chosen accounts and skips the rest. Imported accounts that are left out
    stay for the household to keep up to date, or are deleted, as chosen."""
    shared = {account.id: account for account in shared_accounts(connection)}
    chosen = {account.id: account for account in choice.accounts}
    if chosen.keys() - shared.keys():
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_account",
            f"{connection.institution_name} doesn't share one of those accounts anymore. "
            "Reload and choose again.",
        )
    linked = {account.external_id: account for account in linked_accounts(db, connection)}
    for account_id, account in linked.items():
        wanted = chosen.get(account_id or "")
        if wanted is not None:
            account.name = wanted.name or account.name
        # One the bank no longer shares is left for the next sync to take care of.
        elif account_id in shared:
            if choice.removed == "delete":
                db.delete(account)
            else:
                unlink(account)
    for account_id, wanted in chosen.items():
        if account_id not in linked:
            new = shared[account_id]
            db.add(import_account(connection, new, wanted.name or new.name, now))
    connection.skipped_accounts = sorted(shared.keys() - chosen.keys())
    db.commit()


def skip_deleted(db: Session, account: Account) -> None:
    """Remembers that the household deleted an imported account, so its connection lists it as
    skipped rather than as new."""
    if account.connection_id is None or account.external_id is None:
        return
    connection = db.get_one(Connection, account.connection_id, with_for_update=True)
    connection.skipped_accounts = sorted({*connection.skipped_accounts, account.external_id})


def disconnect(
    db: Session,
    plaid: PlaidClient | None,
    box: SecretBox,
    request: Request,
    user: User,
    connection: Connection,
    *,
    keep_accounts: bool,
) -> None:
    """Removes the connection at Plaid, which stops its billing, and then from Cashcove. Its
    accounts stay, with their history, for the household to keep up to date, or are deleted."""
    if plaid is not None:
        try:
            plaid.remove_item(box.decrypt(connection.access_token))
        except DecryptionError:
            log.warning("Can't remove %s at Plaid: its token is lost", connection.institution_name)
        except PlaidError as error:
            if error.code not in GONE:
                raise plaid_failed(error) from error
    accounts = linked_accounts(db, connection)
    for account in accounts:
        if keep_accounts:
            unlink(account)
        else:
            db.delete(account)
    audit.record(
        db,
        request,
        Event.BANK_DISCONNECTED,
        user=user,
        bank=connection.institution_name,
        accounts=len(accounts),
        kept_accounts=keep_accounts,
    )
    db.delete(connection)
    db.commit()
    log.info("Disconnected %s", connection.institution_name)


def list_syncs(db: Session, connection: Connection) -> list[SyncOut]:
    return [
        SyncOut.model_validate(sync)
        for sync in db.scalars(
            select(ConnectionSync)
            .where(ConnectionSync.connection_id == connection.id)
            .order_by(ConnectionSync.started_at.desc(), ConnectionSync.id)
        )
    ]


def list_connections(db: Session) -> list[Connection]:
    return list(
        db.scalars(
            select(Connection).order_by(func.lower(Connection.institution_name), Connection.id)
        )
    )
