"""Banks connected through Plaid. Everyone can see them; only admins connect, sync or remove
them, and choose which of their accounts to import."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, status

from app.auth.deps import AdminAuth, ApiError, AppSettings, CurrentAuth, Db
from app.auth.service import load_preferences, plaid_box
from app.models import SyncTrigger
from app.models.base import utcnow
from app.plaid.accounts import linked_accounts
from app.plaid.connections import (
    choose_accounts,
    connect,
    connection_out,
    create_link_token,
    disconnect,
    get_connection,
    list_connections,
    list_syncs,
)
from app.plaid.deps import OptionalPlaid, Plaid
from app.plaid.sync import sync_connection
from app.schemas.connections import (
    AccountsChoice,
    ConnectionCreate,
    ConnectionOut,
    LinkTokenCreate,
    LinkTokenOut,
    LinkUpdate,
    SyncOut,
    SyncRequest,
)

router = APIRouter(prefix="/connections", tags=["connections"])


def _out(db: Db, connection_id: uuid.UUID) -> ConnectionOut:
    connection = get_connection(db, connection_id)
    return connection_out(db, connection, load_preferences(db), utcnow())


@router.get("")
def read_connections(auth: CurrentAuth, db: Db) -> list[ConnectionOut]:
    preferences = load_preferences(db)
    now = utcnow()
    return [connection_out(db, connection, preferences, now) for connection in list_connections(db)]


@router.post("/link-token")
def new_link_token(body: LinkTokenCreate, auth: AdminAuth, db: Db, plaid: Plaid) -> LinkTokenOut:
    """A token that opens Plaid Link to connect a bank."""
    token = create_link_token(plaid, auth.user, load_preferences(db), body.history_days)
    return LinkTokenOut(link_token=token.link_token, expiration=token.expiration)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_connection(
    body: ConnectionCreate,
    request: Request,
    auth: AdminAuth,
    db: Db,
    settings: AppSettings,
    plaid: Plaid,
) -> ConnectionOut:
    """Keeps the bank someone just connected in Plaid Link. Its accounts are listed for
    choosing which to import; nothing is imported yet."""
    connection = connect(
        db,
        plaid,
        plaid_box(settings),
        request,
        auth.user,
        body.public_token,
        load_preferences(db).general.currency,
    )
    return _out(db, connection.id)


@router.get("/{connection_id}")
def read_connection(connection_id: uuid.UUID, auth: CurrentAuth, db: Db) -> ConnectionOut:
    return _out(db, connection_id)


@router.put("/{connection_id}/accounts")
def update_accounts(
    connection_id: uuid.UUID,
    body: AccountsChoice,
    auth: AdminAuth,
    db: Db,
    settings: AppSettings,
    plaid: Plaid,
) -> ConnectionOut:
    """Chooses which accounts to import, then syncs, so newly imported ones fill in."""
    connection = get_connection(db, connection_id, lock=True)
    first_time = not linked_accounts(db, connection) and not connection.skipped_accounts
    choose_accounts(db, connection, body, utcnow())
    preferences = load_preferences(db)
    sync_connection(
        db,
        plaid,
        plaid_box(settings),
        connection.id,
        SyncTrigger.LINKED if first_time else SyncTrigger.MANUAL,
        default_currency=preferences.general.currency,
        settings=settings,
    )
    return _out(db, connection_id)


@router.post("/{connection_id}/link-token")
def update_link_token(
    connection_id: uuid.UUID,
    body: LinkUpdate,
    auth: AdminAuth,
    db: Db,
    settings: AppSettings,
    plaid: Plaid,
) -> LinkTokenOut:
    """A token that opens Plaid Link for a connected bank: to sign in to it again, or to change
    which accounts it shares."""
    connection = get_connection(db, connection_id)
    token = create_link_token(
        plaid,
        auth.user,
        load_preferences(db),
        None,
        connection,
        box=plaid_box(settings),
        choose_accounts=body.mode == "accounts",
    )
    return LinkTokenOut(link_token=token.link_token, expiration=token.expiration)


@router.post("/{connection_id}/sync")
def sync_now(
    connection_id: uuid.UUID,
    body: SyncRequest,
    auth: AdminAuth,
    db: Db,
    settings: AppSettings,
    plaid: Plaid,
) -> ConnectionOut:
    """Syncs now, rather than waiting for the schedule. A sync that fails says why on the
    connection."""
    connection = get_connection(db, connection_id)
    trigger = SyncTrigger.RECONNECTED if body.reason == "reconnected" else SyncTrigger.MANUAL
    started = sync_connection(
        db,
        plaid,
        plaid_box(settings),
        connection.id,
        trigger,
        default_currency=load_preferences(db).general.currency,
        settings=settings,
    )
    if not started:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "already_syncing",
            f"{connection.institution_name} is already syncing. It'll be up to date shortly.",
        )
    return _out(db, connection_id)


@router.get("/{connection_id}/syncs")
def read_syncs(connection_id: uuid.UUID, auth: CurrentAuth, db: Db) -> list[SyncOut]:
    """The connection's recent syncs, newest first."""
    return list_syncs(db, get_connection(db, connection_id))


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_connection(
    connection_id: uuid.UUID,
    request: Request,
    auth: AdminAuth,
    db: Db,
    settings: AppSettings,
    plaid: OptionalPlaid,
    keep_accounts: Annotated[bool, Query()] = True,
) -> None:
    """Disconnects the bank. Its accounts stay, with their history, unless they're deleted."""
    disconnect(
        db,
        plaid,
        plaid_box(settings),
        request,
        auth.user,
        get_connection(db, connection_id, lock=True),
        keep_accounts=keep_accounts,
    )
