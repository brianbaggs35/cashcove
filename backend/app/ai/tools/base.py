"""What an AI can look up and propose, and what every tool has to do.

A tool is a typed function with checked arguments. The AI never touches the household's records:
it names a tool and gives arguments, and Cashcove runs it for the admin who is chatting, after
checking everything. There are two kinds:

- A **look-up** reads, and runs at once. What it returns goes back to the AI as text, built only
  from fields an AI may see (see ``privacy``), with every account, bank and person as a code.
- A **change** is never run for the AI. It is checked, worded for people by Cashcove (never in
  the AI's words), and kept as a proposal until an admin approves it. Only then does the same code
  the API itself uses make the change, after checking it again. That every change needs approval
  is Cashcove's rule; there is nothing for the AI to ask for or to claim.

Tools are the same for every provider: they are described in the instructions and called in JSON
text, so nothing depends on any one provider's own way of calling tools.
"""

import datetime as dt
import re
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any, NamedTuple, cast

from fastapi import HTTPException
from pydantic import BaseModel, BeforeValidator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.privacy import Protected, Text
from app.ai.vault import Vault
from app.finance.exchange_rates import ExchangeRateClient
from app.finance.text import text_key
from app.models import Category, User

# Consonants, like the vault's codes: nothing a code spells is a word.
_LETTERS = "bcdfghjkmnpqrstvwxz"
# What can't be in a name or a text the AI writes: the marks that stand for something hidden or
# for a code, and the characters that would break a list.
_NOT_ALLOWED = re.compile(r"[\[\]<>|#\x00-\x1f]")
# How much of what the AI wrote is repeated back to it when it is wrong.
_ECHO = 40


def _plain_amount(value: object) -> object:
    """An amount the way people write it, "$1,234.50", as a number could be."""
    return value.replace("$", "").replace(",", "").strip() if isinstance(value, str) else value


# An amount of money, read from text or a number.
Money = Annotated[Decimal, BeforeValidator(_plain_amount)]


class ToolError(Exception):
    """What the AI asked for can't be done as asked. The message tells the AI what to fix, or what
    to ask the person; it repeats no more than the AI itself wrote."""


def echo(value: object) -> str:
    """Something the AI wrote, shortened, to quote back to it."""
    text = " ".join(str(value).split())
    return repr(text[:_ECHO] + ("…" if len(text) > _ECHO else ""))


def explain(error: HTTPException) -> str:
    """What an API error says, as a ToolError would."""
    detail = error.detail
    if isinstance(detail, dict):
        message = cast("dict[str, Any]", detail).get("message")
        if isinstance(message, str):
            return message
    return str(detail)


class Row(StrEnum):
    """The kinds of row an AI is given a code for: the letter its codes begin with."""

    TRANSACTION = "T"
    RECURRING = "S"
    BUDGET = "B"


class Codes:
    """The short codes an AI uses for the rows a look-up showed it, for one request.

    A code is its kind, two random letters and a number (Tqm1). The letters are new every request,
    so a code the AI remembers from earlier in the conversation is not taken for one of this
    request's, which would point at a different row."""

    def __init__(self) -> None:
        self._tag = "".join(secrets.choice(_LETTERS) for _ in range(2))
        self._rows: dict[str, tuple[Row, uuid.UUID]] = {}
        self._issued: dict[tuple[Row, uuid.UUID], str] = {}

    def issue(self, row: Row, row_id: uuid.UUID) -> str:
        """The code for a row: the same one every time it is shown in this request."""
        known = self._issued.get((row, row_id))
        if known is not None:
            return known
        number = 1 + sum(1 for kind, _ in self._issued if kind == row)
        code = f"{row}{self._tag}{number}"
        self._issued[(row, row_id)] = code
        self._rows[code.lower()] = (row, row_id)
        return code

    def resolve(self, row: Row, code: str) -> uuid.UUID:
        """The row a code stands for, if it is one of this request's for that kind of row."""
        found = self._rows.get(code.strip().strip("<>[]()'\"`").lower())
        if found is None or found[0] != row:
            raise ToolError(f"{echo(code)} is not a code from a look-up in this reply: look it up.")
        return found[1]


