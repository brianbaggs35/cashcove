"""Accounts, categories and transactions for the finance API's tests."""

import datetime as dt
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountSource,
    AccountType,
    Category,
    CategoryGroup,
    CategoryKind,
    Transaction,
    TransactionSource,
)
from app.models.base import utcnow

TODAY = dt.date(2026, 9, 20)


def add_account(
    session: Session,
    name: str = "Everyday checking",
    *,
    type: AccountType = AccountType.CHECKING,
    balance: str = "1000.00",
    source: AccountSource = AccountSource.MANUAL,
    **fields: Any,
) -> Account:
    account = Account(
        name=name,
        type=type,
        currency=fields.pop("currency", "USD"),
        balance=Decimal(balance),
        source=source,
        balance_updated_at=fields.pop("balance_updated_at", utcnow() - dt.timedelta(days=3)),
        **fields,
    )
    session.add(account)
    session.commit()
    return account


def linked_account(session: Session, name: str = "Rewards Visa", **fields: Any) -> Account:
    """An account Plaid keeps up to date."""
    return add_account(
        session,
        name,
        type=fields.pop("type", AccountType.CREDIT_CARD),
        balance=fields.pop("balance", "-612.40"),
        source=AccountSource.PLAID,
        external_id=fields.pop("external_id", f"plaid-{name}"),
        institution=fields.pop("institution", "Tartan Bank"),
        **fields,
    )


def add_group(
    session: Session, name: str = "Food & drink", kind: CategoryKind = CategoryKind.EXPENSE
) -> CategoryGroup:
    group = CategoryGroup(name=name, kind=kind)
    session.add(group)
    session.commit()
    return group


def add_category(
    session: Session, name: str, group: CategoryGroup | None = None, emoji: str = "🛒"
) -> Category:
    category = Category(group=group or add_group(session, f"{name} group"), name=name, emoji=emoji)
    session.add(category)
    session.commit()
    return category


def add_transaction(
    session: Session,
    account: Account,
    amount: str,
    payee: str = "Corner Market",
    *,
    date: dt.date = TODAY,
    source: TransactionSource = TransactionSource.MANUAL,
    **fields: Any,
) -> Transaction:
    transaction = Transaction(
        account_id=account.id,
        amount=Decimal(amount),
        payee=payee,
        date=date,
        source=source,
        **fields,
    )
    session.add(transaction)
    session.commit()
    return transaction
