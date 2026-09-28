"""Plaid's errors, account types and categories, and the sync schedule, one piece at a time."""

import base64
import datetime as dt
from decimal import Decimal
from typing import Any, cast

import pytest
from sqlalchemy.orm import Session

from app.finance.categories import SUGGESTED, add_suggested_categories
from app.models import (
    AccountType,
    Category,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    HistoryStatus,
    SyncTrigger,
)
from app.plaid.accounts import account_type, share
from app.plaid.categories import RULES, CategoryChooser, suggested_name
from app.plaid.client import PlaidAccount, PlaidError, PlaidTransaction
from app.plaid.connections import link_language, valid_logo
from app.plaid.errors import diagnose, plaid_failed
from app.plaid.schedule import IMPORT_INTERVAL, next_sync
from app.schemas.preferences import SyncPreferences
from tests.finance import add_account, add_transaction
from tests.plaid import LOGO


def plaid_error(code: str, error_type: str = "ITEM_ERROR") -> PlaidError:
    return PlaidError(error_type, code, "message")


# ---- Errors ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "status", "says"),
    [
        ("ITEM_LOGIN_REQUIRED", ConnectionStatus.LOGIN_REQUIRED, "sign in again"),
        ("INVALID_MFA", ConnectionStatus.LOGIN_REQUIRED, "sign in again"),
        ("ITEM_LOCKED", ConnectionStatus.LOGIN_REQUIRED, "locked"),
        ("PASSWORD_RESET_REQUIRED", ConnectionStatus.LOGIN_REQUIRED, "on its website"),
        ("NO_ACCOUNTS", ConnectionStatus.LOGIN_REQUIRED, "isn't sharing any accounts"),
        ("INVALID_API_KEYS", ConnectionStatus.ERROR, "keys"),
        ("ITEM_NOT_FOUND", ConnectionStatus.ERROR, "no longer knows"),
        ("PLAID_UNREACHABLE", ConnectionStatus.ERROR, "couldn't reach Plaid"),
    ],
)
def test_errors_say_what_the_connection_needs(
    code: str, status: ConnectionStatus, says: str
) -> None:
    problem = diagnose(plaid_error(code))

    assert problem.status == status
    assert says in problem.message


@pytest.mark.parametrize(
    ("error_type", "code"),
    [
        ("INSTITUTION_ERROR", "INSTITUTION_DOWN"),
        ("API_ERROR", "INTERNAL_SERVER_ERROR"),
        ("RATE_LIMIT_EXCEEDED", "TRANSACTIONS_LIMIT"),
        ("ITEM_ERROR", "PRODUCT_NOT_READY"),
    ],
)
def test_passing_problems_are_tried_again(error_type: str, code: str) -> None:
    problem = diagnose(plaid_error(code, error_type))

    assert problem.status == ConnectionStatus.ERROR
    assert "try again at the next sync" in problem.message


def test_other_errors_name_plaids_code() -> None:
    problem = diagnose(plaid_error("SOMETHING_NEW", "INVALID_REQUEST"))

    assert problem.status == ConnectionStatus.ERROR
    assert "SOMETHING_NEW" in problem.message


@pytest.mark.parametrize(
    ("error_type", "code", "says"),
    [
        ("INVALID_INPUT", "INVALID_API_KEYS", "turned down Cashcove's keys"),
        ("API_ERROR", "INTERNAL_SERVER_ERROR", "couldn't be reached just now"),
        ("INVALID_REQUEST", "INVALID_FIELD", "turned down the request (INVALID_FIELD)"),
    ],
)
def test_failed_requests_become_bad_gateway_errors(error_type: str, code: str, says: str) -> None:
    failure = plaid_failed(plaid_error(code, error_type))

    assert failure.status_code == 502
    detail = cast(dict[str, Any], failure.detail)
    assert detail["code"] == "plaid_error"
    assert detail["plaid_code"] == code
    assert says in detail["message"]


# ---- Accounts ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("plaid_type", "subtype", "expected"),
    [
        ("depository", "checking", AccountType.CHECKING),
        ("depository", "paypal", AccountType.CHECKING),
        ("depository", "savings", AccountType.SAVINGS),
        ("depository", "cd", AccountType.SAVINGS),
        ("credit", "credit card", AccountType.CREDIT_CARD),
        ("loan", "mortgage", AccountType.MORTGAGE),
        ("loan", "student", AccountType.LOAN),
        ("investment", "401k", AccountType.INVESTMENT),
        ("brokerage", None, AccountType.INVESTMENT),
        ("other", None, AccountType.OTHER),
    ],
)
def test_plaids_account_types_become_cashcoves(
    plaid_type: str, subtype: str | None, expected: AccountType
) -> None:
    assert account_type(plaid_type, subtype) == expected


