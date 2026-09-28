"""Looking up accounts and keeping their balances in step with their transactions."""

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import ApiError
from app.models import Account, AccountSource, Transaction
from app.schemas.accounts import AccountOut


def get_account(db: Session, account_id: uuid.UUID, *, lock: bool = False) -> Account:
    """The account, locked against other changes until the commit when `lock` is set."""
    account = db.get(Account, account_id, with_for_update=lock)
    if account is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That account doesn't exist anymore."
        )
    return account


def writable_account(db: Session, account_id: uuid.UUID, *, lock: bool = True) -> Account:
    """An account people can add transactions to, by hand or from a file: one they keep
    themselves, and open. It's locked against other changes until the commit, unless it's
    only being looked at."""
    account = db.get(Account, account_id, with_for_update=lock)
    if account is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_account",
            "That account doesn't exist anymore. Choose another one.",
        )
    if account.is_linked:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "linked_account",
            f"Transactions in {account.name} come from the bank through Plaid.",
        )
    if account.is_closed:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "account_closed",
            f"{account.name} is closed. Reopen it to add transactions to it.",
        )
    return account


def move_balance(account: Account, change: Decimal, now: datetime) -> None:
    """Moves a manual account's balance by a transaction's change.

    The household keeps a manual account's balance, so it follows the transactions they add,
    change and remove. A bank reports a linked account's balance itself.
    """
    if account.source != AccountSource.MANUAL or change == 0:
        return
    account.balance += change
    account.balance_updated_at = now


def transaction_counts(db: Session) -> dict[uuid.UUID, int]:
    rows = db.execute(
        select(Transaction.account_id, func.count()).group_by(Transaction.account_id)
    ).all()
    return dict(rows)


def account_out(db: Session, account: Account, transaction_count: int | None = None) -> AccountOut:
    """The account as the API shows it. Pass the transaction count when it's already known."""
    if transaction_count is None:
        transaction_count = db.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.account_id == account.id)
        )
    return AccountOut.model_validate(account).model_copy(
        update={"transaction_count": transaction_count or 0}
    )