@dataclass
class Context:
    """What a tool needs to look things up and to check what it was asked."""

    db: Session
    user: User
    protected: Protected
    vault: Vault
    codes: Codes
    rates: ExchangeRateClient | None
    today: dt.date
    currency: str
    # The categories the household has, by the name they are compared by, and the ones this
    # proposal adds, which later changes in it may use.
    categories: dict[str, str]
    new_categories: dict[str, str]

    def shown(self, text: str, kind: Text = Text.BANK) -> str:
        """Text from the household's records as the AI may see it: with any account, bank or
        person as a code and anything else it mustn't know taken out."""
        return self.protected.scrub(text, kind, self.vault)

    def written(self, value: str, what: str, *, longest: int, shortest: int = 1) -> str:
        """Text the AI wrote that is going to be kept, such as a name. It has to be plain: no
        code, no mark for something hidden, and nothing that looks like account information,
        which could only have come from the AI making it up."""
        text = " ".join(value.split())
        if not shortest <= len(text) <= longest:
            raise ToolError(f"{what} has to be {shortest} to {longest} characters.")
        if _NOT_ALLOWED.search(text) or self.protected.leaks(text):
            raise ToolError(f"{what} can't have a code, #, [ ] < > | or account details in it.")
        return text

    def searched(self, value: str, what: str, *, longest: int, shortest: int = 1) -> str:
        """Text the AI wants to look for. It has to be something the AI could have seen, because
        looking for what was hidden from it would tell it what that was: a text that taking out
        what an AI mustn't know would change is turned down."""
        text = self.written(value, what, longest=longest, shortest=shortest)
        if self.protected.scrub(text) != text:
            raise ToolError(f"{what} can't be used: look for words from the payees you were shown.")
        return text

    def category(self, name: str) -> str:
        """A category by name, the way the household spells it: one it has, or one this proposal
        adds."""
        key = text_key(name)
        found = self.categories.get(key) or self.new_categories.get(key)
        if found is None:
            raise ToolError(f"There is no category called {echo(name)}: use one from the list.")
        return found

    def optional_category(self, name: str | None) -> str | None:
        """A category, or none at all when the AI says so."""
        if name is None or text_key(name) in NO_CATEGORY:
            return None
        return self.category(name)


# What the AI says to mean no category.
NO_CATEGORY = frozenset({"", "none", "no category", "uncategorized", "uncategorised"})


def category_names(db: Session) -> dict[str, str]:
    """Every category the household has, by the name it is compared by."""
    return {text_key(name): name for name in db.scalars(select(Category.name))}


class Described(NamedTuple):
    """A change in words for people: what it is, what it will do, and what to know first."""

    title: str
    summary: str
    details: list[str]


@dataclass(frozen=True)
class Prepared:
    """A change that has been checked and worded, ready to be kept as a proposal."""

    step: dict[str, Any]
    title: str
    summary: str
    details: list[str]


@dataclass(frozen=True)
class Look:
    """A look-up: what it is called, how the AI is told to ask for it, and how it is answered."""

    name: str
    signature: str
    about: str
    args: type[BaseModel]
    run: Callable[[Context, BaseModel], str]


@dataclass(frozen=True)
class Change:
    """A change the AI can propose. `prepare` checks what the AI asked and words it for people;
    `apply` makes the change from what was kept, after checking it again."""

    name: str
    signature: str
    about: str
    args: type[BaseModel]
    prepare: Callable[[Context, BaseModel], Prepared]
    apply: Callable[[Session, dict[str, Any]], str]


def look[A: BaseModel](
    name: str,
    signature: str,
    about: str,
    args: type[A],
    run: Callable[[Context, A], str],
) -> Look:
    return Look(name, signature, about, args, cast("Callable[[Context, BaseModel], str]", run))


def change[A: BaseModel, S: BaseModel](
    name: str,
    signature: str,
    about: str,
    *,
    args: type[A],
    step: type[S],
    resolve: Callable[[Context, A], S],
    describe: Callable[[Session, S], Described],
    run: Callable[[Session, S], str],
) -> Change:
    """A change from its parts: `resolve` turns what the AI wrote into a checked step (codes and
    names become the rows they stand for), `describe` words the step for people, and `run` makes
    the change from the step alone."""

    def prepare(ctx: Context, given: BaseModel) -> Prepared:
        resolved = resolve(ctx, cast("A", given))
        said = describe(ctx.db, resolved)
        return Prepared(resolved.model_dump(mode="json"), said.title, said.summary, said.details)

    def apply(db: Session, stored: dict[str, Any]) -> str:
        return run(db, step.model_validate(stored))

    return Change(name, signature, about, args, prepare, apply)
