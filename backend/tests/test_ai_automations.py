"""Suggesting automations from the categories someone chose by hand: which payees are looked at,
how the AI's wording is tried on the household's transactions, and what is never sent."""

import datetime as dt
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import automations, errors
from app.ai.automations import root_of
from app.models import (
    AIUsage,
    Automation,
    AutomationDirection,
    AutomationMatch,
    AutomationScope,
    Category,
    Transaction,
)
from e2e.ai import FakeAI
from tests.ai import SECRETS, Household, configure, household
from tests.finance import TODAY
from tests.helpers import error

SUGGEST = "/api/ai/automation-suggestions"


def suggest(client: TestClient) -> Any:
    return client.post(SUGGEST)


def suggestions(client: TestClient) -> dict[str, Any]:
    response = suggest(client)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def chosen(
    home: Household,
    payee: str,
    category: Category,
    times: int = 1,
    amount: str = "-10.00",
    **fields: Any,
) -> list[Transaction]:
    """Transactions someone put in a category by hand, a day apart, the newest first."""
    return [
        home.transaction(
            payee.format(n=number),
            amount,
            category,
            category_chosen=True,
            date=fields.pop("date", TODAY) - dt.timedelta(days=number),
            **fields,
        )
        for number in range(1, times + 1)
    ]


def whole_foods(home: Household, times: int = 4) -> list[Transaction]:
    """What a grocery store writes after its name is a different number each time."""
    return chosen(home, "WHOLEFDS MKT #1023{n} AUSTIN TX", home.groceries, times)


# ---- Which payees are looked at --------------------------------------------------------------


@pytest.mark.parametrize(
    ("payee", "root"),
    [
        ("AMZN Mktp US*2K4TT3Y81", "amzn mktp"),
        ("STARBUCKS STORE 1234", "starbucks store"),
        ("Whole Foods Market #10234", "whole foods market"),
        ("  Shell   Oil  ", "shell oil"),
        ("NETFLIX.COM", "netflix.com"),
        ("7-ELEVEN 12345", ""),
        ("", ""),
    ],
)
def test_a_payee_is_known_by_its_name_before_any_number(payee: str, root: str) -> None:
    assert root_of(payee) == root


def test_nothing_is_asked_when_no_payee_has_had_a_category_chosen_often_enough(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home, 2)
    # A payee with no name before its number has nothing to look for.
    chosen(home, "7-ELEVEN {n}", home.coffee, 4)
    # Chosen for by the AI's second opinion or a bank, not by a person.
    home.transaction("Shell Oil 1", "-30.00", home.coffee)
    home.transaction("Shell Oil 2", "-30.00", home.coffee)
    home.transaction("Shell Oil 3", "-30.00", home.coffee)

    result = suggestions(admin_client)

    assert result == {"suggestions": [], "considered": 0}
    assert fake_ai.requests == []
    assert not session.scalars(select(AIUsage)).all()


def test_a_payee_written_the_same_way_every_time_is_looked_for_as_it_is(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)
    chosen(home, "Netflix.com", home.subscriptions, 3, amount="-15.49")

    (found,) = suggestions(admin_client)["suggestions"]

    assert (found["payees"], found["choices"], found["sorts_now"]) == (["Netflix.com"], 3, 0)


def test_a_payee_that_is_all_hidden_from_the_ai_has_no_wording_to_offer(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)
    # Its name is a bank's, which is taken out, so nothing is left to look for.
    chosen(home, "Tartan Bank #{n}", home.card_payments, 3)

    assert suggestions(admin_client) == {"suggestions": [], "considered": 1}


def test_a_payee_a_category_was_chosen_for_again_and_again_is_worded_as_an_automation(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home, 4)
    # What the rule would sort now: the same payee, with no category, however it's written.
    home.transaction("WHOLEFDS MKT #99999 AUSTIN TX", "-12.00")
    home.transaction("Wholefds Mkt 4 Dallas", "-5.00")
    # Nothing to do with it.
    home.transaction("Corner Market", "-9.00")

    result = suggestions(admin_client)

    assert result["considered"] == 1
    (found,) = result["suggestions"]
    assert found == {
        "ref": "g1",
        "name": "Wholefds Mkt",
        "payees": ["WHOLEFDS MKT"],
        "match": "starts_with",
        "direction": "out",
        "category_id": str(home.groceries.id),
        "apply_to": "all",
        "reason": "Every one begins with WHOLEFDS MKT.",
        "choices": 4,
        "last_chosen": str(TODAY - dt.timedelta(days=1)),
        "examples": found["examples"],
        "sorts_now": 2,
        "elsewhere": 0,
        "overlaps": [],
    }
    assert len(found["examples"]) == 3
    assert all(example.startswith("WHOLEFDS MKT #1023") for example in found["examples"])
    # Nothing was created.
    assert not session.scalars(select(Automation)).all()


