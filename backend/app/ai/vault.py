"""Codes that stand for the household's accounts, banks and people while an AI works.

An AI is never told which account, bank or person something is. Where it helps to say that two
things are the same one (these payments came from the same account), the text carries a code
instead, like ``<ACCOUNT_kdvgrmztpq>``, and Cashcove puts the real name back into what the AI
answers, so the AI can talk about an account and only people ever see which one.

- **A code lasts one request.** It is made when the request starts, is random, and is gone when
  the request ends, so it says nothing about what it stands for, can't be worked out from
  another request's, and can't be written into a payee beforehand to have something put back
  (anything shaped like a code that comes from outside is taken out first: see ``neutralize``).
- **A code is only letters, and never a word.** Consonants, so it can't spell anything, and no
  digits, so a check for account numbers can't mistake one for a number.
- **Only what an AI may need to refer to has a code**: accounts, banks and people. Account
  numbers, emails, phone numbers, ID numbers, addresses and keys have none. They are taken out
  for good, because nothing an AI says needs them back.
- **The map stays here.** It lives in memory for one request and is never sent, saved or logged.
"""

import re
import secrets
import uuid
from dataclasses import dataclass
from enum import StrEnum

from app.finance.text import text_key

# Consonants only: a code can't spell a word, and has no digit to be taken for a number.
_LETTERS = "bcdfghjkmnpqrstvwxz"
LENGTH = 10
# The bracketed form is the one Cashcove writes. An AI may drop the brackets when it copies one,
# and then it is only put back if it is a code of this request.
_CODE = re.compile(r"<\s{0,2}(ACCOUNT|BANK|PERSON)_([A-Za-z]{10})\s{0,2}>", re.IGNORECASE)
_BARE = re.compile(r"(?<![A-Za-z0-9_])(ACCOUNT|BANK|PERSON)_([A-Za-z]{10})(?![A-Za-z0-9_])", re.I)
# What stands in for a code while text is being cleaned, and the control characters that can't be
# in text from an AI because they would be mistaken for it.
_HELD = re.compile(r"\x01(\d{1,4})\x02")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


class Subject(StrEnum):
    """What a code can stand for."""

    ACCOUNT = "ACCOUNT"
    BANK = "BANK"
    PERSON = "PERSON"


@dataclass(frozen=True)
class Entity:
    """What a code stands for: which kind of thing it is, what people see in the code's place,
    and for one of the household's own accounts, which account it is."""

    subject: Subject
    shown: str
    account_id: uuid.UUID | None = None


# What stands in for a code that isn't one of this request's, which stands for nothing.
_UNKNOWN = {Subject.ACCOUNT: "an account", Subject.BANK: "a bank", Subject.PERSON: "someone"}


class Vault:
    """What the codes of one request stand for."""

    def __init__(self) -> None:
        self._entities: dict[str, Entity] = {}
        self._codes: dict[tuple[Subject, str], str] = {}

    def code_for(self, entity: Entity) -> str:
        """The code that stands for the entity in this request: the same one every time."""
        who = str(entity.account_id) if entity.account_id else text_key(entity.shown)
        known = self._codes.get((entity.subject, who))
        if known is not None:
            return known
        body = self._new_body()
        self._entities[body] = entity
        code = f"<{entity.subject}_{body}>"
        self._codes[(entity.subject, who)] = code
        return code

    def _new_body(self) -> str:
        while True:
            body = "".join(secrets.choice(_LETTERS) for _ in range(LENGTH))
            if body not in self._entities:
                return body

    def entity_of(self, code: str) -> Entity | None:
        """What a code stands for, if it is one of this request's, however it was written."""
        match = _CODE.fullmatch(code.strip()) or _BARE.fullmatch(code.strip())
        return None if match is None else self._lookup(match)

    def _lookup(self, match: re.Match[str]) -> Entity | None:
        entity = self._entities.get(match.group(2).lower())
        return entity if entity is not None and entity.subject == match.group(1).upper() else None

    def neutralize(self, text: str, replacement: str) -> str:
        """Text from outside with anything shaped like a code taken out, so no one else's words
        can pass for one of this request's."""
        return _CODE.sub(replacement, text)

    def restore(self, text: str) -> str:
        """The text with each code put back as what it stands for. One that isn't a code of this
        request stands for nothing, and is replaced by a plain word."""
        text = _CODE.sub(self._shown, text)
        return _BARE.sub(self._known, text)

    def _shown(self, match: re.Match[str]) -> str:
        entity = self._lookup(match)
        return entity.shown if entity is not None else _UNKNOWN[Subject(match.group(1).upper())]

    def _known(self, match: re.Match[str]) -> str:
        entity = self._lookup(match)
        return entity.shown if entity is not None else match.group()

    # ---- Cleaning what an AI wrote, without touching its codes -------------------------------

    @staticmethod
    def plain(text: str) -> str:
        """Text without the control characters that hold a code's place while it is cleaned."""
        return _CONTROL.sub("", text)

    def hold(self, line: str) -> tuple[str, list[str]]:
        """The line with each code taken out and held, and what each stands for to people, so
        the line can be cleaned without the codes being touched."""
        held: list[str] = []

        def take(match: re.Match[str]) -> str:
            held.append(self._shown(match))
            return f"\x01{len(held) - 1}\x02"

        return _CODE.sub(take, line), held

    @staticmethod
    def release(line: str, held: list[str]) -> str:
        """The line with what it held put back."""
        return _HELD.sub(lambda match: held[int(match.group(1))], line)
