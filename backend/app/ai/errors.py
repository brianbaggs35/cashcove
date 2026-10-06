"""What can go wrong when Cashcove asks an AI something, in words for people."""

from app.ai.tokens import Tokens

# Why a request failed, which the web app can act on.
UNAUTHORIZED = "ai_unauthorized"
NOT_FOUND = "ai_model_not_found"
RATE_LIMITED = "ai_rate_limited"
UNREACHABLE = "ai_unreachable"
PROVIDER_ERROR = "ai_provider_error"
BAD_REQUEST = "ai_bad_request"
EMPTY = "ai_empty_answer"
UNREADABLE = "ai_unreadable_answer"
REFUSED = "ai_refused"
BLOCKED = "ai_blocked"
NOT_CONFIGURED = "ai_not_configured"


class AIError(Exception):
    """The AI couldn't answer. ``message`` is safe to show: it never holds a key or any of the
    household's data."""

    def __init__(self, code: str, message: str, *, tokens: Tokens | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        # What a request that still got an answer used, e.g. one that ran out of room.
        self.tokens = tokens or Tokens()


class PrivacyError(AIError):
    """Something that looks like an account number, an account name or a bank was about to be
    sent, so nothing was. ``kinds`` says what it looked like, never the thing itself."""

    def __init__(self, kinds: list[str]) -> None:
        found = ", ".join(sorted(set(kinds)))
        super().__init__(
            BLOCKED,
            f"Cashcove stopped this request, and sent nothing, because it contained {found}. "
            "Account information is never shared with an AI.",
        )
        self.kinds = kinds
