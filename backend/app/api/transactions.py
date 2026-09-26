"""Transactions. Everyone can see and search them; only admins add, change or remove them."""

import uuid
from collections import defaultdict
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import case, delete, desc, func, select, update
from sqlalchemy.orm import Session

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.finance.accounts import get_account, move_balance
from app.finance.categories import find_category
from app.finance.transactions import SORT_ORDERS, conditions, like_pattern
from app.models import Account, Transaction, TransactionSource
from app.models.base import utcnow
from app.schemas.transactions import (
    BulkCategorize,
    BulkResult,
    PayeeSuggestion,
    TransactionCreate,
    TransactionIds,
    TransactionOut,
    TransactionPage,
    TransactionQuery,
    TransactionTotals,
    TransactionUpdate,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _transaction(db: Session, transaction_id: uuid.UUID, *, lock: bool = False) -> Transaction:
    transaction = db.get(Transaction, transaction_id, with_for_update=lock)
    if transaction is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That transaction doesn't exist anymore."
        )
    return transaction


def _writable_account(db: Session, account_id: uuid.UUID) -> Account:
    """An account people can add transactions to: one they keep themselves, and open."""
    account = db.get(Account, account_id, with_for_update=True)
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


@router.get("", response_model=TransactionPage)
def list_transactions(
    query: Annotated[TransactionQuery, Query()], auth: CurrentAuth, db: Db
) -> TransactionPage:
    """A page of the transactions that match, and what all of them add up to."""
    where = conditions(query)
    money_in = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0))
    money_out = func.sum(case((Transaction.amount < 0, Transaction.amount), else_=0))
    totals = [
        TransactionTotals(currency=currency, count=count, money_in=into, money_out=out)
        for currency, count, into, out in db.execute(
            select(Account.currency, func.count(), money_in, money_out)
            .select_from(Transaction)
            .join(Account, Account.id == Transaction.account_id)
            .where(*where)
            .group_by(Account.currency)
            .order_by(Account.currency)
        )
    ]
    items = db.scalars(
        select(Transaction)
        .where(*where)
        .order_by(*SORT_ORDERS[query.sort])
        .offset((query.page - 1) * query.page_size)
        .limit(query.page_size)
    ).all()
    return TransactionPage(
        items=[TransactionOut.model_validate(item) for item in items],
        total=sum(total.count for total in totals),
        page=query.page,
        page_size=query.page_size,
        totals=totals,
    )


@router.get("/payees", response_model=list[PayeeSuggestion])
def suggest_payees(
    auth: CurrentAuth,
    db: Db,
    q: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=20)] = 8,
) -> list[PayeeSuggestion]:
    """Payees used before, most used first, with the category each last had."""
    text = q.strip()
    uses = func.count()
    statement = select(Transaction.payee, uses).group_by(Transaction.payee)
    if text:
        starts = Transaction.payee.ilike(like_pattern(text, prefix_only=True), escape="\\")
        statement = statement.where(
            Transaction.payee.ilike(like_pattern(text), escape="\\")
        ).order_by(
            # Names that start with what was typed come first.
            case((starts, 0), else_=1)
        )
    rows = db.execute(
        statement.order_by(desc(uses), desc(func.max(Transaction.date)), Transaction.payee).limit(
            limit
        )
    ).all()
    latest: dict[str, uuid.UUID | None] = {}
    for payee, category_id in db.execute(
        select(Transaction.payee, Transaction.category_id)
        .where(Transaction.payee.in_([payee for payee, _ in rows]))
        .order_by(*SORT_ORDERS["-date"])
    ):
        latest.setdefault(payee, category_id)
    return [
        PayeeSuggestion(payee=payee, category_id=latest[payee], count=count)
        for payee, count in rows
    ]


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(body: TransactionCreate, auth: AdminAuth, db: Db) -> TransactionOut:
    """Adds a transaction by hand. A manual account's balance moves with it."""
    account = _writable_account(db, body.account_id)
    find_category(db, body.category_id)
    transaction = Transaction(
        account_id=account.id,
        date=body.date,
        amount=body.amount,
        payee=body.payee,
        category_id=body.category_id,
        notes=body.notes,
        source=TransactionSource.MANUAL,
    )
    db.add(transaction)
    move_balance(account, body.amount, utcnow())
    db.commit()
    return TransactionOut.model_validate(transaction)


@router.get("/{transaction_id}", response_model=TransactionOut)
def read_transaction(transaction_id: uuid.UUID, auth: CurrentAuth, db: Db) -> TransactionOut:
    return TransactionOut.model_validate(_transaction(db, transaction_id))


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: uuid.UUID, body: TransactionUpdate, auth: AdminAuth, db: Db
) -> TransactionOut:
    transaction = _transaction(db, transaction_id, lock=True)
    now = utcnow()
    fields = body.model_fields_set
    account_id = body.account_id or transaction.account_id
    amount = transaction.amount if body.amount is None else body.amount
    moved = account_id != transaction.account_id
    if transaction.from_bank and (
        moved or amount != transaction.amount or (body.date or transaction.date) != transaction.date
    ):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "from_bank",
            "Plaid keeps this transaction's account, date and amount up to date, so only its "
            "payee, category and notes can change.",
        )
    if "category_id" in fields:
        find_category(db, body.category_id)
        transaction.category_id = body.category_id
    if moved:
        move_balance(_writable_account(db, account_id), amount, now)
        move_balance(get_account(db, transaction.account_id, lock=True), -transaction.amount, now)
        transaction.account_id = account_id
    elif amount != transaction.amount:
        move_balance(
            get_account(db, transaction.account_id, lock=True), amount - transaction.amount, now
        )
    transaction.amount = amount
    if body.date is not None:
        transaction.date = body.date
    if body.payee is not None:
        transaction.payee = body.payee
    if "notes" in fields:
        transaction.notes = body.notes
    db.commit()
    return TransactionOut.model_validate(transaction)


def _remove(db: Session, transactions: list[Transaction]) -> int:
    """Deletes transactions, taking each one's amount back out of a manual account's balance."""
    changes: defaultdict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for transaction in transactions:
        changes[transaction.account_id] -= transaction.amount
    now = utcnow()
    # Locked in the same order every time, so two requests can't each wait on the other.
    for account_id in sorted(changes):
        move_balance(get_account(db, account_id, lock=True), changes[account_id], now)
    db.execute(delete(Transaction).where(Transaction.id.in_([item.id for item in transactions])))
    return len(transactions)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    _remove(db, [_transaction(db, transaction_id, lock=True)])
    db.commit()


@router.post("/bulk/delete", response_model=BulkResult)
def delete_transactions(body: TransactionIds, auth: AdminAuth, db: Db) -> BulkResult:
    """Deletes several transactions at once. Ones already gone are skipped."""
    transactions = list(
        db.scalars(select(Transaction).where(Transaction.id.in_(body.ids)).with_for_update())
    )
    count = _remove(db, transactions)
    db.commit()
    return BulkResult(count=count)


@router.post("/bulk/categorize", response_model=BulkResult)
def categorize_transactions(body: BulkCategorize, auth: AdminAuth, db: Db) -> BulkResult:
    """Gives several transactions the same category, or takes theirs away."""
    find_category(db, body.category_id)
    updated = db.scalars(
        update(Transaction)
        .where(Transaction.id.in_(body.ids))
        .values(category_id=body.category_id)
        .returning(Transaction.id)
    ).all()
    db.commit()
    return BulkResult(count=len(updated))
