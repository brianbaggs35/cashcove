"""The guardrails that keep account numbers, account names and bank names from an AI."""

import datetime as dt
import time

import pytest
from sqlalchemy.orm import Session

from app.ai.errors import BLOCKED, PrivacyError
from app.ai.privacy import ACCOUNT, Protected, Text
from app.models import (
    Budget,
    BudgetPeriod,
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    HistoryStatus,
)
from tests.finance import add_account, add_category, add_group, linked_account

HOUSEHOLD = Protected.of(
    [
        "Everyday checking",
        "Rainy day fund",
        "Harbor Credit Union",
        "Harbor",
        "Tartan Bank",
        "Tartan",
    ]
)


def scrub(text: str, kind: Text = Text.BANK) -> str:
    return HOUSEHOLD.scrub(text, kind)


# ---- Names -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Tartan Bank", ACCOUNT),
        ("PAYMENT TO TARTAN BANK CARD", f"PAYMENT TO {ACCOUNT} CARD"),
        ("Transfer from Everyday   Checking", f"Transfer from {ACCOUNT}"),
        ("harbor credit union dividend", f"{ACCOUNT} dividend"),
        ("Rainy day fund top-up", f"{ACCOUNT} top-up"),
        # Only whole words: Harbor Freight isn't the bank, but "Harbor" alone is a name.
        ("Tartans r us", "Tartans r us"),
        ("Whole Foods", "Whole Foods"),
    ],
)
def test_the_names_of_accounts_and_banks_are_taken_out(text: str, expected: str) -> None:
    assert scrub(text) == expected


def test_the_longest_name_goes_first_so_none_of_it_is_left() -> None:
    assert scrub("Harbor Credit Union") == ACCOUNT


def test_a_name_has_to_be_long_enough_not_to_match_inside_words() -> None:
    assert Protected.of(["TD", "Al"]).scrub("TD Bank at Alamo") == "TD Bank at Alamo"


def test_with_no_accounts_nothing_is_taken_out_by_name() -> None:
    assert Protected.of([]).scrub("Tartan Bank") == "Tartan Bank"


def test_a_name_that_is_also_a_label_is_not_account_information() -> None:
    protected = Protected.of(["Savings", "Everyday checking"], labels=["Savings"])
    assert protected.scrub("Savings club") == "Savings club"
    assert protected.scrub("Everyday checking") == ACCOUNT


def test_labels_are_not_scrubbed_by_account_name() -> None:
    assert scrub("Tartan Bank", Text.LABEL) == "Tartan Bank"


# ---- Numbers -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Payment to card 4410",
        "Payment ending in 4410",
        "Payment ending 4410",
        "ACCT 123456",
        "Transfer to xxxx4410",
        "Transfer to XX4410",
        "Transfer to •••• 4410",
        "Transfer to ****4410",
        "Transfer to ...4410",
        "Transfer to #4410",
        "Autopay no. 4410",
    ],
)
def test_masks_and_account_numbers_are_taken_out(text: str) -> None:
    result = scrub(text)

    assert "4410" not in result
    assert "123456" not in result


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Costco #12", "Costco #12"),
        ("Studio 54", "Studio 54"),
        ("7-Eleven", "7-Eleven"),
        ("Order 123", "Order 123"),
        ("Account fee", "Account fee"),
    ],
)
def test_short_numbers_in_a_payee_are_left_alone(text: str, expected: str) -> None:
    assert scrub(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("AMZN Mktp 1234", "AMZN Mktp #"),
        ("Ref 12345678901234", "Ref #"),
        ("Call 555 123 4567", "Call #"),
        ("Pay 1234-5678-9012-3456", "Pay #"),
        ("IRS TREAS 310", "IRS TREAS 310"),
        ("Fee 2026-10-05", "Fee 2026-10-05"),
    ],
)
def test_four_or_more_digits_in_a_banks_text_are_taken_out(text: str, expected: str) -> None:
    assert scrub(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("how much did I spend in 2025?", "how much did I spend in 2025?"),
        ("what is 12000 divided by 4", "what is 12000 divided by 4"),
        ("between 2026-09-01 and 2026-09-30", "between 2026-09-01 and 2026-09-30"),
        ("my account is 123456789012", "my account is #"),
        ("my card 1234 5678 9012 3456", f"my {ACCOUNT} #"),
        ("routing 021000021", "routing #"),
    ],
)
def test_a_question_keeps_years_and_amounts_but_not_long_numbers(text: str, expected: str) -> None:
    assert scrub(text, Text.ASKED) == expected


def test_a_mask_in_a_question_is_still_taken_out() -> None:
    assert "4410" not in scrub("what is in the account ending in 4410", Text.ASKED)


def test_the_spaces_and_dashes_after_a_number_are_kept() -> None:
    assert scrub("Ref 12345678 - paid", Text.ASKED) == "Ref # - paid"
    assert scrub("Ref 1234 - paid") == "Ref # - paid"


