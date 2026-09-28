"""Request and response models for the Connect tab."""

import datetime as dt
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import (
    AccountType,
    ConnectionProvider,
    ConnectionStatus,
    HistoryStatus,
    SyncTrigger,
)
from app.schemas.fields import STRICT, AmountOut, Name

# How far back a new connection's transactions go, in days.
HistoryDays = Literal[30, 90, 180, 365, 730]
AccountState = Literal["imported", "skipped", "new"]


class LinkTokenCreate(BaseModel):
    """Starts connecting a bank through Plaid Link."""

    model_config = STRICT

    # Settings > Sync's choice when left out.
    history_days: HistoryDays | None = None


class LinkUpdate(BaseModel):
    """Opens Plaid Link for a connected bank, to sign in to it again or to change which
    accounts it shares."""

    model_config = STRICT

    mode: Literal["reconnect", "accounts"] = "reconnect"


class LinkTokenOut(BaseModel):
    link_token: str
    expiration: dt.datetime


class ConnectionCreate(BaseModel):
    """What Plaid Link hands back once someone has connected a bank."""

    model_config = STRICT

    public_token: Annotated[
        str, StringConstraints(pattern=r"^public-[a-z]{1,20}-[A-Za-z0-9-]{1,100}$")
    ]


class AccountChoice(BaseModel):
    model_config = STRICT

    # Plaid's account_id for one of the accounts the bank shares.
    id: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    # What to call it once it's imported. The bank's name for it when left out.
    name: Name | None = None


class AccountsChoice(BaseModel):
    """Which of the accounts a bank shares to import. The rest are skipped."""

    model_config = STRICT

    accounts: Annotated[list[AccountChoice], Field(min_length=1, max_length=100)]
    # What happens to imported accounts that are left out: they stay, with their history, for
    # the household to keep up to date, or they're deleted along with their transactions.
    removed: Literal["keep", "delete"] = "keep"


class SyncRequest(BaseModel):
    model_config = STRICT

    # "reconnected" once someone has signed in to the bank again through Plaid Link.
    reason: Literal["manual", "reconnected"] = "manual"


class SharedAccountOut(BaseModel):
    """An account the bank shares, and whether it's imported."""

    # Plaid's account_id.
    id: str
    name: str
    official_name: str | None
    mask: str | None
    type: AccountType
    subtype: str | None
    balance: AmountOut
    currency: str
    state: AccountState
    # The Cashcove account it's imported as.
    account_id: uuid.UUID | None


class SyncOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    trigger: SyncTrigger
    started_at: dt.datetime
    finished_at: dt.datetime
    succeeded: bool
    added: int
    updated: int
    removed: int
    error_message: str | None


class ConnectionOut(BaseModel):
    id: uuid.UUID
    provider: ConnectionProvider
    institution_name: str
    institution_url: str | None
    # The bank's brand color and logo (a base64 PNG).
    institution_color: str | None
    institution_logo: str | None
    status: ConnectionStatus
    error_code: str | None
    error_message: str | None
    consent_expires_at: dt.datetime | None
    history: HistoryStatus
    syncing: bool
    last_synced_at: dt.datetime | None
    last_attempt_at: dt.datetime | None
    # When the schedule syncs it next. None when it won't, for example until someone
    # reconnects it, or when automatic syncing is off.
    next_sync_at: dt.datetime | None
    created_at: dt.datetime
    accounts: list[SharedAccountOut]
    last_sync: SyncOut | None
