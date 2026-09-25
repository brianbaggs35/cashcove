"""Password hashing with Argon2id, and the rules a new password has to meet.

The rules follow NIST SP 800-63B: a generous minimum length, no composition rules, and a
check against passwords that are known to be common or built from the account's own details.
"""

import secrets
import unicodedata
from functools import cache
from importlib.resources import files

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.config import Settings

MIN_LENGTH = 12
MAX_LENGTH = 256


def _normalize(password: str) -> str:
    """NFKC, as NIST recommends, so a password typed on another keyboard still matches."""
    return unicodedata.normalize("NFKC", password)


class Passwords:
    """Hashes and checks passwords with one Argon2id cost setting."""

    def __init__(self, *, time_cost: int, memory_kib: int, parallelism: int) -> None:
        self._hash = PasswordHash(
            (Argon2Hasher(time_cost=time_cost, memory_cost=memory_kib, parallelism=parallelism),)
        )
        # Checked against when no account matches, so a wrong email takes as long as a wrong
        # password and response times don't reveal who has an account.
        self._dummy = self._hash.hash(secrets.token_urlsafe(16))

    def hash(self, password: str) -> str:
        return self._hash.hash(_normalize(password))

    def verify(self, password: str, hashed: str | None) -> tuple[bool, str | None]:
        """Returns whether it matched, and a new hash when the stored one uses an old cost."""
        password = _normalize(password)
        if hashed is None:
            self._hash.verify(password, self._dummy)
            return False, None
        return self._hash.verify_and_update(password, hashed)


@cache
def _passwords(time_cost: int, memory_kib: int, parallelism: int) -> Passwords:
    return Passwords(time_cost=time_cost, memory_kib=memory_kib, parallelism=parallelism)


def get_passwords(settings: Settings) -> Passwords:
    return _passwords(
        settings.password_time_cost, settings.password_memory_kib, settings.password_parallelism
    )


@cache
def _common_passwords() -> frozenset[str]:
    text = files("app.auth").joinpath("common_passwords.txt").read_text(encoding="utf-8")
    return frozenset(line for line in text.splitlines() if line and not line.startswith("#"))


def password_problem(password: str, *, email: str = "", name: str = "") -> str | None:
    """Explains what's wrong with a new password, or returns None when it's acceptable."""
    password = _normalize(password)
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    lowered = password.lower()
    if lowered in _common_passwords():
        return "This password is too common. Choose something less predictable."
    if len(set(lowered)) < 4:
        return "Use more than a few different characters."
    remainder = lowered
    context = {"cashcove", email.lower().partition("@")[0], *name.lower().split()}
    for word in sorted(context, key=len, reverse=True):
        if len(word) >= 3:
            remainder = remainder.replace(word, "")
    if len(remainder) < 8:
        return "Too much of this password is your name, email address or Cashcove."
    return None
