"""When each connection syncs next.

A self-hosted install on a private network can't receive Plaid's webhooks, so Cashcove asks
Plaid for changes on the schedule chosen in Settings > Sync instead.
"""

import datetime as dt

from app.models import Connection, ConnectionStatus, HistoryStatus, SyncTrigger
from app.plaid.errors import UNAVAILABLE
from app.schemas.preferences import SyncPreferences

# While a new connection's history comes in, it's checked this often, whatever the schedule,
IMPORT_INTERVAL = dt.timedelta(minutes=2)
# for up to this long after it was connected. Plaid usually has it all within minutes.
IMPORT_WINDOW = dt.timedelta(days=1)


def next_sync(
    connection: Connection,
    preferences: SyncPreferences,
    *,
    has_accounts: bool,
    now: dt.datetime,
) -> tuple[dt.datetime, SyncTrigger] | None:
    """When the schedule syncs the connection next, and why. None when it doesn't: until
    accounts are imported, while the bank needs someone to sign in again, and when syncing on
    a schedule is turned off."""
    if not has_accounts or connection.status == ConnectionStatus.LOGIN_REQUIRED:
        return None
    # A bank Plaid can't get transactions from is checked on the usual schedule: asking every
    # couple of minutes wouldn't bring them any sooner.
    importing = (
        connection.history != HistoryStatus.COMPLETE and connection.error_code != UNAVAILABLE
    )
    if importing and now - connection.created_at < IMPORT_WINDOW:
        interval, trigger = IMPORT_INTERVAL, SyncTrigger.LINKED
    elif preferences.auto_sync:
        interval, trigger = dt.timedelta(hours=preferences.interval_hours), SyncTrigger.SCHEDULED
    else:
        return None
    last = connection.last_attempt_at
    return (last + interval if last else now), trigger