def plaid_account(**fields: Any) -> PlaidAccount:
    balances = {"current": 410.0, "available": None, "limit": 2000.0, "iso_currency_code": "USD"}
    balances |= fields.pop("balances", {})
    return PlaidAccount.model_validate(
        {
            "account_id": "a1",
            "name": "Plaid Credit Card",
            "mask": "3333",
            "type": "credit",
            "subtype": "credit card",
            "balances": balances,
        }
        | fields
    )


def test_what_a_card_owes_is_a_negative_balance() -> None:
    shared = share(plaid_account(), "USD")

    assert shared.type == AccountType.CREDIT_CARD
    assert shared.balance == Decimal("-410.00")
    assert shared.credit_limit == Decimal("2000.00")
    assert shared.available_balance is None


def test_a_deposit_account_keeps_its_balance_and_skips_its_overdraft_limit() -> None:
    shared = share(
        plaid_account(
            type="depository",
            subtype="checking",
            balances={"current": 110.005, "available": 100, "limit": 500},
        ),
        "USD",
    )

    assert shared.balance == Decimal("110.01")
    assert shared.available_balance == Decimal("100.00")
    assert shared.credit_limit is None


def test_a_missing_current_balance_falls_back_to_the_available_one() -> None:
    shared = share(
        plaid_account(type="depository", balances={"current": None, "available": 55.5}), "USD"
    )

    assert shared.balance == Decimal("55.50")
    assert share(
        plaid_account(type="depository", balances={"current": None}), "USD"
    ).balance == Decimal("0.00")


def test_odd_masks_names_and_currencies_are_cleaned_up() -> None:
    shared = share(
        plaid_account(
            name="   ",
            mask="12-34",
            official_name="x" * 200,
            subtype="y" * 50,
            balances={"iso_currency_code": None},
        ),
        "CAD",
    )

    assert shared.name == "Account"
    assert shared.mask is None
    assert shared.official_name == "x" * 160
    assert shared.subtype == "y" * 40
    assert shared.currency == "CAD"
    assert share(plaid_account(mask="0012345678"), "USD").mask == "5678"
    assert share(plaid_account(mask=None), "USD").mask is None


