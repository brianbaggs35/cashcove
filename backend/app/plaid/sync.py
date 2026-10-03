"""Bringing a bank connection's balances and transactions up to date from Plaid.

Plaid's /transactions/sync hands out what changed since a cursor: transactions added,
modified or removed. Each imported account is its own stream with its own cursor, so an
account imported later starts with its whole history. Nothing is written until every page
has arrived, and then all of it is written at once, so a failed sync changes nothing but the
connection's status.
"""

import datetime as dt
import itertools
import logging
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import delete, exists, or_, select, update
from sqlalchemy.orm import Session

from app.auth.crypto import DecryptionError, SecretBox
from app.finance.subscriptions import apply_subscription_rule
from app.models import (
    Account,
    Connection,
    ConnectionStatus,
    ConnectionSync,
    HistoryStatus,
    SyncTrigger,
    Transaction,
    TransactionSource,
)
from app.models.base import utcnow
from app.plaid.accounts import cents, linked_accounts, refresh, share, unlink
from app.plaid.categories import CategoryChooser
from app.plaid.client import AccountsResponse, PlaidClient, PlaidError, PlaidTransaction
from app.plaid.errors import diagnose, unavailable

log = logging.getLogger(__name__)

# A sync that hasn't finished in this long has died, so another one may start.
LEASE = dt.timedelta(minutes=10)
# Finished syncs kept for each connection's history on the Connect tab.
KEPT_SYNCS = 20
# How many times to read an account's pages from the start when Plaid says they changed
# while they were being read.
PAGE_ATTEMPTS = 3
MUTATED = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
# Looked up this many at a time, well inside every database's limit on query parameters.
LOOKUP_BATCH = 500

_HISTORY = {
    "NOT_READY": HistoryStatus.PENDING,
    "INITIAL_UPDATE_COMPLETE": HistoryStatus.RECENT,
    "HISTORICAL_UPDATE_COMPLETE": HistoryStatus.COMPLETE,
}
_HISTORY_ORDER = list(HistoryStatus)


@dataclass
class AccountChanges:
    """Everything that changed in one account since its cursor."""

    added: list[PlaidTransaction] = field(default_factory=list[PlaidTransaction])
    modified: list[PlaidTransaction] = field(default_factory=list[PlaidTransaction])
    removed: list[str] = field(default_factory=list[str])
    cursor: str = ""
    history: str = "TRANSACTIONS_UPDATE_STATUS_UNKNOWN"


@dataclass
class Counts:
    added: int = 0
    updated: int = 0
    removed: int = 0


def _changed(changes: AccountChanges) -> bool:
    return bool(changes.added or changes.modified or changes.removed)


def claim(db: Session, connection_id: uuid.UUID, now: dt.datetime) -> bool:
    """Marks the connection as syncing, unless another sync of it is already running."""
    claimed = db.scalar(
        update(Connection)
        .where(
            Connection.id == connection_id,
            or_(Connection.sync_started_at.is_(None), Connection.sync_started_at < now - LEASE),
        )
        .values(sync_started_at=now)
        .returning(Connection.id)
    )
    db.commit()
    return claimed is not None


def _read_pages(
    plaid: PlaidClient, token: str, account_id: str, cursor: str | None
) -> AccountChanges:
    changes = AccountChanges(cursor=cursor or "")
    while True:
        page = plaid.sync_transactions(token, account_id, changes.cursor)
        changes.added += page.added
        changes.modified += page.modified
        changes.removed += [removed.transaction_id for removed in page.removed]
        changes.cursor = page.next_cursor
        changes.history = page.transactions_update_status
        if not page.has_more:
            return changes


def read_changes(
    plaid: PlaidClient, token: str, account_id: str, cursor: str | None
) -> AccountChanges:
    """Every page of an account's changes since the cursor.

    If the account's transactions change while the pages are read, Plaid asks for them to be
    read again from the same cursor.
    """
    attempt = 1
    while True:
        try:
            return _read_pages(plaid, token, account_id, cursor)
        except PlaidError as error:
            if error.code != MUTATED or attempt == PAGE_ATTEMPTS:
                raise
            attempt += 1


def _existing(db: Session, account: Account, external_ids: Iterable[str]) -> dict[str, Transaction]:
    rows: dict[str, Transaction] = {}
    for batch in itertools.batched(sorted(set(external_ids)), LOOKUP_BATCH, strict=False):
        rows.update(
            (row.external_id or "", row)
            for row in db.scalars(
                select(Transaction).where(
                    Transaction.account_id == account.id, Transaction.external_id.in_(batch)
                )
            )
        )
    return rows


def _payee(transaction: PlaidTransaction) -> str:
    for candidate in (
        transaction.merchant_name,
        transaction.name,
        transaction.original_description,
    ):
        if candidate and candidate.strip():
            return candidate.strip()[:160]
    return "Unknown payee"


