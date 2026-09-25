"""Authenticator-app codes (TOTP, RFC 6238) and one-time recovery codes."""

import hmac
from datetime import datetime

import pyotp

from app.auth.tokens import hash_code, new_code

ISSUER = "Cashcove"
RECOVERY_CODE_COUNT = 10


def new_secret() -> str:
    """160 random bits, the size RFC 4226 recommends, in the base32 apps expect."""
    return pyotp.random_base32(32)


def provisioning_uri(secret: str, *, email: str) -> str:
    """The otpauth:// link an authenticator app reads from the QR code."""
    totp = pyotp.TOTP(secret)
    # pyotp leaves the method's **kwargs untyped.
    uri: str = totp.provisioning_uri(name=email, issuer_name=ISSUER)  # pyright: ignore[reportUnknownMemberType]
    return uri


def matching_step(
    secret: str, code: str, *, at: datetime, last_step: int | None = None
) -> int | None:
    """The 30-second step a code belongs to, allowing one step of clock drift either way.

    Steps at or before ``last_step`` are refused, so an observed code can't be replayed.
    """
    code = code.strip().replace(" ", "")
    if len(code) != 6 or not code.isdigit():
        return None
    totp = pyotp.TOTP(secret)
    current = totp.timecode(at)
    for step in (current - 1, current, current + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            return step
    return None


def new_recovery_codes() -> list[str]:
    """Ten codes of 16 characters each (about 79 bits), shown once and stored hashed."""
    return [new_code(4) for _ in range(RECOVERY_CODE_COUNT)]


def hash_recovery_code(code: str) -> bytes:
    return hash_code(code)
