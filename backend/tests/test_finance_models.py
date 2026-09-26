"""How accounts, categories and transactions are stored."""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountSource,
    AccountType,
    Category,
    CategoryGroup,
    Transaction,
    TransactionSource,
)
from app.models.base import Money
from tests.finance import add_account, add_category, add_group, add_transaction, linked_account


def reload[T](session: Session, model: type[T], id: uuid.UUID) -> T:
    session.expire_all()
    found = session.get(model, id)
    assert found is not None
    return found


def test_money_is_stored_as_whole_cents(session: Session) -> None:
    account = add_account(session, balance="-1234.56")

    raw: object = session.connection().exec_driver_sql("SELECT balance FROM accounts").scalar_one()

    assert raw == -123456
    assert reload(session, Account, account.id).balance == Decimal("-1234.56")


def test_money_comes_back_with_two_decimal_places(session: Session) -> None:
    account = add_account(session, balance="12")

    assert str(reload(session, Account, account.id).balance) == "12.00"


def test_money_sums_are_exact(session: Session) -> None:
    # Floating point would make this 0.30000000000000004.
    account = add_account(session)
    for amount in ("0.10", "0.20"):
        add_transaction(session, account, amount)

    total = session.scalar(select(func.sum(Transaction.amount)))

    assert total == Decimal("0.30")
    assert str(total) == "0.30"


def test_money_refuses_fractions_of_a_cent(session: Session) -> None:
    with pytest.raises(StatementError, match="more than two decimal places"):
        add_account(session, balance="1.005")
    session.rollback()


def test_money_reads_what_postgres_sums_and_leaves_nulls_alone(session: Session) -> None:
    money = Account.__table__.c.balance.type
    assert isinstance(money, Money)
    dialect = session.get_bind().dialect
    # Postgres sums whole numbers as numeric, which arrives as a Decimal.
    assert money.process_result_value(Decimal(1050), dialect) == Decimal("10.50")
    assert money.process_result_value(None, dialect) is None
    assert money.process_bind_param(None, dialect) is None


def test_accounts_know_what_they_are(session: Session) -> None:
    checking = add_account(session)
    card = linked_account(session)

    assert (checking.is_liability, checking.is_linked, checking.is_closed) == (False, False, False)
    assert (card.is_liability, card.is_linked) == (True, True)
    assert card.source == AccountSource.PLAID
    for kind in (AccountType.LOAN, AccountType.MORTGAGE):
        assert Account(type=kind).is_liability


def test_transactions_synced_by_plaid_come_from_the_bank(session: Session) -> None:
    account = linked_account(session)

    synced = add_transaction(session, account, "-5.00", source=TransactionSource.PLAID)
    imported = add_transaction(session, account, "-5.00", source=TransactionSource.FILE)

    assert synced.from_bank
    assert not imported.from_bank


def test_deleting_an_account_deletes_its_transactions(session: Session) -> None:
    account = add_account(session)
    add_transaction(session, account, "-5.00")

    session.delete(account)
    session.commit()

    assert session.scalar(select(func.count()).select_from(Transaction)) == 0


def test_deleting_a_group_deletes_its_categories_and_uncategorizes(session: Session) -> None:
    group = add_group(session)
    groceries = add_category(session, "Groceries", group)
    account = add_account(session)
    transaction = add_transaction(session, account, "-5.00", category_id=groceries.id)

    session.delete(reload(session, CategoryGroup, group.id))
    session.commit()

    assert session.scalar(select(func.count()).select_from(Category)) == 0
    assert reload(session, Transaction, transaction.id).category_id is None


def test_a_bank_transaction_is_only_stored_once_per_account(session: Session) -> None:
    account = linked_account(session)
    add_transaction(session, account, "-5.00", external_id="txn-1")
    other = linked_account(session, "Everyday checking", type=AccountType.CHECKING)
    # The same ID in another account is a different transaction.
    add_transaction(session, other, "-5.00", external_id="txn-1")

    with pytest.raises(IntegrityError):
        add_transaction(session, account, "-5.00", external_id="txn-1")
    session.rollback()
