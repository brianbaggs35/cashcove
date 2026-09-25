"""First-run setup, guarded by a one-time code printed in the container's logs.

Until the first admin exists, anyone who can reach Cashcove could claim it. The setup code
proves the person setting it up can also read the server's logs. Only its hash is stored.
"""

from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, and_, delete, exists, select
from sqlalchemy.orm import Session

from app.auth.tokens import hash_code, new_code
from app.models import AuthChallenge, User

PURPOSE = "setup"
# The code is replaced whenever the container starts or `make setup-code` runs.
LIFETIME = timedelta(days=30)


def setup_required(db: Session) -> bool:
    return not db.scalar(select(exists().where(User.id.is_not(None))))


def issue_code(db: Session, now: datetime) -> str:
    """Creates a fresh setup code, replacing any earlier one."""
    code = new_code(3)
    db.execute(delete(AuthChallenge).where(AuthChallenge.purpose == PURPOSE))
    db.add(
        AuthChallenge(
            token_hash=hash_code(code), purpose=PURPOSE, created_at=now, expires_at=now + LIFETIME
        )
    )
    return code


def _matches(code: str, now: datetime) -> ColumnElement[bool]:
    return and_(
        AuthChallenge.purpose == PURPOSE,
        AuthChallenge.token_hash == hash_code(code),
        AuthChallenge.expires_at > now,
    )


def code_is_valid(db: Session, code: str, now: datetime) -> bool:
    return bool(db.scalar(select(exists().where(_matches(code, now)))))


def claim_code(db: Session, code: str, now: datetime) -> bool:
    """Uses up the setup code if it's right. Only one request can ever claim it."""
    claimed = db.scalars(
        delete(AuthChallenge).where(_matches(code, now)).returning(AuthChallenge.id)
    ).all()
    return len(claimed) == 1
