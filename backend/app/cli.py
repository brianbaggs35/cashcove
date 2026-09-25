"""Maintenance commands, run inside the container: ``python -m app.cli --help``.

Anyone who can run these already controls the server, so they're how an admin who is
locked out gets back in.
"""

import argparse
import sys
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import audit
from app.auth.audit import Event
from app.auth.service import issue_password_reset, one_time_link, turn_off_two_factor
from app.auth.setup import issue_code, setup_required
from app.config import get_settings
from app.db import get_sessionmaker
from app.models import User
from app.models.base import utcnow

VIA = "command line"


def setup_banner(code: str, origin: str) -> str:
    rule = "=" * 64
    return "\n".join(
        [
            rule,
            "  Welcome to Cashcove! Finish setting it up in your browser:",
            f"      {origin}/welcome",
            "",
            f"  One-time setup code:  {code}",
            "",
            "  Only someone who can read these logs can create the first admin.",
            "  Run `make setup-code` any time for a fresh code.",
            rule,
        ]
    )


def setup_code(*, if_needed: bool, plain: bool) -> int:
    """Prints a new setup code, replacing any earlier one, until the first admin exists."""
    with get_sessionmaker()() as db:
        if not setup_required(db):
            if if_needed:
                return 0
            print(
                "Cashcove is already set up. Sign in, or ask an admin for a password reset link.",
                file=sys.stderr,
            )
            return 1
        code = issue_code(db, utcnow())
        db.commit()
    print(code if plain else setup_banner(code, get_settings().public_origin), flush=True)
    return 0


def _account(db: Session, email: str) -> User | None:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        print(f"There's no account with the email {email}.", file=sys.stderr)
    return user


def reset_link(email: str) -> int:
    """Prints a one-time link, valid for a day, to choose a new password."""
    with get_sessionmaker()() as db:
        user = _account(db, email)
        if user is None:
            return 1
        if not user.is_active:
            print(
                f"The account for {user.email} is turned off. An admin can turn it back on "
                "in Settings, under Users.",
                file=sys.stderr,
            )
            return 1
        token, _ = issue_password_reset(db, user, created_by=None, now=utcnow())
        audit.record(db, None, Event.PASSWORD_RESET_CREATED, user=user, via=VIA)
        db.commit()
        link = one_time_link(get_settings(), "reset-password", token)
    print(
        f"Open this link within 24 hours to choose a new password for {user.email}.\n"
        f"It works once, and signing in with it signs every other browser out.\n\n{link}"
    )
    return 0


def turn_off_2fa(email: str) -> int:
    """Turns off authenticator-app codes for someone who lost their phone and recovery codes."""
    with get_sessionmaker()() as db:
        user = _account(db, email)
        if user is None:
            return 1
        if user.totp_enabled:
            turn_off_two_factor(db, user)
            audit.record(db, None, Event.TWO_FACTOR_RESET, user=user, via=VIA)
            db.commit()
    print(
        f"Two-step verification is off for {user.email}. They can sign in with their password "
        "and turn it back on in Settings, under Security."
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    code = commands.add_parser("setup-code", help="print a one-time code to create the first admin")
    code.add_argument("--if-needed", action="store_true", help="do nothing once an admin exists")
    code.add_argument("--plain", action="store_true", help="print only the code")
    reset = commands.add_parser("reset-link", help="print a one-time link to choose a new password")
    reset.add_argument("email", help="the account's email address")
    two_factor = commands.add_parser(
        "turn-off-2fa", help="turn off authenticator-app codes for an account"
    )
    two_factor.add_argument("email", help="the account's email address")
    args = parser.parse_args(argv)
    if args.command == "reset-link":
        return reset_link(args.email)
    if args.command == "turn-off-2fa":
        return turn_off_2fa(args.email)
    return setup_code(if_needed=args.if_needed, plain=args.plain)


if __name__ == "__main__":
    sys.exit(main())