@pytest.mark.parametrize(
    "text",
    [
        "*" * 4000,
        "•" * 4000,
        "x" * 4000,
        "card" + " " * 4000,
        "a" * 4000,
        "a-" * 2000,
        " " * 4000,
        "1 " * 2000,
        "1-" * 2000,
        "a" * 4000 + "@",
        "a@" + "b" * 4000,
        "a@b." * 1000,
        "#" + " " * 4000,
    ],
)
def test_no_text_however_long_or_odd_makes_scrubbing_slow(text: str) -> None:
    started = time.perf_counter()
    HOUSEHOLD.scrub(text, Text.ASKED)
    HOUSEHOLD.scrub(text, Text.BANK)
    HOUSEHOLD.leaks(text)

    assert time.perf_counter() - started < 0.5


def test_a_date_isnt_mistaken_for_an_account_number() -> None:
    assert scrub("posted 2026-10-05", Text.ASKED) == "posted 2026-10-05"


# ---- Emails and keys -------------------------------------------------------------------------


def test_emails_are_taken_out() -> None:
    assert scrub("Zelle from alex.rivera+bank@example.com") == "Zelle from [hidden]"


@pytest.mark.parametrize(
    "secret",
    [
        "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv0123456789",
        "sk-proj-1234567890abcdefghijklmnop",
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    ],
)
def test_a_pasted_key_is_taken_out(secret: str) -> None:
    assert scrub(f"my key is {secret} ok", Text.ASKED) == "my key is [hidden] ok"


def test_a_long_word_with_no_digits_is_not_a_key() -> None:
    word = "Internationalization" * 2
    assert scrub(word) == word


def test_whitespace_is_tidied() -> None:
    assert scrub("  Whole   Foods \n Market ") == "Whole Foods Market"


# ---- The check ---------------------------------------------------------------------------------


def test_clean_text_passes_the_check() -> None:
    HOUSEHOLD.ensure_clean("2026-10-05 | Whole Foods | -84.12 USD | Groceries", "How am I doing?")


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("paid Tartan Bank", "an account or bank name"),
        ("from Everyday checking", "an account or bank name"),
        ("ending in 4410", "an account number"),
        ("number 12345678", "an account number"),
        ("write to alex@example.com", "an email address"),
        ("key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv0123", "something that looks like a key"),
    ],
)
def test_the_check_refuses_anything_that_looks_like_account_information(
    text: str, kind: str
) -> None:
    with pytest.raises(PrivacyError) as caught:
        HOUSEHOLD.ensure_clean("fine", text)

    assert kind in caught.value.kinds
    assert caught.value.code == BLOCKED
    # It says what it looked like, never the thing itself.
    assert text not in caught.value.message
    assert kind in caught.value.message


def test_the_check_says_each_kind_once() -> None:
    with pytest.raises(PrivacyError) as caught:
        HOUSEHOLD.ensure_clean("Tartan Bank", "Harbor Credit Union")

    assert caught.value.message.count("an account or bank name") == 1


def test_a_date_and_a_formatted_amount_pass_the_check() -> None:
    HOUSEHOLD.ensure_clean("2026-10-05 | Rent | -1,850.00 USD | 12,345,678.90")


# ---- Loading what to protect from the household's records -----------------------------------


def test_every_account_and_bank_in_cashcove_is_protected(session: Session) -> None:
    add_account(session, "Joint checking", institution="Harbor Credit Union", mask="4410")
    linked_account(
        session, "Rewards Visa", institution="Tartan Bank", official_name="Tartan Visa Signature"
    )
    session.add(
        Connection(
            provider=ConnectionProvider.PLAID,
            external_id="item-1",
            access_token="sealed",
            institution_name="First Gingham Credit Union",
            status=ConnectionStatus.HEALTHY,
            history=HistoryStatus.COMPLETE,
            # An account the bank shares that hasn't been imported.
            available_accounts=[
                {"name": "Plaid Saver", "official_name": "Plaid Gold Standard", "mask": "0000"},
                {"name": None, "official_name": 5},
            ],
        )
    )
    session.commit()

    protected = Protected.load(session)

    for secret in (
        "Joint checking",
        "Harbor Credit Union",
        "Harbor",
        "Rewards Visa",
        "Tartan Visa Signature",
        "Tartan",
        "First Gingham",
        "First Gingham Credit Union",
        "Plaid Saver",
        "Plaid Gold Standard",
    ):
        assert protected.scrub(f"paid {secret} today") == f"paid {ACCOUNT} today", secret
        assert protected.leaks(secret), secret
    assert protected.scrub("Whole Foods") == "Whole Foods"


def test_an_accounts_name_may_be_a_category_or_a_budget_label(session: Session) -> None:
    add_account(session, "Savings")
    add_account(session, "Groceries card")
    add_category(session, "Savings", add_group(session, "Goals"))
    session.add(
        Budget(name="Groceries card", period=BudgetPeriod.MONTHLY, starts_on=dt.date(2026, 1, 1))
    )
    session.commit()

    protected = Protected.load(session)

    # Savings is a category too, so the word is only a label. Nothing else is.
    assert protected.scrub("Savings club") == "Savings club"
    assert protected.scrub("Everyday checking") == "Everyday checking"
    assert not protected.leaks("Savings")
    assert protected.leaks("Groceries card") == []


def test_a_household_with_no_accounts_protects_no_names(session: Session) -> None:
    assert Protected.load(session).names is None
