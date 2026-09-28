"""Syncs connected banks on the schedule chosen in Settings > Sync.

It runs next to the API under supervisord (``python -m app.plaid.worker``), checks every half
a minute for connections that are due, and syncs them one at a time.
"""

import logging
import signal
import threading
import uuid
from collections.abc import Callable
from types import FrameType

import httpx2 as httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import load_preferences, plaid_box
from app.config import Settings, get_settings
from app.db import get_sessionmaker
from app.models import Account, AccountSource, Connection, SyncTrigger
from app.models.base import utcnow
from app.plaid.client import PlaidClient
from app.plaid.schedule import next_sync
from app.plaid.sync import sync_connection

log = logging.getLogger("cashcove.sync")

# How often to look for connections that are due, in seconds.
TICK = 30.0

Sessions = Callable[[], Session]


def due(db: Session) -> list[tuple[uuid.UUID, SyncTrigger]]:
    """The connections the schedule should sync now, longest waiting first."""
    now = utcnow()
    preferences = load_preferences(db).sync
    with_accounts = set(
        db.scalars(select(Account.connection_id).where(Account.source == AccountSource.PLAID))
    )
    found: list[tuple[uuid.UUID, SyncTrigger]] = []
    for connection in db.scalars(select(Connection).order_by(Connection.created_at)):
        upcoming = next_sync(
            connection, preferences, has_accounts=connection.id in with_accounts, now=now
        )
        if upcoming is not None and upcoming[0] <= now:
            found.append((connection.id, upcoming[1]))
    return found


def run_due(
    sessions: Sessions, settings: Settings, transport: httpx.BaseTransport | None = None
) -> int:
    """Syncs every connection that's due. Returns how many it synced."""
    if not settings.plaid_configured:
        return 0
    with sessions() as db:
        waiting = due(db)
        currency = load_preferences(db).general.currency
    if not waiting:
        return 0
    box = plaid_box(settings)
    synced = 0
    with PlaidClient(settings, transport=transport) as plaid:
        for connection_id, trigger in waiting:
            try:
                with sessions() as db:
                    synced += sync_connection(
                        db, plaid, box, connection_id, trigger, default_currency=currency
                    )
            except Exception:
                # One connection's bug shouldn't hold up the others.
                log.exception("Syncing connection %s failed", connection_id)
    return synced


def serve(
    stop: threading.Event,
    sessions: Sessions,
    settings: Settings,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """Syncs whatever's due every TICK seconds until ``stop`` is set. The first check waits a
    tick too, while the API brings the database up to date."""
    log.info("Syncing connected banks on schedule")
    while not stop.wait(TICK):
        try:
            run_due(sessions, settings, transport)
        except Exception:
            log.exception("Checking for connections to sync failed")
    log.info("Stopped syncing")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    stop = threading.Event()

    def shut_down(signum: int, frame: FrameType | None) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, shut_down)
    signal.signal(signal.SIGINT, shut_down)
    serve(stop, get_sessionmaker(), get_settings())


if __name__ == "__main__":
    main()
