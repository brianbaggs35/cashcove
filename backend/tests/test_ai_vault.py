"""Codes that stand for accounts, banks and people for one request, and what is never given one."""

import itertools
import re
import secrets
import uuid

import pytest
from sqlalchemy.orm import Session

from app.ai.privacy import ACCOUNT, ADDRESS, HIDDEN, Protected, Text
from app.ai.vault import LENGTH, Entity, Subject, Vault
from app.config import Settings
from app.models import Connection, ConnectionProvider, ConnectionStatus, HistoryStatus
from tests.ai import household
from tests.finance import add_account
from tests.helpers import add_user

CODE = re.compile(r"^<(ACCOUNT|BANK|PERSON)_([bcdfghjkmnpqrstvwxz]{10})>$")
ANY_CODE = re.compile(r"<(?:ACCOUNT|BANK|PERSON)_[a-z]{10}>")

CHECKING = Entity(Subject.ACCOUNT, "Everyday checking", uuid.uuid4())
VISA = Entity(Subject.ACCOUNT, "Rewards Visa", uuid.uuid4())
TARTAN = Entity(Subject.BANK, "Tartan Bank")
ALEX = Entity(Subject.PERSON, "Alex Rivera")

HOUSEHOLD = Protected.of(
    ["Everyday checking", "Rewards Visa", "Tartan Bank", "Tartan"], people=["Alex Rivera"]
)


# ---- The codes -------------------------------------------------------------------------------


def test_a_code_is_its_kind_and_ten_consonants() -> None:
    vault = Vault()

    for entity in (CHECKING, TARTAN, ALEX):
        match = CODE.match(vault.code_for(entity))
        assert match is not None
        assert match.group(1) == entity.subject
        assert len(match.group(2)) == LENGTH


def test_a_thing_has_the_same_code_every_time_and_two_things_never_do() -> None:
    vault = Vault()

    assert vault.code_for(CHECKING) == vault.code_for(CHECKING)
    assert len({vault.code_for(entity) for entity in (CHECKING, VISA, TARTAN, ALEX)}) == 4


def test_an_account_has_one_code_whatever_it_is_called() -> None:
    vault = Vault()
    renamed = Entity(Subject.ACCOUNT, "The Visa", CHECKING.account_id)

    assert vault.code_for(CHECKING) == vault.code_for(renamed)


def test_the_same_name_as_a_bank_and_as_a_person_are_different_things() -> None:
    vault = Vault()

    assert vault.code_for(Entity(Subject.BANK, "Harbor")) != vault.code_for(
        Entity(Subject.PERSON, "Harbor")
    )


def test_a_code_is_new_for_every_request() -> None:
    assert Vault().code_for(CHECKING) != Vault().code_for(CHECKING)


def test_a_code_never_has_a_digit_so_no_check_takes_it_for_a_number() -> None:
    vault = Vault()
    codes = [vault.code_for(Entity(Subject.PERSON, f"Person {number}")) for number in range(200)]

    assert not any(character.isdigit() for code in codes for character in code)
    HOUSEHOLD.ensure_clean(*codes)


def test_a_code_that_is_already_taken_is_never_made_again(monkeypatch: pytest.MonkeyPatch) -> None:
    letters = itertools.chain("b" * 20, itertools.repeat("c"))

    def choose(_: str) -> str:
        return next(letters)

    monkeypatch.setattr(secrets, "choice", choose)
    vault = Vault()

    first, second = vault.code_for(CHECKING), vault.code_for(VISA)

    assert first == f"<ACCOUNT_{'b' * 10}>"
    assert second == f"<ACCOUNT_{'b' * 10}>".replace("b", "c")


# ---- Reading a code ----------------------------------------------------------------------------


def test_a_code_is_read_however_the_ai_wrote_it() -> None:
    vault = Vault()
    code = vault.code_for(CHECKING)
    body = code[len("<ACCOUNT_") : -1]

    assert vault.entity_of(code) == CHECKING
    assert vault.entity_of(code.upper()) == CHECKING
    assert vault.entity_of(f"  < ACCOUNT_{body} >  ") == CHECKING
    assert vault.entity_of(f"ACCOUNT_{body}") == CHECKING


@pytest.mark.parametrize(
    "text",
    [
        "<ACCOUNT_bcdfghjkmn>",
        "<BANK_" + "b" * 10 + ">",
        "Everyday checking",
        "",
        "<ACCOUNT_short>",
    ],
)
def test_what_is_not_a_code_of_this_request_stands_for_nothing(text: str) -> None:
    vault = Vault()
    vault.code_for(CHECKING)

    assert vault.entity_of(text) is None


