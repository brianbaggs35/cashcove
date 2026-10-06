"""Keeping account information away from every AI.

What an AI is sent is built from a short list of fields (dates, amounts, payees, categories,
budgets and the names of subscriptions and bills), never from an account, a bank connection
or a transaction's raw bank description. Two guardrails sit on top of that:

1. **Scrubbing.** Free text that comes from a bank, a file or a person (a payee, a question)
   loses anything that looks like an account number, a card number, a mask such as ``•••• 4410``,
   an email address, a phone number, an ID number, a street address or a key, and the name of
   every account and bank the household has set up in Cashcove, and of every person in it,
   with whoever a Zelle, Venmo or PayPal payment went to or came from.
2. **The check.** Just before a request leaves, everything in it that came from the household's
   data is checked again, and if any of that is still there the request is refused and nothing
   is sent. This is what catches a mistake made anywhere else.

Names the household uses as labels (a category, budget, subscription, bill or automation) aren't
account information even when an account has the same name, like "Savings", so they pass.

It can only know the banks and accounts the household has set up, so a payee that names some
other bank is treated as the payee it is.
"""

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import Enum, auto

from sqlalchemy import select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.ai.errors import PrivacyError
from app.finance.text import text_key
from app.models import (
    Account,
    Automation,
    Budget,
    Category,
    CategoryGroup,
    Connection,
    Subscription,
    User,
)

ACCOUNT = "[account]"
NUMBER = "#"
HIDDEN = "[hidden]"
PERSON = "[person]"
ADDRESS = "[address]"
# Shorter than this and a name would match inside ordinary words.
MIN_NAME = 3
# A mask has to be this long to be told from a number in ordinary text, and one that looks like a
# year can't be told from a date, which every request has.
MIN_MASK = 4
_YEAR = re.compile(r"(?:19|20|21)\d\d")

# Every quantifier here is bounded or has nothing after it to backtrack into, so no text, however
# long or odd, makes matching slow.
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}")
# A long run of letters, digits, dashes and underscores, which is what a key or a token looks like
# when it has both letters and digits (see `_is_secret`).
_TOKEN = re.compile(r"\b[A-Za-z0-9_-]{24,}\b")
# The last digits of a number as a bank shows them: xxxx4410, •••• 4410, ending in 4410.
_MASK = re.compile(
    r"(?:\b(?:x{2,16}|ending(?:\s{1,3}in)?|acct|account|card|a/c|no\.?|number)\s{0,3}"
    r"|[*•]{1,16}\s{0,3}|\.{3}\s{0,3})\d{2,}\b|#\s{0,3}\d{4,}\b",
    re.IGNORECASE,
)
# A phone number as North Americans write one, and a Social Security number.
_PHONE = re.compile(r"(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\d)")
_SSN = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
# A street address: a number, up to four words and a word like "St". Every part is bounded.
_STREET = re.compile(
    r"(?<!\d)\d{1,5} {1,3}(?:[A-Za-z0-9.'-]{1,20} {1,3}){1,4}?"
    r"(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|"
    r"pkwy|parkway|hwy|highway)\b\.?",
    re.IGNORECASE,
)
# Who a payment between people went to or came from: the words after "to" or "from".
_PEER = re.compile(
    r"\b(?:zelle|venmo|paypal|cash ?app|apple cash|wire)\b[^|\d]{0,30}?\b(?:to|from) {1,3}"
    r"([A-Za-z][A-Za-z'.-]{0,25}(?: {1,3}[A-Za-z][A-Za-z'.-]{0,25}){0,4})",
    re.IGNORECASE,
)
# Digits, with the spaces and dashes numbers are written with, and any of those left at the end.
_DIGITS = re.compile(r"\d[\d -]*")
_DATE = re.compile(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}")
# A long number with nothing in it, as an account number is.
_LONG_NUMBER = re.compile(r"\d{8,}")
_SPACES = re.compile(r"\s+")

# Words an institution's name ends with that aren't what makes it that bank.
_INSTITUTION_SUFFIX = re.compile(
    r"[\s,.-]+(?:bank|banking|credit union|financial|n\.?a\.?|national association|"
    r"inc\.?|corp\.?|co\.?)\s*$",
    re.IGNORECASE,
)


class Text(Enum):
    """Where a piece of text came from, which says how much of it has to go."""

    # From a bank or a file, such as a payee: any number of 4 or more digits goes too.
    BANK = auto()
    # Typed by a person, who writes years and amounts: only long numbers go.
    ASKED = auto()
    # A name the household chose for a category, a budget and the like.
    LABEL = auto()


def _institution_names(name: str) -> list[str]:
    """An institution as named, and without "Bank" and the like, since a payee says "TD" or
    "Tartan" and not the whole name."""
    short = _INSTITUTION_SUFFIX.sub("", name).strip()
    return [name, short] if short else [name]


def _name_pattern(keys: Iterable[str]) -> re.Pattern[str] | None:
    """One pattern for all the names, the longest first, ignoring case and spacing."""
    ordered = sorted(set(keys), key=lambda key: (-len(key), key))
    if not ordered:
        return None
    spelled = [re.escape(key).replace(r"\ ", r"\s+") for key in ordered]
    return re.compile(
        r"(?<![A-Za-z0-9])(?:" + "|".join(spelled) + r")(?![A-Za-z0-9])", re.IGNORECASE
    )


