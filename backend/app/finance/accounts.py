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
    return {account_id: count for account_id, count in rows}


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