def test_a_code_of_one_kind_isnt_another_kind() -> None:
    vault = Vault()
    body = vault.code_for(CHECKING)[len("<ACCOUNT_") : -1]

    assert vault.entity_of(f"<BANK_{body}>") is None


# ---- Putting names back ------------------------------------------------------------------------


def test_every_code_of_the_request_is_put_back_as_what_it_stands_for() -> None:
    vault = Vault()
    said = (
        f"Paid {vault.code_for(TARTAN)} from {vault.code_for(CHECKING)} to {vault.code_for(ALEX)}"
    )

    assert vault.restore(said) == "Paid Tartan Bank from Everyday checking to Alex Rivera"


def test_a_code_without_its_brackets_is_put_back_only_if_it_is_one_of_this_requests() -> None:
    vault = Vault()
    body = vault.code_for(VISA)[len("<ACCOUNT_") : -1]
    stranger = "ACCOUNT_" + "b" * 10

    assert vault.restore(f"ACCOUNT_{body} and {stranger}") == f"Rewards Visa and {stranger}"
    # Not when it is only part of something else.
    assert vault.restore(f"my_ACCOUNT_{body}x") == f"my_ACCOUNT_{body}x"


@pytest.mark.parametrize(
    ("subject", "plain"),
    [
        (Subject.ACCOUNT, "an account"),
        (Subject.BANK, "a bank"),
        (Subject.PERSON, "someone"),
    ],
)
def test_a_code_from_nowhere_is_a_plain_word_not_a_name(subject: Subject, plain: str) -> None:
    vault = Vault()
    vault.code_for(CHECKING)

    assert vault.restore(f"to <{subject}_{'k' * 10}> today") == f"to {plain} today"
    # A real code of another kind is just as much from nowhere.
    body = vault.code_for(CHECKING)[len("<ACCOUNT_") : -1]
    assert vault.restore(f"<BANK_{body}>") == "a bank"


def test_codes_from_outside_are_taken_out_so_none_can_pass_for_one_of_ours() -> None:
    vault = Vault()
    ours = vault.code_for(CHECKING)

    assert vault.neutralize(f"NETFLIX {ours} <person_{'k' * 10}>", "[x]") == "NETFLIX [x] [x]"
    assert vault.neutralize("Whole Foods <3", "[x]") == "Whole Foods <3"


def test_text_can_be_held_apart_from_its_codes_and_given_them_back() -> None:
    vault = Vault()
    line = f"{vault.code_for(CHECKING)}, 12345678 and {vault.code_for(ALEX)}!"

    held_text, held = vault.hold(line)

    assert "<" not in held_text
    assert held == ["Everyday checking", "Alex Rivera"]
    assert vault.release(held_text, held) == "Everyday checking, 12345678 and Alex Rivera!"


def test_control_characters_are_removed_but_not_tabs_or_lines() -> None:
    assert Vault.plain("a\x01b\x02c\x00d\te\nf\r") == "abcd\te\nf\r"


# ---- Scrubbing with codes ----------------------------------------------------------------------


def test_names_become_codes_that_stand_for_them() -> None:
    vault = Vault()

    text = HOUSEHOLD.scrub(
        "PAYMENT TO TARTAN BANK FROM EVERYDAY CHECKING BY ALEX RIVERA", vault=vault
    )

    assert not HOUSEHOLD.leaks(text)
    assert len(ANY_CODE.findall(text)) == 3
    assert vault.restore(text).lower() == (
        "payment to tartan bank from everyday checking by alex rivera"
    )


def test_one_thing_is_one_code_across_rows_and_a_conversation() -> None:
    vault = Vault()

    first = HOUSEHOLD.scrub("Transfer from Everyday checking", vault=vault)
    second = HOUSEHOLD.scrub("what is in everyday  CHECKING?", Text.ASKED, vault=vault)

    assert ANY_CODE.findall(first) == ANY_CODE.findall(second)
    assert len(ANY_CODE.findall(first)) == 1


def test_without_a_vault_a_name_is_still_a_word_that_does_not_say_which() -> None:
    assert HOUSEHOLD.scrub("Payment to Tartan Bank") == f"Payment to {ACCOUNT}"


def test_a_code_in_a_payee_cant_be_a_code_of_ours() -> None:
    vault = Vault()
    ours = vault.code_for(CHECKING)

    text = HOUSEHOLD.scrub(f"NETFLIX {ours} <ACCOUNT_{'k' * 10}>", vault=vault)

    assert text == f"NETFLIX {HIDDEN} {HIDDEN}"


def test_labels_are_not_given_codes() -> None:
    vault = Vault()

    assert HOUSEHOLD.scrub("Tartan Bank", Text.LABEL, vault=vault) == "Tartan Bank"
    assert not ANY_CODE.search(HOUSEHOLD.scrub("Tartan Bank", Text.LABEL, vault=vault))


