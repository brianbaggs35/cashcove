"""Reading what an AI answered when it was asked for JSON."""

import json

from app.ai import errors
from app.ai.errors import AIError


def json_in(text: str, unreadable: str) -> object:
    """The JSON in an answer, which may have words around it. ``unreadable`` is what to tell
    people when there isn't any."""
    start = min((index for index in (text.find("{"), text.find("[")) if index >= 0), default=-1)
    try:
        if start < 0:
            raise ValueError("no JSON")
        return json.JSONDecoder().raw_decode(text[start:])[0]
    except ValueError as error:
        raise AIError(errors.UNREADABLE, unreadable) from error