def _column(
    db: Session, column: InstrumentedAttribute[str] | InstrumentedAttribute[str | None]
) -> list[str]:
    """Every value a column has, leaving out the empty ones."""
    return [value for value in db.scalars(select(column)) if value]


def _shared_accounts(db: Session) -> tuple[list[str], list[str]]:
    """The names and the masks of the accounts banks share, imported or not."""
    names: list[str] = []
    masks: list[str] = []
    for (shared,) in db.execute(select(Connection.available_accounts)):
        for account in shared:
            names += [
                value
                for value in (account.get("name"), account.get("official_name"))
                if isinstance(value, str)
            ]
            if isinstance(account.get("mask"), str):
                masks.append(account["mask"])
    return names, masks


@dataclass(frozen=True)
class Protected:
    """What the household's accounts and banks are called, which no AI is ever told."""

    names: re.Pattern[str] | None
    # The people in the household, who a payee may name.
    people: re.Pattern[str] | None = None

    @classmethod
    def of(
        cls, names: Iterable[str], labels: Iterable[str] = (), people: Iterable[str] = ()
    ) -> "Protected":
        """Protects the names, except any that is also one of the labels, and the people's."""
        label_keys = {text_key(label) for label in labels}
        keys = {text_key(name) for name in names}
        return cls(
            _name_pattern(key for key in keys if len(key) >= MIN_NAME and key not in label_keys),
            _name_pattern(
                text_key(person) for person in people if len(text_key(person)) >= MIN_NAME
            ),
        )

    @classmethod
    def load(cls, db: Session) -> "Protected":
        """The names of every account and bank in Cashcove, including the accounts a bank
        shares that haven't been imported."""
        shared_names, shared_masks = _shared_accounts(db)
        names = _column(db, Account.name) + _column(db, Account.official_name) + shared_names
        # The last digits of the household's own accounts are protected wherever they appear,
        # not only after a word like "ending in".
        masks = _column(db, Account.mask) + shared_masks
        names += [mask for mask in masks if len(mask) >= MIN_MASK and not _YEAR.fullmatch(mask)]
        institutions = _column(db, Account.institution) + _column(db, Connection.institution_name)
        labels = [
            label
            for column in (
                Category.name,
                CategoryGroup.name,
                Budget.name,
                Subscription.name,
                Automation.name,
            )
            for label in _column(db, column)
        ]
        return cls.of(
            [*names, *(short for name in institutions for short in _institution_names(name))],
            labels,
            _column(db, User.name),
        )

    def scrub(self, text: str, kind: Text = Text.BANK) -> str:
        """The text without anything that must not be sent."""
        text = _EMAIL.sub(HIDDEN, text)
        text = _TOKEN.sub(_hide_secret, text)
        if kind != Text.LABEL and self.names is not None:
            text = self.names.sub(ACCOUNT, text)
        if kind != Text.LABEL:
            if self.people is not None:
                text = self.people.sub(PERSON, text)
            text = _PEER.sub(_hide_peer, text)
            text = _SSN.sub(HIDDEN, text)
            text = _PHONE.sub(HIDDEN, text)
            text = _STREET.sub(ADDRESS, text)
        text = _MASK.sub(ACCOUNT, text)
        text = _DIGITS.sub(_hide_digits(4 if kind == Text.BANK else 8), text)
        return _SPACES.sub(" ", text).strip()

    def leaks(self, text: str) -> list[str]:
        """What's in the text that must not be sent, in words for people."""
        found: list[str] = []
        if self.names is not None and self.names.search(text):
            found.append("an account or bank name")
        if _MASK.search(text) or _LONG_NUMBER.search(text):
            found.append("an account number")
        if _EMAIL.search(text):
            found.append("an email address")
        if self.people is not None and self.people.search(text):
            found.append("a person's name")
        if _SSN.search(text) or _PHONE.search(text):
            found.append("a phone number or an ID number")
        if _STREET.search(text):
            found.append("a street address")
        if any(_is_secret(token.group()) for token in _TOKEN.finditer(text)):
            found.append("something that looks like a key")
        return found

    def ensure_clean(self, *texts: str) -> None:
        """Refuses, naming what looked like account information, unless every text is clean."""
        kinds = [kind for text in texts for kind in self.leaks(text)]
        if kinds:
            raise PrivacyError(kinds)


def _hide_peer(match: re.Match[str]) -> str:
    """The payment's words, without the person's name at the end of them."""
    return match.group()[: match.start(1) - match.start()] + PERSON


def _is_secret(token: str) -> bool:
    """A long token that mixes letters and digits, as a key does and a long word doesn't."""
    return any(character.isdigit() for character in token) and any(
        character.isalpha() for character in token
    )


def _hide_secret(match: re.Match[str]) -> str:
    return HIDDEN if _is_secret(match.group()) else match.group()


def _hide_digits(minimum: int) -> Callable[[re.Match[str]], str]:
    """Replaces a run of digits with at least `minimum` of them, but not a date."""

    def replace(match: re.Match[str]) -> str:
        run = match.group()
        # The spaces and dashes the run ends with aren't part of the number.
        number = run.rstrip(" -")
        digits = sum(character.isdigit() for character in number)
        return run if digits < minimum or _DATE.fullmatch(number) else NUMBER + run[len(number) :]

    return replace