def test_who_a_payment_went_to_gets_a_code_too_that_puts_their_name_back() -> None:
    vault = Vault()

    text = HOUSEHOLD.scrub("ZELLE PAYMENT TO JOHN SMITH, VENMO FROM JOHN SMITH", vault=vault)

    codes = ANY_CODE.findall(text)
    assert len(codes) == 2
    assert codes[0] == codes[1]
    assert "JOHN" not in text
    assert vault.restore(text) == "ZELLE PAYMENT TO JOHN SMITH, VENMO FROM JOHN SMITH"


@pytest.mark.parametrize(
    ("text", "taken_out"),
    [
        ("Zelle from alex.rivera+bank@example.com", "alex.rivera+bank@example.com"),
        ("Call (415) 555-1234 now", "415"),
        ("SSN 123-45-6789 on file", "123-45-6789"),
        ("Visit 4500 Oak Ave today", "Oak Ave"),
        ("Ref 12345678901234", "12345678901234"),
        ("Payment ending in 4410", "4410"),
        ("my key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv0123456789", "AbCdEf"),
    ],
)
def test_numbers_emails_phones_ids_addresses_and_keys_never_get_a_code(
    text: str, taken_out: str
) -> None:
    vault = Vault()

    scrubbed = HOUSEHOLD.scrub(text, Text.ASKED, vault=vault)

    assert taken_out not in scrubbed
    # Nothing stands for what was taken out, so nothing can bring it back.
    assert not ANY_CODE.search(scrubbed)
    assert vault.restore(scrubbed) == scrubbed


# ---- What an AI writes -------------------------------------------------------------------------


def test_the_codes_in_an_answer_are_put_back_and_its_lines_are_kept() -> None:
    vault = Vault()
    account, person = vault.code_for(CHECKING), vault.code_for(ALEX)
    said = f"You paid from {account}:\n- {person} got $50.00\n- rent was $1,850.00 on 2026-10-01"

    assert HOUSEHOLD.reveal(said, vault) == (
        "You paid from Everyday checking:\n- Alex Rivera got $50.00\n"
        "- rent was $1,850.00 on 2026-10-01"
    )


def test_what_surrounds_a_code_is_left_as_it_was() -> None:
    vault = Vault()
    code = vault.code_for(VISA)

    assert HOUSEHOLD.reveal(f"({code}) has {code}.", vault) == "(Rewards Visa) has Rewards Visa."


def test_a_code_the_ai_made_up_is_not_a_name() -> None:
    vault = Vault()

    revealed = HOUSEHOLD.reveal(f"Sent to <PERSON_{'k' * 10}> and <BANK_{'m' * 10}>", vault)

    assert revealed == "Sent to someone and a bank"


def test_account_information_the_ai_writes_on_its_own_is_taken_out_of_its_answer() -> None:
    vault = Vault()

    revealed = HOUSEHOLD.reveal(
        "Your card ending in 9012, account 123456789012, or a@b.co at 4500 Oak Ave", vault
    )

    for gone in ("9012", "123456789012", "a@b.co", "Oak Ave"):
        assert gone not in revealed
    assert ACCOUNT in revealed
    assert HIDDEN in revealed
    assert ADDRESS in revealed


def test_a_name_the_ai_writes_out_whole_is_still_shown_as_it_is() -> None:
    vault = Vault()

    assert HOUSEHOLD.reveal("Check Tartan Bank for Everyday checking", vault) == (
        "Check Tartan Bank for Everyday checking"
    )


def test_control_characters_in_an_answer_cant_stand_in_for_a_code() -> None:
    vault = Vault()
    vault.code_for(CHECKING)

    assert HOUSEHOLD.reveal("pay\x01 0\x02 now", vault) == "pay 0 now"


# ---- Loading the household -------------------------------------------------------------------


def test_an_account_has_one_code_by_its_name_its_official_name_or_its_last_digits(
    session: Session,
) -> None:
    made = household(session)
    protected = Protected.load(session)
    vault = Vault()

    texts = [
        "Everyday checking",
        "Tartan Rewards Visa Signature",
        "4410",
        "ending in 4410",
    ]
    codes = [ANY_CODE.findall(protected.scrub(text, Text.ASKED, vault=vault)) for text in texts]

    assert codes[0] == codes[2] == codes[3]
    assert codes[0] != codes[1]
    assert vault.entity_of(codes[0][0]) == Entity(
        Subject.ACCOUNT, "Everyday checking", made.checking.id
    )
    assert vault.entity_of(codes[1][0]) == Entity(Subject.ACCOUNT, "Rewards Visa", made.card.id)


