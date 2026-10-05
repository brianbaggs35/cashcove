"""Request and response models for automations."""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.models import AutomationDirection, AutomationMatch, AutomationScope
from app.schemas.budget import AutomationCount
from app.schemas.fields import STRICT, AmountOut, Payee, PositiveAmount

AutomationName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
# The most texts one automation looks for, which is more than anyone picks by hand.
MAX_PAYEES = 50
# What an automation looks for: payees, or text from a payee or from what the bank called it.
Payees = Annotated[list[Payee], Field(min_length=1, max_length=MAX_PAYEES)]
# The most budgets one automation counts what it sorts toward.
MAX_COUNTS = 20
# The budgets an automation counts what it sorts toward, as income or as spending.
Counts = Annotated[list[AutomationCount], Field(max_length=MAX_COUNTS)]
NO_ACTION = "Choose a category, a subscription, a bill or a budget for it to give."
# Only payments are linked to a subscription or a bill, so money coming in has nothing to link.
MONEY_IN_LINK = "A subscription or bill is linked to payments, which is money going out."


def amounts_in_order(low: Decimal | None, high: Decimal | None) -> bool:
    """Whether the smallest amount an automation is for isn't more than the largest."""
    return low is None or high is None or low <= high


def _in_order(low: Decimal | None, high: Decimal | None) -> None:
    if not amounts_in_order(low, high):
        raise PydanticCustomError(
            "amount_range", "The smallest amount can't be more than the largest."
        )


class AutomationCreate(BaseModel):
    model_config = STRICT

    name: AutomationName
    payees: Payees
    # How the payees are compared with a transaction's payee and the bank's description.
    match: AutomationMatch = AutomationMatch.EXACT
    # Only money coming in, or only money going out, or either.
    direction: AutomationDirection = AutomationDirection.ANY
    # Only transactions in this account, or in any when left out.
    account_id: uuid.UUID | None = None
    # Only transactions of this much, whichever way the money went; either end can be left open.
    min_amount: PositiveAmount | None = None
    max_amount: PositiveAmount | None = None
    category_id: uuid.UUID | None = None
    # The subscription or the bill it links payments to, which are linked the same way.
    subscription_id: uuid.UUID | None = None
    # Budgets it counts what it sorts toward, as income or as spending.
    counts: Counts = Field(default_factory=list[AutomationCount])
    apply_to: AutomationScope = AutomationScope.ALL

    @model_validator(mode="after")
    def _is_sensible(self) -> Self:
        if self.category_id is None and self.subscription_id is None and not self.counts:
            raise PydanticCustomError("no_action", NO_ACTION)
        if self.subscription_id is not None and self.direction == AutomationDirection.IN:
            raise PydanticCustomError("money_in_link", MONEY_IN_LINK)
        _in_order(self.min_amount, self.max_amount)
        return self


class AutomationUpdate(BaseModel):
    """Leave a field out to keep it. Null takes the account, amounts, category or subscription
    away, and an empty list of budgets stops it counting toward any."""

    model_config = STRICT

    name: AutomationName | None = None
    payees: Payees | None = None
    match: AutomationMatch | None = None
    direction: AutomationDirection | None = None
    account_id: uuid.UUID | None = None
    min_amount: PositiveAmount | None = None
    max_amount: PositiveAmount | None = None
    category_id: uuid.UUID | None = None
    subscription_id: uuid.UUID | None = None
    counts: Counts | None = None
    apply_to: AutomationScope | None = None
    active: bool | None = None


class AutomationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    payees: list[str]
    match: AutomationMatch
    direction: AutomationDirection
    account_id: uuid.UUID | None
    min_amount: AmountOut | None
    max_amount: AmountOut | None
    category_id: uuid.UUID | None
    subscription_id: uuid.UUID | None
    counts: list[AutomationCount] = Field(default_factory=list[AutomationCount])
    apply_to: AutomationScope
    active: bool
    # How many of the household's transactions it sorts.
    matching_count: int = 0
    created_at: dt.datetime
    updated_at: dt.datetime


class AutomationSaved(AutomationOut):
    """What saving an automation did: how many transactions it already had that it sorted."""

    applied: int = 0


class AutomationPreviewRequest(BaseModel):
    """What an automation would look for and give, before it's saved."""

    model_config = STRICT

    payees: Payees
    match: AutomationMatch = AutomationMatch.EXACT
    direction: AutomationDirection = AutomationDirection.ANY
    account_id: uuid.UUID | None = None
    min_amount: PositiveAmount | None = None
    max_amount: PositiveAmount | None = None
    # The automation being changed, which doesn't overlap itself.
    automation_id: uuid.UUID | None = None
    # Whether it would give a category, and whether it would link a subscription, which is
    # what makes another automation overlap it.
    category: bool = False
    subscription: bool = False

    @model_validator(mode="after")
    def _is_sensible(self) -> Self:
        _in_order(self.min_amount, self.max_amount)
        return self


class OverlappingAutomation(BaseModel):
    """Another automation that gives some of the same transactions the same kind of thing."""

    automation_id: uuid.UUID
    automation_name: str
    # How many of the household's transactions both of them sort.
    count: int


class AutomationPreview(BaseModel):
    """What an automation would sort, and which others already sort some of the same."""

    matching: int
    overlaps: list[OverlappingAutomation]