def test_the_ai_is_told_how_each_payee_is_written_and_what_was_chosen_for_it(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home, 3)

    suggest(admin_client)

    (seen,) = fake_ai.requests
    # Each store number is hidden, which leaves them all written the same.
    assert (
        "g1 | chosen 3 times | category: Groceries | money out | amounts 10.00 to 10.00 | "
        "written: WHOLEFDS MKT [account] AUSTIN TX"
    ) in seen.body


def test_a_payee_needs_the_same_category_chosen_three_times_and_nearly_always(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)
    # Four of five is enough; three of five is not; two is too few.
    chosen(home, "Alpha Foods #{n}", home.groceries, 4)
    chosen(home, "Alpha Foods #9{n}", home.coffee, 1)
    chosen(home, "Beta Foods #{n}", home.groceries, 3)
    chosen(home, "Beta Foods #9{n}", home.coffee, 2)
    chosen(home, "Gamma Foods #{n}", home.groceries, 2)

    result = suggestions(admin_client)

    assert result["considered"] == 1
    assert [found["payees"] for found in result["suggestions"]] == [["Alpha Foods"]]
    # The chosen elsewhere is counted, and left alone.
    assert result["suggestions"][0]["elsewhere"] == 1


def test_the_most_chosen_come_first_and_only_a_dozen_are_looked_at(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    for number in range(14):
        chosen(home, f"Store{chr(97 + number)} #{{n}}", home.groceries, 3 + number % 5)

    result = suggestions(admin_client)

    assert result["considered"] == automations.MAX_GROUPS == 12
    choices = [found["choices"] for found in result["suggestions"]]
    assert choices == sorted(choices, reverse=True)
    assert len(fake_ai.requests[0].body.split("chosen")) == 13


def test_money_in_money_out_and_both_are_told_apart(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)
    chosen(home, "Northwind Payroll #{n}", home.paycheck, 3, amount="1875.00")
    chosen(home, "Refund Mart #{n}", home.groceries, 2, amount="20.00")
    chosen(home, "Refund Mart #9{n}", home.groceries, 2, amount="-20.00")

    found = {item["payees"][0]: item for item in suggestions(admin_client)["suggestions"]}

    assert found["Northwind Payroll"]["direction"] == "in"
    assert found["Refund Mart"]["direction"] == "any"


# ---- What is already sorted ------------------------------------------------------------------


def automation(
    session: Session, category: Category, *payees: str, active: bool = True, name: str = "Sorter"
) -> Automation:
    rule = Automation(
        name=name,
        payees=list(payees),
        match=AutomationMatch.CONTAINS,
        direction=AutomationDirection.ANY,
        category_id=category.id,
        apply_to=AutomationScope.ALL,
        active=active,
    )
    session.add(rule)
    session.commit()
    return rule


def test_a_payee_an_automation_already_sorts_into_that_category_isnt_suggested(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    automation(session, home.groceries, "wholefds")

    assert suggestions(admin_client) == {"suggestions": [], "considered": 0}
    assert fake_ai.requests == []


def test_a_paused_automation_sorts_nothing_so_the_payee_is_still_suggested(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    automation(session, home.groceries, "wholefds", active=False)

    assert suggestions(admin_client)["considered"] == 1


def test_an_older_automation_that_gives_another_category_is_said_to_overlap(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    older = automation(session, home.coffee, "wholefds", name="Everything is coffee")

    (found,) = suggestions(admin_client)["suggestions"]

    assert found["overlaps"] == [
        {"automation_id": str(older.id), "automation_name": "Everything is coffee", "count": 4}
    ]


# ---- What the AI said, tried ----------------------------------------------------------------


def say(fake_ai: FakeAI, *items: Any) -> None:
    fake_ai.say = json.dumps({"automations": list(items)})


def worded(**fields: Any) -> dict[str, Any]:
    return {
        "id": "g1",
        "text": "WHOLEFDS MKT",
        "match": "starts_with",
        "name": "Groceries",
    } | fields


def test_the_wording_is_kept_or_made_sense_of_and_the_rest_is_left_out(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    say(
        fake_ai,
        worded(match="Contains ", name="x" * 200, reason="r" * 300),
        # Another one for the same payee, or for one that isn't there, counts for nothing.
        worded(text="Whole"),
        worded(id="g9"),
        {"id": 3, "text": 5},
    )

    (found,) = suggestions(admin_client)["suggestions"]

    assert (found["match"], found["payees"]) == ("contains", ["WHOLEFDS MKT"])
    assert (len(found["name"]), len(found["reason"])) == (120, 200)


def test_a_match_the_ai_worded_some_other_way_is_text_anywhere_in_the_payee(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    say(fake_ai, worded(match="regex", name="  "))

    (found,) = suggestions(admin_client)["suggestions"]

    assert found["match"] == "contains"
    # With no name, it's called after what it looks for and what it does.
    assert found["name"] == "WHOLEFDS MKT to Groceries"


@pytest.mark.parametrize(
    "text",
    [
        "WH",
        "W" * 61,
        "WHOLEFDS [account]",
        "WHOLEFDS #1023",
        "WHOLEFDS | MKT",
        # Text no transaction has.
        "Trader Joe's",
    ],
)
def test_text_that_cant_be_one_or_that_the_households_transactions_dont_have_is_left_out(
    admin_client: TestClient, session: Session, fake_ai: FakeAI, text: str
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    say(fake_ai, worded(text=text))

    result = suggestions(admin_client)

    assert result == {"suggestions": [], "considered": 1}


def test_text_that_covers_other_things_people_chose_otherwise_is_left_out(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    chosen(home, "Whole Foods Market #{n}", home.groceries, 4)
    chosen(home, "Corner Market", home.coffee, 3)
    say(fake_ai, worded(text="Market", match="contains"))

    # "Market" is where it was put in coffee as often as in groceries.
    assert suggestions(admin_client)["suggestions"] == []


def test_a_rule_that_leaves_alone_a_little_of_what_it_covers_is_offered_with_how_much(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    chosen(home, "Whole Foods Market #{n}", home.groceries, 4)
    chosen(home, "Whole Foods Cafe", home.coffee, 1)
    say(fake_ai, worded(text="Whole Foods", match="contains"))

    (found,) = suggestions(admin_client)["suggestions"]

    assert (found["choices"], found["elsewhere"]) == (4, 1)


@pytest.mark.parametrize(
    "answer", ["Sorry, I can't help.", '"coffee"', '{"automations": {"a": 1}}', "[1, 2]"]
)
def test_an_answer_that_cant_be_read_says_so(
    admin_client: TestClient, session: Session, fake_ai: FakeAI, answer: str
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    fake_ai.say = answer

    response = suggest(admin_client)

    assert response.status_code == 502
    assert error(response) == errors.UNREADABLE


def test_a_list_of_suggestions_without_the_object_around_it_is_read(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)
    fake_ai.say = json.dumps([worded()])

    assert len(suggestions(admin_client)["suggestions"]) == 1


# ---- Who can ask, and what is never sent ------------------------------------------------------


def test_suggesting_needs_ai_to_be_set_up(admin_client: TestClient, session: Session) -> None:
    whole_foods(household(session))

    response = suggest(admin_client)

    assert response.status_code == 409
    assert error(response) == errors.NOT_CONFIGURED


def test_suggesting_needs_the_csrf_token(admin_client: TestClient) -> None:
    del admin_client.headers["X-CSRF-Token"]

    assert error(suggest(admin_client)) == "csrf"


def test_no_account_number_or_name_is_sent_in_what_a_payee_is_written_as(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    chosen(
        home,
        "Payment to Tartan Bank card ending in 4410 from Everyday checking {n}",
        home.card_payments,
        3,
        amount="-300.00",
    )
    chosen(home, "Acct 99887766554433 Harbor CU transfer #{n}", home.card_payments, 3)

    suggest(admin_client)

    (seen,) = fake_ai.requests
    assert not [secret for secret in SECRETS if secret in seen.body]


def test_suggesting_is_counted_as_what_it_is(admin_client: TestClient, session: Session) -> None:
    home = household(session)
    configure(admin_client)
    whole_foods(home)

    suggest(admin_client)

    (usage,) = session.scalars(select(AIUsage)).all()
    assert usage.purpose == "automation"
