"""The tools an AI can use in the chat, and how it is told about them."""

from app.ai.tools.base import Change, Look
from app.ai.tools.changes import CHANGES
from app.ai.tools.looks import LOOKS

LOOK_BY_NAME: dict[str, Look] = {look.name: look for look in LOOKS}
CHANGE_BY_NAME: dict[str, Change] = {change.name: change for change in CHANGES}


def describe_tools() -> str:
    """The tools in the words an AI is told them in."""
    return "\n".join(
        [
            "## Tools",
            "",
            "Look-ups run at once and you are given what they find:",
            *(f"- {look.signature}: {look.about}" for look in LOOKS),
            "",
            "Changes are proposals. The person sees them, and nothing happens until they approve:",
            *(f"- {change.signature}: {change.about}" for change in CHANGES),
        ]
    )
