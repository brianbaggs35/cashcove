"""How the accounts a bank shares through Plaid become Cashcove accounts."""

import re
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountSource, AccountType, Connection
from app.models.base import CENT
from app.plaid.client import PlaidAccount

# Plaid's depository subtypes that hold savings rather than spending money.
_SAVINGS = frozenset({"savings", "cd", "money market", "hsa"})
_MORTGAGES = frozenset({"mortgage", "home equity"})
_MASK = re.compile(r"^[A-Za-z0-9]{2,4}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")


class SharedAccount(BaseModel):
    """An account the bank shares, as a connection remembers it for choosing what to import."""

    model_config = ConfigDict(frozen=True)

    # Plaid's account_id.
    id: str
    name: str
    official_name: str | None = None
    mask: str | None = None
    type: AccountType
    subtype: str | None = None
    balance: Decimal
    available_balance: Decimal | None = None
    credit_limit: Decimal | None = None
    currency: str


def account_type(plaid_type: str, subtype: str | None) -> AccountType:
    """The kind of Cashcove account for one of Plaid's account types and subtypes."""
    match plaid_type:
        case "depository":
            return AccountType.SAVINGS if subtype in _SAVINGS else AccountType.CHECKING
        case "credit":
            return AccountType.CREDIT_CARD
        case "loan":
            return AccountType.MORTGAGE if subtype in _MORTGAGES else AccountType.LOAN
        case "investment" | "brokerage":
            return AccountType.INVESTMENT
        case _:
            return AccountType.OTHER


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def share(account: PlaidAccount, default_currency: str) -> SharedAccount:
    """What Cashcove keeps of an account Plaid reports.

    Plaid reports what's owed on cards and loans as a positive balance, where Cashcove counts
    it as negative, so adding up balances gives net worth.
    """
    kind = account_type(account.type, account.subtype)
    balances = account.balances
    current = balances.current if balances.current is not None else balances.available
    balance = cents(current or Decimal(0))
    if kind in {AccountType.CREDIT_CARD, AccountType.LOAN, AccountType.MORTGAGE}:
        balance = -balance
    currency = balances.iso_currency_code
    mask = account.mask[-4:] if account.mask else None
    return SharedAccount(
        id=account.account_id,
        name=account.name.strip()[:80] or "Account",
        official_name=account.official_name[:160] if account.official_name else None,
        mask=mask if mask and _MASK.match(mask) else None,
        type=kind,
        subtype=account.subtype[:40] if account.subtype else None,
        balance=balance,
        available_balance=cents(balances.available) if balances.available is not None else None,
        # For other accounts, Plaid's limit is an overdraft limit, which Cashcove doesn't track.
        credit_limit=(
            cents(balances.limit)
            if kind == AccountType.CREDIT_CARD and balances.limit is not None
            else None
        ),
        currency=currency if currency and _CURRENCY.match(currency) else default_currency,
    )


def shared_accounts(connection: Connection) -> list[SharedAccount]:
    return [SharedAccount.model_validate(account) for account in connection.available_accounts]


def linked_accounts(db: Session, connection: Connection) -> list[Account]:
    """The accounts a connection keeps up to date, oldest first."""
    return list(
        db.scalars(
            select(Account)
            .where(Account.connection_id == connection.id, Account.source == AccountSource.PLAID)
            .order_by(Account.created_at, Account.id)
        )
    )


def refresh(account: Account, shared: SharedAccount, now: datetime) -> None:
    """Brings a linked account's balance and details up to date with what the bank shares."""
    account.balance = shared.balance
    account.available_balance = shared.available_balance
    account.credit_limit = shared.credit_limit
    account.currency = shared.currency
    account.mask = shared.mask
    account.official_name = shared.official_name
    account.subtype = shared.subtype
    account.balance_updated_at = now


def import_account(
    connection: Connection, shared: SharedAccount, name: str, now: datetime
) -> Account:
    """A new linked account that the connection keeps up to date."""
    account = Account(
        name=name,
        type=shared.type,
        institution=connection.institution_name[:80],
        source=AccountSource.PLAID,
        connection_id=connection.id,
        external_id=shared.id,
    )
    refresh(account, shared, now)
    return account


def unlink(account: Account) -> None:
    """Turns a linked account into one the household keeps up to date, keeping its history."""
    account.source = AccountSource.MANUAL
    account.connection_id = None
    account.external_id = None
    account.sync_cursor = None
    account.available_balance = None
