"""Slows down guessing, per email address and per client address.

The counters live in Postgres, so every API worker shares them and they survive restarts.
After a few free attempts, each failure locks the key for twice as long as the last, from
30 seconds up to 15 minutes. nginx separately caps how often one address can try at all.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, or_
from sqlalchemy.orm import Session

from app.models import LoginThrottle


@dataclass(frozen=True)
class Limit:
    prefix: str
    free_attempts: int


EMAIL = Limit("email", 5)
ADDRESS = Limit("ip", 20)
SETUP = Limit("setup", 10)

FIRST_LOCK = timedelta(seconds=30)
LONGEST_LOCK = timedelta(minutes=15)
# A key that hasn't failed for this long starts again from zero.
FORGET_AFTER = timedelta(hours=1)


def key(limit: Limit, value: str) -> str:
    return f"{limit.prefix}:{value.lower()}"


def seconds_locked(db: Session, keys: list[str], now: datetime) -> int:
    """How long until every one of these keys may try again (0 when none is locked)."""
    remaining = 0
    for name in keys:
        row = db.get(LoginThrottle, name)
        if row is not None and row.locked_until is not None and row.locked_until > now:
            remaining = max(remaining, int((row.locked_until - now).total_seconds()) + 1)
    return remaining


def record_failure(db: Session, name: str, limit: Limit, now: datetime) -> None:
    row = db.get(LoginThrottle, name)
    if row is None:
        row = LoginThrottle(key=name, failures=0, last_failure_at=now)
        db.add(row)
    elif now - row.last_failure_at > FORGET_AFTER:
        row.failures = 0
        row.locked_until = None
    row.failures += 1
    row.last_failure_at = now
    over = row.failures - limit.free_attempts
    if over > 0:
        # The exponent is capped so a long run of failures can't overflow the delay.
        row.locked_until = now + min(FIRST_LOCK * 2 ** min(over - 1, 10), LONGEST_LOCK)
    # Counters that have been forgotten anyway are removed, so guesses at made-up
    # addresses can't fill the table.
    db.execute(
        delete(LoginThrottle).where(
            LoginThrottle.key != name,
            LoginThrottle.last_failure_at <= now - FORGET_AFTER,
            or_(LoginThrottle.locked_until.is_(None), LoginThrottle.locked_until <= now),
        )
    )


def clear(db: Session, name: str) -> None:
    row = db.get(LoginThrottle, name)
    if row is not None:
        db.delete(row)
