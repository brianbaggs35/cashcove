"""Random tokens and human-typeable codes, and the hashes they're stored as."""

import hashlib
import hmac
import secrets

# Lowercase letters and digits without look-alikes (0/o, 1/l/i), so codes are easy to type.
CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_token() -> str:
    """256 random bits, safe to put in a URL or cookie."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> bytes:
    """Tokens are high-entropy, so a plain SHA-256 is enough to store them safely."""
    return hashlib.sha256(token.encode()).digest()


def tokens_match(expected: str, given: str) -> bool:
    return hmac.compare_digest(expected.encode(), given.encode())


def new_code(groups: int, group_length: int = 4) -> str:
    """A code like ``k7m2-q9xp-3hvd``: about five bits per character."""
    return "-".join(
        "".join(secrets.choice(CODE_ALPHABET) for _ in range(group_length)) for _ in range(groups)
    )


def normalize_code(code: str) -> str:
    """Accepts codes typed with any case, spaces or dashes."""
    return "".join(character for character in code.lower() if character.isalnum())


def hash_code(code: str) -> bytes:
    return hash_token(normalize_code(code))