def _update_from_bank(row: Transaction, transaction: PlaidTransaction) -> bool:
    """Takes what the bank keeps up to date; the payee, category and notes stay the
    household's. Returns whether anything changed."""
    values = {
        "date": transaction.authorized_date or transaction.date,
        "amount": -cents(transaction.amount),
        "pending": transaction.pending,
        "original_description": _description(transaction),
    }
    changed = False
    for name, value in values.items():
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    return changed


def _description(transaction: PlaidTransaction) -> str | None:
    description = (transaction.original_description or transaction.name or "").strip()
    return description[:255] or None


def _apply_account(
    db: Session,
    account: Account,
    changes: AccountChanges,
    chooser: CategoryChooser,
    counts: Counts,
) -> None:
    wanted = [item.transaction_id for item in itertools.chain(changes.added, changes.modified)]
    posted = [item.pending_transaction_id for item in changes.added if item.pending_transaction_id]
    rows = _existing(db, account, [*wanted, *posted, *changes.removed])
    for transaction in changes.added:
        row = rows.get(transaction.transaction_id)
        if row is not None:
            counts.updated += _update_from_bank(row, transaction)
            continue
        payee = _payee(transaction)
        # A pending transaction that posted: keep what the household changed about it.
        before = rows.get(transaction.pending_transaction_id or "")
        row = Transaction(
            account_id=account.id,
            payee=before.payee if before else payee,
            category_id=before.category_id if before else chooser.choose(transaction, payee),
            notes=before.notes if before else None,
            source=TransactionSource.PLAID,
            external_id=transaction.transaction_id,
        )
        _update_from_bank(row, transaction)
        apply_subscription_rule(db, row)
        db.add(row)
        rows[transaction.transaction_id] = row
        counts.added += 1
    for transaction in changes.modified:
        # One the household deleted stays deleted.
        row = rows.get(transaction.transaction_id)
        if row is not None and _update_from_bank(row, transaction):
            counts.updated += 1
    gone = [rows[item].id for item in changes.removed if item in rows]
    if gone:
        db.execute(delete(Transaction).where(Transaction.id.in_(gone)))
        counts.removed += len(gone)


def _next_cursor(account: Account, changes: AccountChanges) -> str | None:
    """Where the account's next sync picks up. An account the bank has never sent a change
    for is read from the start again, whatever cursor Plaid handed back, so history that
    only turns up later can't be skipped."""
    if account.sync_cursor is None and not _changed(changes):
        return None
    return changes.cursor or None


def _statuses(changes: dict[str, AccountChanges]) -> str:
    """What Plaid said about the history's progress, for the log."""
    return ", ".join(sorted({change.history for change in changes.values()})) or "nothing to read"


def _utc(moment: dt.datetime) -> dt.datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


def _failing(plaid: PlaidClient, token: str) -> dt.datetime | None:
    """When Plaid's latest attempt to update the Item's transactions failed, if it did."""
    try:
        status = plaid.get_item(token).transactions
    except PlaidError as error:
        log.info("Couldn't ask Plaid how updating a bank is going: %s", error.code)
        return None
    if status is None or status.last_failed_update is None:
        return None
    failed = _utc(status.last_failed_update)
    succeeded = status.last_successful_update
    return failed if succeeded is None or _utc(succeeded) < failed else None


def _down(plaid: PlaidClient, institution_id: str | None) -> bool:
    """Whether Plaid says it can't get transactions from the bank for anyone right now."""
    if institution_id is None:
        return False
    try:
        return plaid.transactions_health(institution_id) == "DOWN"
    except PlaidError as error:
        log.info("Couldn't ask Plaid how a bank is doing: %s", error.code)
        return False


def _trouble(
    plaid: PlaidClient, token: str, institution_id: str | None, bank: str
) -> PlaidError | None:
    """Whether the reason no transactions have come in is that Plaid can't get them from the
    bank. Otherwise the first ones are likely still on their way."""
    failed = _failing(plaid, token)
    if failed is None and not _down(plaid, institution_id):
        return None
    return unavailable(bank, failed)


def _history(statuses: Sequence[str], current: HistoryStatus) -> HistoryStatus:
    """How much history has arrived: as little as the least complete account has."""
    known = [_HISTORY[status] for status in statuses if status in _HISTORY]
    return min(known, key=_HISTORY_ORDER.index) if known else current


def _finish(
    db: Session,
    connection: Connection,
    trigger: SyncTrigger,
    started: dt.datetime,
    counts: Counts,
    error: PlaidError | None = None,
) -> None:
    now = utcnow()
    connection.last_attempt_at = now
    connection.sync_started_at = None
    if error is None:
        connection.status = ConnectionStatus.HEALTHY
        connection.error_code = connection.error_message = None
        connection.last_synced_at = now
    else:
        problem = diagnose(error)
        connection.status = problem.status
        connection.error_code = error.code[:64]
        connection.error_message = problem.message[:500]
    db.add(
        ConnectionSync(
            connection_id=connection.id,
            trigger=trigger,
            started_at=started,
            finished_at=now,
            succeeded=error is None,
            added=counts.added,
            updated=counts.updated,
            removed=counts.removed,
            error_code=connection.error_code,
            error_message=connection.error_message,
        )
    )
    db.flush()
    kept = select(ConnectionSync.id).where(ConnectionSync.connection_id == connection.id)
    kept = kept.order_by(ConnectionSync.started_at.desc(), ConnectionSync.id).limit(KEPT_SYNCS)
    db.execute(
        delete(ConnectionSync).where(
            ConnectionSync.connection_id == connection.id,
            ConnectionSync.id.not_in(kept.scalar_subquery()),
        )
    )


