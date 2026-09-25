"""Maintenance commands, run inside the container: ``python -m app.cli --help``."""

import argparse
import sys
from collections.abc import Sequence

from app.auth.setup import issue_code, setup_required
from app.config import get_settings
from app.db import get_sessionmaker
from app.models.base import utcnow


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


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    code = commands.add_parser("setup-code", help="print a one-time code to create the first admin")
    code.add_argument("--if-needed", action="store_true", help="do nothing once an admin exists")
    code.add_argument("--plain", action="store_true", help="print only the code")
    args = parser.parse_args(argv)
    return setup_code(if_needed=args.if_needed, plain=args.plain)


if __name__ == "__main__":
    sys.exit(main())
