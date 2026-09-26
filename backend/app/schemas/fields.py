"""Field types the finance schemas share: amounts of money, names and optional text."""

from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, ConfigDict, Field, PlainSerializer, StringConstraints

from app.models.base import CENT

# Up to a trillion, with cents: far beyond any household's accounts, and well inside what the
# database stores.
MAX_AMOUNT = Decimal("999999999999.99")

STRICT = ConfigDict(extra="forbid")

# Amounts arrive as strings or numbers with at most two decimal places, and go out as strings
# with exactly two ("12.50"), so nothing is lost to floating point on either side.
Amount = Annotated[Decimal, Field(ge=-MAX_AMOUNT, le=MAX_AMOUNT, max_digits=14, decimal_places=2)]
PositiveAmount = Annotated[Decimal, Field(ge=0, le=MAX_AMOUNT, max_digits=14, decimal_places=2)]
AmountOut = Annotated[
    Decimal, PlainSerializer(lambda value: str(value.quantize(CENT)), return_type=str)
]


def _required_text(max_length: int) -> StringConstraints:
    return StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)


def _blank_to_none(value: str | None) -> str | None:
    """Optional text left blank means none."""
    return value or None


Name = Annotated[str, _required_text(80)]
CategoryName = Annotated[str, _required_text(60)]
Payee = Annotated[str, _required_text(160)]

Institution = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None,
    AfterValidator(_blank_to_none),
]
Notes = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None,
    AfterValidator(_blank_to_none),
]
TransactionNotes = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None,
    AfterValidator(_blank_to_none),
]
# The last two to four characters of an account number, as a bank shows them.
Mask = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9]{2,4}$")] | None,
    AfterValidator(_blank_to_none),
]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
# One emoji, which can take several code points (a flag, a skin tone, a family).
Emoji = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\S{1,16}$")]
