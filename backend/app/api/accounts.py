"""The household's accounts. Everyone can see them; only admins add, change or remove them."""

import uuid
from typing import Any

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.auth.deps import AdminAuth, ApiError, CurrentAuth, Db
from app.auth.service import load_preferences
from app.finance.accounts import account_out, get_account, transaction_counts
from app.models import Account, AccountSource
from app.models.base import utcnow
from app.schemas.accounts import AccountCreate, AccountOut, AccountUpdate

router = APIRouter(prefix="/accounts", tags=["accounts"])

# What Plaid keeps up to date on a linked account.
BANK_FIELDS = frozenset({"type", "institution", "mask", "currency", "balance", "credit_limit"})


@router.get("", response_model=list[AccountOut])
def list_accounts(auth: CurrentAuth, db: Db) -> list[AccountOut]:
    """Every account, open ones first, each with how many transactions it has."""
    accounts = db.scalars(
        select(Account).order_by(Account.closed_at.is_not(None), func.lower(Account.name))
    ).all()
    counts = transaction_counts(db)
    return [account_out(db, account, counts.get(account.id, 0)) for account in accounts]


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(body: AccountCreate, auth: AdminAuth, db: Db) -> AccountOut:
    """Adds an account the household keeps up to date itself."""
    account = Account(
        name=body.name,
        type=body.type,
        institution=body.institution,
        mask=body.mask,
        currency=body.currency or load_preferences(db).general.currency,
        balance=body.balance,
        credit_limit=body.credit_limit,
        balance_updated_at=utcnow(),
        notes=body.notes,
        source=AccountSource.MANUAL,
    )
    db.add(account)
    db.commit()
    return account_out(db, account, 0)


@router.get("/{account_id}", response_model=AccountOut)
def read_account(account_id: uuid.UUID, auth: CurrentAuth, db: Db) -> AccountOut:
    return account_out(db, get_account(db, account_id))


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: uuid.UUID, body: AccountUpdate, auth: AdminAuth, db: Db
) -> AccountOut:
    account = get_account(db, account_id, lock=True)
    now = utcnow()
    # Fields left out, or required ones sent as null, stay as they are.
    changes: dict[str, Any] = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None or field in {"institution", "mask", "credit_limit", "notes"}
    }
    closed = changes.pop("closed", None)
    changes = {field: value for field, value in changes.items() if getattr(account, field) != value}
    if account.is_linked and BANK_FIELDS & changes.keys():
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "linked_account",
            "Plaid keeps this account's balance and details up to date, so only its name and "
            "notes can change.",
        )
    for field, value in changes.items():
        setattr(account, field, value)
    if "balance" in changes:
        account.balance_updated_at = now
    if closed is not None and closed != account.is_closed:
        account.closed_at = now if closed else None
    db.commit()
    return account_out(db, account)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Removes the account and every transaction in it."""
    db.delete(get_account(db, account_id, lock=True))
    db.commit()
