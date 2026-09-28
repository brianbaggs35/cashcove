"""What Plaid's errors mean for a bank connection, and what to tell people about them.

Plaid lists its errors at https://plaid.com/docs/errors/. Cashcove words its own messages,
since Plaid's are written for developers, and keeps Plaid's error_code alongside for support.
"""

from dataclasses import dataclass

from fastapi import status

from app.auth.deps import ApiError
from app.models import ConnectionStatus
from app.plaid.client import PlaidError


def _by_code(*groups: tuple[str, set[str]]) -> dict[str, str]:
    """Each error code's message, from each message and the codes that get it."""
    return {code: message for message, codes in groups for code in codes}


# Errors only the person who signed in to the bank can fix, through Plaid Link's update mode.
# Syncing can't succeed until they do, so the schedule leaves these connections alone.
_LOGIN_REQUIRED = _by_code(
    (
        "The bank needs you to sign in again before it shares anything new.",
        {
            "ITEM_LOGIN_REQUIRED",
            "INVALID_CREDENTIALS",
            "INVALID_MFA",
            "INVALID_OTP",
            "INVALID_SEND_METHOD",
            "INVALID_UPDATED_USERNAME",
            "INSUFFICIENT_CREDENTIALS",
            "MFA_NOT_SUPPORTED",
            "USER_INPUT_TIMEOUT",
        },
    ),
    (
        "The bank locked sign-ins after too many attempts. Unlock it on the bank's website, "
        "then reconnect.",
        {"ITEM_LOCKED"},
    ),
    (
        "The bank wants you to take care of something on its website first, like a new "
        "password or terms to accept. Then reconnect.",
        {"PASSWORD_RESET_REQUIRED", "USER_SETUP_REQUIRED"},
    ),
    (
        "The bank isn't allowing Cashcove to see these accounts. Reconnect and allow access.",
        {"ACCESS_NOT_GRANTED"},
    ),
    (
        "The bank isn't sharing any accounts. Reconnect to choose which it shares.",
        {"NO_ACCOUNTS"},
    ),
)

# Problems on Plaid's or the bank's side that usually clear up by themselves.
_TRY_AGAIN = "Plaid couldn't reach the bank just now. Cashcove will try again at the next sync."
_TEMPORARY_TYPES = frozenset({"INSTITUTION_ERROR", "API_ERROR", "RATE_LIMIT_EXCEEDED"})

# Problems that need someone to change something, like Plaid's keys.
_NEEDS_ATTENTION = _by_code(
    (
        "Cashcove couldn't reach Plaid. Check that the server can reach the internet; "
        "Cashcove will try again at the next sync.",
        {"PLAID_UNREACHABLE"},
    ),
    (
        "Plaid turned down Cashcove's keys. Check that the client ID and secret are for the "
        "Plaid environment Cashcove is set to.",
        {"INVALID_API_KEYS"},
    ),
    (
        "Plaid no longer knows this connection, for example after switching Plaid "
        "environments. Remove it and connect the bank again.",
        {"INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND"},
    ),
    (
        "Plaid no longer supports this bank. Remove the connection; you can keep its accounts.",
        {"INSTITUTION_NO_LONGER_SUPPORTED"},
    ),
    (
        "This bank isn't available in the Plaid environment Cashcove is set to.",
        {"INSTITUTION_NOT_ENABLED_IN_ENVIRONMENT"},
    ),
    (
        "Plaid hasn't approved Cashcove's keys for this bank yet. Check the Plaid dashboard.",
        {"UNAUTHORIZED_INSTITUTION"},
    ),
)

# The connection is already gone at Plaid, so there's nothing left to remove there.
GONE = frozenset({"ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"})


@dataclass(frozen=True)
class Problem:
    status: ConnectionStatus
    message: str


def diagnose(error: PlaidError) -> Problem:
    """What a failed sync means for the connection, and what to tell people."""
    if error.code in _LOGIN_REQUIRED:
        return Problem(ConnectionStatus.LOGIN_REQUIRED, _LOGIN_REQUIRED[error.code])
    if error.code in _NEEDS_ATTENTION:
        return Problem(ConnectionStatus.ERROR, _NEEDS_ATTENTION[error.code])
    if error.error_type in _TEMPORARY_TYPES or error.code == "PRODUCT_NOT_READY":
        return Problem(ConnectionStatus.ERROR, _TRY_AGAIN)
    return Problem(
        ConnectionStatus.ERROR,
        f"Plaid couldn't sync this bank ({error.code}). Cashcove will try again at the next sync.",
    )


def plaid_failed(error: PlaidError) -> ApiError:
    """An API error for a request Plaid turned down, such as creating a Link token."""
    if error.code in _LOGIN_REQUIRED or error.code in _NEEDS_ATTENTION:
        message = diagnose(error).message
    elif error.error_type in _TEMPORARY_TYPES:
        message = "Plaid couldn't be reached just now. Try again in a few minutes."
    else:
        message = f"Plaid turned down the request ({error.code}). Try again, or check the logs."
    return ApiError(status.HTTP_502_BAD_GATEWAY, "plaid_error", message, plaid_code=error.code)
