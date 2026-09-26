"""Request and response models for the Accounts tab."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import AccountSource, AccountType
from app.schemas.fields import (
    STRICT,
    Amount,
    AmountOut,
    Currency,
    Institution,
    Mask,
    Name,
    Notes,
    PositiveAmount,
)


class AccountCreate(BaseModel):
    """An account the household keeps up to date itself."""

    model_config = STRICT

    name: Name
    type: AccountType
    institution: Institution = None
    mask: Mask = None
    # The household's currency when left out.
    currency: Currency | None = None
    # Negative for what's owed, as on a credit card or loan.
    balance: Amount
    credit_limit: PositiveAmount | None = None
    notes: Notes = None


class AccountUpdate(BaseModel):
    """Leave a field out to keep it. Null clears the optional ones.

    Plaid keeps a linked account's balance and details up to date, so only its name and notes
    can change, and whether it's closed.
    """

    model_config = STRICT

    name: Name | None = None
    type: AccountType | None = None
    institution: Institution = None
    mask: Mask = None
    currency: Currency | None = None
    balance: Amount | None = None
    credit_limit: PositiveAmount | None = None
    notes: Notes = None
    # Closed accounts keep their history but drop out of totals and pickers.
    closed: bool | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: AccountType
    institution: str | None
    mask: str | None
    currency: str
    balance: AmountOut
    available_balance: AmountOut | None
    credit_limit: AmountOut | None
    balance_updated_at: datetime
    notes: str | None
    source: AccountSource
    official_name: str | None
    subtype: str | None
    closed_at: datetime | None
    created_at: datetime
    transaction_count: int = 0