def test_a_bank_has_a_code_by_any_way_it_is_named_and_is_not_an_account(session: Session) -> None:
    household(session)
    protected = Protected.load(session)
    vault = Vault()

    codes = {
        text: ANY_CODE.findall(protected.scrub(text, vault=vault))
        for text in ("Tartan Bank", "TARTAN", "Harbor Credit Union", "Harbor")
    }

    assert codes["Tartan Bank"] == codes["TARTAN"]
    assert codes["Harbor Credit Union"] == codes["Harbor"]
    assert codes["Tartan Bank"] != codes["Harbor"]
    assert vault.entity_of(codes["Tartan Bank"][0]) == Entity(Subject.BANK, "Tartan Bank")


def test_the_people_of_the_household_have_codes_that_show_their_names(
    session: Session, settings: Settings
) -> None:
    add_user(session, settings, email="alex@example.com", name="Alex Rivera")
    protected = Protected.load(session)
    vault = Vault()

    text = protected.scrub("Zelle Alex Rivera rent", vault=vault)

    [code] = ANY_CODE.findall(text)
    assert vault.entity_of(code) == Entity(Subject.PERSON, "Alex Rivera")


def test_accounts_a_bank_shares_that_are_not_imported_have_codes_too(session: Session) -> None:
    session.add(
        Connection(
            provider=ConnectionProvider.PLAID,
            external_id="item-1",
            access_token="sealed",
            institution_name="First Gingham Credit Union",
            status=ConnectionStatus.HEALTHY,
            history=HistoryStatus.COMPLETE,
            available_accounts=[
                {"name": "Plaid Saver", "official_name": "Plaid Gold Standard", "mask": "0000"},
                # Only its last digits are known.
                {"name": None, "mask": "7788"},
            ],
        )
    )
    session.commit()
    protected = Protected.load(session)
    vault = Vault()

    [saver] = ANY_CODE.findall(protected.scrub("Plaid Saver", vault=vault))
    [gold] = ANY_CODE.findall(protected.scrub("plaid gold standard", vault=vault))
    [unnamed] = ANY_CODE.findall(protected.scrub("ending 7788 today", vault=vault))

    assert saver == gold
    assert vault.restore(saver) == "Plaid Saver"
    assert vault.restore(unnamed) == "an account"
    assert (
        vault.restore(ANY_CODE.findall(protected.scrub("First Gingham", vault=vault))[0])
        == "First Gingham Credit Union"
    )


def test_two_accounts_with_the_same_name_are_hidden_as_an_account_no_one_in_particular(
    session: Session,
) -> None:
    add_account(session, "Joint", institution="Harbor Credit Union", mask="1111")
    add_account(session, "Joint", institution="Tartan Bank", mask="2222")
    protected = Protected.load(session)
    vault = Vault()

    [code] = ANY_CODE.findall(protected.scrub("from Joint", vault=vault))

    entity = vault.entity_of(code)
    assert entity == Entity(Subject.ACCOUNT, "Joint")
    assert entity is not None
    assert entity.account_id is None
    # Their last digits are still theirs.
    assert vault.entity_of(ANY_CODE.findall(protected.scrub("1111", vault=vault))[0]) != entity


def test_an_accounts_name_that_is_also_its_official_name_is_one_thing(session: Session) -> None:
    add_account(session, "Gold Card", official_name="GOLD CARD")
    protected = Protected.load(session)
    vault = Vault()

    [code] = ANY_CODE.findall(protected.scrub("Gold card", vault=vault))

    entity = vault.entity_of(code)
    assert entity is not None
    assert entity.account_id is not None


def test_a_bank_called_the_same_as_an_account_is_the_account(session: Session) -> None:
    account = add_account(session, "Tartan", institution="Tartan Bank")
    protected = Protected.load(session)
    vault = Vault()

    [code] = ANY_CODE.findall(protected.scrub("Tartan", vault=vault))

    assert vault.entity_of(code) == Entity(Subject.ACCOUNT, "Tartan", account.id)


def test_two_banks_with_the_same_short_name_keep_the_first(session: Session) -> None:
    add_account(session, "One", institution="Harbor Bank")
    add_account(session, "Two", institution="Harbor Credit Union")
    protected = Protected.load(session)
    vault = Vault()

    [code] = ANY_CODE.findall(protected.scrub("Harbor", vault=vault))

    entity = vault.entity_of(code)
    assert entity is not None
    assert entity.subject == Subject.BANK
    assert not protected.leaks("nothing here")


def test_names_without_a_stored_entity_still_get_a_code() -> None:
    # A name found by the pattern that was compared differently from how it was stored.
    protected = Protected(HOUSEHOLD.names, None, {})
    vault = Vault()

    [code] = ANY_CODE.findall(protected.scrub("Everyday checking", vault=vault))

    assert vault.restore(code) == "Everyday checking"