# ---- Categories --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("detailed", "expected"),
    [
        ("INCOME_WAGES", "Paycheck"),
        ("INCOME_SALARY", "Paycheck"),
        ("INCOME_DIVIDENDS", "Interest & dividends"),
        ("INCOME_TAX_REFUND", "Other income"),
        ("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "Credit card payments"),
        ("LOAN_PAYMENTS_MORTGAGE_PAYMENT", "Rent & mortgage"),
        ("LOAN_PAYMENTS_CAR_PAYMENT", "Loan payments"),
        ("TRANSFER_OUT_WITHDRAWAL", "Cash & ATM"),
        ("TRANSFER_IN_ACCOUNT_TRANSFER", "Transfers"),
        ("BANK_FEES_ATM_FEES", "Bank fees"),
        ("FOOD_AND_DRINK_GROCERIES", "Groceries"),
        ("FOOD_AND_DRINK_COFFEE", "Coffee"),
        ("FOOD_AND_DRINK_FAST_FOOD", "Restaurants"),
        ("GENERAL_MERCHANDISE_ELECTRONICS", "Electronics"),
        ("GENERAL_MERCHANDISE_SUPERSTORES", "Shopping"),
        ("MEDICAL_PHARMACIES_AND_SUPPLEMENTS", "Pharmacy"),
        ("PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", "Fitness"),
        ("TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "Rideshare & taxis"),
        ("TRAVEL_FLIGHTS", "Travel"),
        ("RENT_AND_UTILITIES_INTERNET_AND_CABLE", "Phone & internet"),
        ("RENT_AND_UTILITIES_WATER", "Utilities"),
        ("OTHER_OTHER", None),
    ],
)
def test_plaids_categories_point_at_the_starting_ones(detailed: str, expected: str | None) -> None:
    assert suggested_name(detailed) == expected


def test_every_rule_points_at_a_starting_category() -> None:
    starting = {name for group in SUGGESTED for _, name in group.categories}

    assert {name for _, name in RULES} <= starting


def plaid_transaction(detailed: str | None, confidence: str = "HIGH") -> PlaidTransaction:
    category = (
        None
        if detailed is None
        else {"primary": "X", "detailed": detailed, "confidence_level": confidence}
    )
    return PlaidTransaction.model_validate(
        {
            "transaction_id": "t1",
            "account_id": "a1",
            "amount": 4.5,
            "date": "2026-09-20",
            "personal_finance_category": category,
        }
    )


def test_a_payee_categorized_before_keeps_its_category(session: Session) -> None:
    add_suggested_categories(session)
    session.commit()
    coffee = session.query(Category).filter_by(name="Coffee").one()
    restaurants = session.query(Category).filter_by(name="Restaurants").one()
    account = add_account(session)
    add_transaction(session, account, "-4.50", "Blue Bottle", category_id=restaurants.id)
    add_transaction(
        session,
        account,
        "-4.50",
        "Blue Bottle",
        category_id=coffee.id,
        date=dt.date(2026, 9, 21),
    )
    add_transaction(session, account, "-9.00", "Blue Bottle", date=dt.date(2026, 9, 22))

    chooser = CategoryChooser(session)

    assert (
        chooser.choose(plaid_transaction("FOOD_AND_DRINK_RESTAURANT"), "BLUE BOTTLE") == coffee.id
    )
    groceries = chooser.choose(plaid_transaction("FOOD_AND_DRINK_GROCERIES"), "Whole Foods")
    assert groceries == session.query(Category).filter_by(name="Groceries").one().id


def test_plaids_category_counts_only_when_plaid_is_sure_and_it_exists(session: Session) -> None:
    add_suggested_categories(session)
    session.commit()
    chooser = CategoryChooser(session)

    assert chooser.choose(plaid_transaction("FOOD_AND_DRINK_COFFEE", "LOW"), "Cafe") is None
    assert chooser.choose(plaid_transaction(None), "Cafe") is None
    assert chooser.choose(plaid_transaction("OTHER_OTHER"), "Cafe") is None
    session.delete(session.query(Category).filter_by(name="Coffee").one())
    session.commit()
    assert (
        CategoryChooser(session).choose(plaid_transaction("FOOD_AND_DRINK_COFFEE"), "Cafe") is None
    )


# ---- Link, logos and the schedule --------------------------------------------------------


@pytest.mark.parametrize(
    ("locale", "language"), [("en-US", "en"), ("fr-CA", "fr"), ("sv", "sv"), ("ja-JP", "en")]
)
def test_link_speaks_the_households_language_when_it_can(locale: str, language: str) -> None:
    assert link_language(locale) == language


def test_only_small_pngs_are_kept_as_logos() -> None:
    assert valid_logo(LOGO) == LOGO
    assert valid_logo(None) is None
    assert valid_logo("not base64!") is None
    assert valid_logo(base64.b64encode(b"GIF89a....").decode()) is None
    assert valid_logo("A" * 300_000) is None


NOW = dt.datetime(2026, 9, 27, 12, 0, tzinfo=dt.UTC)


def connection(**fields: Any) -> Connection:
    values: dict[str, Any] = {
        "provider": ConnectionProvider.PLAID,
        "status": ConnectionStatus.HEALTHY,
        "history": HistoryStatus.COMPLETE,
        "created_at": NOW - dt.timedelta(days=30),
        "last_attempt_at": NOW - dt.timedelta(hours=1),
    } | fields
    return Connection(**values)


def test_the_schedule_syncs_every_few_hours() -> None:
    upcoming = next_sync(
        connection(), SyncPreferences(interval_hours=4), has_accounts=True, now=NOW
    )

    assert upcoming == (NOW + dt.timedelta(hours=3), SyncTrigger.SCHEDULED)


def test_a_connection_never_synced_is_due_now() -> None:
    upcoming = next_sync(
        connection(last_attempt_at=None), SyncPreferences(), has_accounts=True, now=NOW
    )

    assert upcoming == (NOW, SyncTrigger.SCHEDULED)


def test_new_connections_are_checked_often_while_their_history_comes_in() -> None:
    new = connection(history=HistoryStatus.RECENT, created_at=NOW - dt.timedelta(hours=1))
    old = connection(history=HistoryStatus.RECENT)

    assert next_sync(new, SyncPreferences(auto_sync=False), has_accounts=True, now=NOW) == (
        NOW - dt.timedelta(hours=1) + IMPORT_INTERVAL,
        SyncTrigger.LINKED,
    )
    assert next_sync(old, SyncPreferences(), has_accounts=True, now=NOW) == (
        NOW + dt.timedelta(hours=5),
        SyncTrigger.SCHEDULED,
    )


def test_some_connections_wait_for_people() -> None:
    preferences = SyncPreferences()

    assert next_sync(connection(), preferences, has_accounts=False, now=NOW) is None
    assert (
        next_sync(
            connection(status=ConnectionStatus.LOGIN_REQUIRED),
            preferences,
            has_accounts=True,
            now=NOW,
        )
        is None
    )
    assert (
        next_sync(connection(), SyncPreferences(auto_sync=False), has_accounts=True, now=NOW)
        is None
    )