def _apply(
    db: Session,
    connection: Connection,
    shared: AccountsResponse,
    changes: dict[str, AccountChanges],
    default_currency: str,
) -> Counts:
    now = utcnow()
    accounts = {item.account_id: share(item, default_currency) for item in shared.accounts}
    connection.available_accounts = [item.model_dump(mode="json") for item in accounts.values()]
    connection.consent_expires_at = shared.item.consent_expiration_time
    chooser = CategoryChooser(db)
    counts = Counts()
    statuses: list[str] = []
    for account in linked_accounts(db, connection):
        current = accounts.get(account.external_id or "")
        if current is None:
            # The bank stopped sharing it. It stays, with its history, for the household to
            # keep up to date.
            unlink(account)
            continue
        refresh(account, current, now)
        account_changes = changes.get(current.id)
        # An account imported while this sync ran waits for the next one.
        if account_changes is not None:
            _apply_account(db, account, account_changes, chooser, counts)
            account.sync_cursor = _next_cursor(account, account_changes)
            statuses.append(account_changes.history)
    connection.history = _history(statuses, connection.history)
    return counts


def sync_connection(
    db: Session,
    plaid: PlaidClient,
    box: SecretBox,
    connection_id: uuid.UUID,
    trigger: SyncTrigger,
    *,
    default_currency: str,
) -> bool:
    """Syncs one connection. Returns False, doing nothing, when it's already syncing."""
    started = utcnow()
    if not claim(db, connection_id, started):
        return False
    connection = db.get_one(Connection, connection_id)
    linked = linked_accounts(db, connection)
    cursors = {
        account.external_id: account.sync_cursor for account in linked if account.external_id
    }
    # Whether the bank has ever sent a transaction for them.
    had_any = db.scalar(
        select(
            exists().where(
                Transaction.account_id.in_([account.id for account in linked]),
                Transaction.source == TransactionSource.PLAID,
            )
        )
    )
    # Nothing is locked while Plaid is asked, which can take a while.
    db.commit()
    try:
        token = box.decrypt(connection.access_token)
        shared = plaid.get_accounts(token)
        if shared.item.error is not None:
            raise shared.item.error.to_exception()
        available = {account.account_id for account in shared.accounts}
        changes = {
            account_id: read_changes(plaid, token, account_id, cursor)
            for account_id, cursor in cursors.items()
            if account_id in available
        }
        trouble = None
        if changes and not had_any and not any(_changed(item) for item in changes.values()):
            trouble = _trouble(plaid, token, connection.institution_id, connection.institution_name)
    except (PlaidError, DecryptionError) as error:
        failure = error if isinstance(error, PlaidError) else _undecryptable()
        log.warning(
            "Syncing %s failed: %s (Plaid request %s)",
            connection.institution_name,
            failure.code,
            failure.request_id,
        )
        failed = _locked(db, connection_id)
        # Removed while it synced, so there's nothing left to record.
        if failed is not None:
            _finish(db, failed, trigger, started, Counts(), failure)
            db.commit()
        return True
    except BaseException:
        release(db, connection_id)
        raise
    try:
        synced = _locked(db, connection_id)
        if synced is None:
            return True
        counts = _apply(db, synced, shared, changes, default_currency)
        _finish(db, synced, trigger, started, counts, trouble)
        db.commit()
    except BaseException:
        db.rollback()
        release(db, connection_id)
        raise
    log.info(
        "Synced %s: %d added, %d updated, %d removed (Plaid says %s)",
        connection.institution_name,
        counts.added,
        counts.updated,
        counts.removed,
        _statuses(changes),
    )
    if trouble is not None:
        log.warning("Plaid can't get transactions from %s", connection.institution_name)
    return True


def _locked(db: Session, connection_id: uuid.UUID) -> Connection | None:
    return db.get(Connection, connection_id, with_for_update=True, populate_existing=True)


def _undecryptable() -> PlaidError:
    # The app secret changed since the bank was connected, so its access token is lost.
    return PlaidError(
        "INVALID_INPUT",
        "INVALID_ACCESS_TOKEN",
        "The access token can't be decrypted with the current secret key",
    )


def release(db: Session, connection_id: uuid.UUID) -> None:
    """Lets another sync start after one failed unexpectedly."""
    db.rollback()
    db.execute(
        update(Connection).where(Connection.id == connection_id).values(sync_started_at=None)
    )
    db.commit()
