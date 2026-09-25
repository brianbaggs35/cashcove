"""Household preferences managed on the Settings tab."""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GeneralPreferences(_Strict):
    household_name: Annotated[str, Field(min_length=1, max_length=80)] = "My household"
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] = "USD"
    locale: Annotated[str, Field(pattern=r"^[a-z]{2,3}(-[A-Z]{2})?$")] = "en-US"
    week_starts_on: Literal["sunday", "monday"] = "sunday"
    fiscal_year_start_month: Annotated[int, Field(ge=1, le=12)] = 1


class AlertPreferences(_Strict):
    subscription_due_enabled: bool = True
    subscription_due_days_before: Annotated[int, Field(ge=0, le=30)] = 3
    low_balance_enabled: bool = True
    low_balance_threshold: Money = Decimal("100.00")
    large_transaction_enabled: bool = True
    large_transaction_threshold: Money = Decimal("500.00")
    budget_threshold_enabled: bool = True
    budget_threshold_percent: Annotated[int, Field(ge=50, le=150)] = 90
    sync_failure_enabled: bool = True


class SyncPreferences(_Strict):
    auto_sync: bool = True
    # A self-hosted install on a private network can't receive Plaid webhooks,
    # so new transactions are fetched on this schedule instead.
    interval_hours: Literal[1, 2, 4, 6, 12, 24] = 6
    history_days: Literal[30, 90, 180, 365, 730] = 730


class Preferences(_Strict):
    general: GeneralPreferences = Field(default_factory=GeneralPreferences)
    alerts: AlertPreferences = Field(default_factory=AlertPreferences)
    sync: SyncPreferences = Field(default_factory=SyncPreferences)
