"""Searching transactions in plain words: the filters a question comes to, the accounts it names,
and that no account or bank name is sent to find them."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import errors
from app.ai.search import accounts_in
from app.models import AIUsage
from e2e.ai import FakeAI
from tests.ai import SECRETS, configure, household
from tests.finance import add_account
from tests.helpers import error

TODAY = "2026-09-20"


def search(client: TestClient, query: str, **fields: Any) -> Any:
    return client.post("/api/ai/search", json={"query": query, "today": TODAY, **fields})


def filters_of(client: TestClient, query: str) -> dict[str, Any]:
    response = search(client, query)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


EMPTY: dict[str, Any] = {
    "q": "",
    "account_ids": [],
    "category_ids": [],
    "uncategorized": False,
    "start": None,
    "end": None,
    "direction": None,
    "status": None,
    "sources": [],
    "min_amount": None,
    "max_amount": None,
    "sort": None,
}


# ---- Who can ask, and what is refused --------------------------------------------------------


def test_a_search_cant_be_made_until_ai_is_set_up(admin_client: TestClient) -> None:
    response = search(admin_client, "coffee")

    assert response.status_code == 409
    assert error(response) == errors.NOT_CONFIGURED


@pytest.mark.parametrize(
    "body",
    [
        {"query": ""},
        {"query": "   "},
        {"query": "x" * 301},
        {"query": "coffee", "today": "1969-12-31"},
        {"query": "coffee", "limit": 5},
        {},
    ],
)
def test_a_search_has_to_be_a_few_words_and_nothing_else(
    admin_client: TestClient, session: Session, body: dict[str, Any]
) -> None:
    household(session)
    configure(admin_client)

    response = admin_client.post("/api/ai/search", json=body)

    assert response.status_code == 422
    assert not session.scalars(select(AIUsage)).all()


def test_a_search_needs_the_csrf_token(admin_client: TestClient) -> None:
    del admin_client.headers["X-CSRF-Token"]

    assert error(search(admin_client, "coffee")) == "csrf"


# ---- What a question comes to ----------------------------------------------------------------


def test_a_question_becomes_the_filters_the_tab_already_has(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)

    result = filters_of(admin_client, "coffee at Starbucks over $5 spent last month")

    assert result == {
        "filters": EMPTY
        | {
            "q": "Starbucks",
            "category_ids": [str(home.coffee.id)],
            "direction": "out",
            "start": "2026-08-01",
            "end": "2026-08-31",
            "min_amount": "5.00",
        },
        "ignored": [],
    }


def test_the_biggest_money_in_and_money_out_and_the_oldest_are_orders_the_tab_has(
    admin_client: TestClient, session: Session
) -> None:
    household(session)
    configure(admin_client)

    orders = {
        query: filters_of(admin_client, query)["filters"]["sort"]
        for query in (
            "my biggest purchases",
            "my biggest deposits",
            "the oldest",
            "my paychecks",
        )
    }

    assert orders == {
        "my biggest purchases": "amount",
        "my biggest deposits": "-amount",
        "the oldest": "date",
        "my paychecks": None,
    }


@pytest.mark.parametrize(
    ("query", "days"),
    [
        ("last year", ("2025-01-01", "2025-12-31")),
        ("this year", ("2026-01-01", TODAY)),
        # The latest one that has begun: this March, and last November.
        ("in March", ("2026-03-01", "2026-03-31")),
        ("in November", ("2025-11-01", "2025-11-30")),
        ("in September", ("2026-09-01", "2026-09-30")),
        ("sometime", (None, None)),
    ],
)
def test_the_days_a_question_asks_for_are_worked_out_from_today(
    admin_client: TestClient, session: Session, query: str, days: tuple[str | None, str | None]
) -> None:
    household(session)
    configure(admin_client)

    filters = filters_of(admin_client, query)["filters"]

    assert (filters["start"], filters["end"]) == days


def test_uncategorized_pending_and_an_amount_below_are_found_too(
    admin_client: TestClient, session: Session
) -> None:
    household(session)
    configure(admin_client)

    result = filters_of(admin_client, "pending uncategorized under $20 this month")

    assert result["filters"] == EMPTY | {
        "uncategorized": True,
        "status": "pending",
        "max_amount": "20.00",
        "start": "2026-09-01",
        "end": TODAY,
    }


def test_what_cant_be_used_is_said_rather_than_guessed_at(
    admin_client: TestClient, session: Session
) -> None:
    home = household(session)
    configure(admin_client)

    result = filters_of(admin_client, "hobbies and groceries for a birthday in march")

    assert result["filters"]["category_ids"] == [str(home.groceries.id)]
    assert result["filters"]["start"] == "2026-03-01"
    assert result["ignored"] == ["birthday", "the category “Hobbies”"]


# ---- What the AI said, checked ---------------------------------------------------------------


def say(fake_ai: FakeAI, **answer: Any) -> None:
    fake_ai.say = json.dumps(answer)


def test_an_answer_with_odd_values_is_made_sense_of_or_left_out(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)
    say(
        fake_ai,
        words=5,
        categories=["COFFEE", 3, " coffee ", "Nonsense"],
        uncategorized="yes",
        direction="sideways",
        min=12,
        max="abc",
        **{"from": "2026-13-45", "to": 3},
        status="later",
        sources=["file", "bogus", 7, "file"],
        order="most_in",
        ignored=[1, "  a  ", ""],
    )

    result = filters_of(admin_client, "anything")

    assert result == {
        "filters": EMPTY
        | {
            "category_ids": [str(home.coffee.id)],
            "min_amount": "12.00",
            "sources": ["file"],
            "sort": "-amount",
        },
        "ignored": ["a", "the category “Nonsense”"],
    }


def test_amounts_and_days_the_wrong_way_round_are_put_right(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)
    say(fake_ai, min="$1,200.50", max="-10", **{"from": "2026-09-30", "to": "2026-09-01"})

    filters = filters_of(admin_client, "anything")["filters"]

    assert (filters["min_amount"], filters["max_amount"]) == ("10.00", "1200.50")
    assert (filters["start"], filters["end"]) == ("2026-09-01", "2026-09-30")


@pytest.mark.parametrize(
    "answer",
    [
        {"min": 0, "max": 10**15},
        {"min": True, "max": False},
        {"min": None, "max": [1]},
        {"from": "1969-12-31", "to": "2030-01-01"},
        {"from": 20260901, "to": True},
    ],
)
def test_amounts_and_days_that_make_no_sense_are_left_out(
    admin_client: TestClient, session: Session, fake_ai: FakeAI, answer: dict[str, Any]
) -> None:
    household(session)
    configure(admin_client)
    say(fake_ai, **answer)

    assert filters_of(admin_client, "anything")["filters"] == EMPTY


def test_the_words_to_look_for_are_no_longer_than_the_search_box_takes(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)
    say(fake_ai, words=f"  {'w' * 150}  ", ignored=[f"{'i' * 120}", "b", "c", "d", "e", "f"])

    result = filters_of(admin_client, "anything")

    assert result["filters"]["q"] == "w" * 100
    # It says what it couldn't use, but not at length.
    assert result["ignored"] == ["i" * 80, "b", "c", "d", "e"]


@pytest.mark.parametrize("answer", ["Sorry, I can't help with that.", "[1, 2, 3]", '"coffee"'])
def test_an_answer_that_cant_be_read_says_so(
    admin_client: TestClient, session: Session, fake_ai: FakeAI, answer: str
) -> None:
    household(session)
    configure(admin_client)
    fake_ai.say = answer

    response = search(admin_client, "coffee")

    assert response.status_code == 502
    assert error(response) == errors.UNREADABLE


def test_an_answer_with_words_around_the_json_is_read(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)
    fake_ai.say = 'Here you go: {"words": "taqueria", "direction": "out"} Enjoy.'

    filters = filters_of(admin_client, "anything")["filters"]

    assert (filters["q"], filters["direction"]) == ("taqueria", "out")


# ---- Accounts, which the AI is never told ----------------------------------------------------


def test_the_accounts_a_question_names_are_found_here_and_not_sent(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)

    result = filters_of(admin_client, "groceries on my visa and at Everyday checking, 4410")

    assert result["filters"]["account_ids"] == [str(home.checking.id), str(home.card.id)]
    (seen,) = fake_ai.requests
    assert not [secret for secret in (*SECRETS, "visa") if secret.lower() in seen.body.lower()]
    # What it was asked is what's left of the question.
    assert "groceries on my and at" in seen.body


def test_a_question_that_only_names_accounts_isnt_sent_anywhere(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    home = household(session)
    configure(admin_client)

    result = filters_of(admin_client, "Everyday checking Tartan")

    assert result["filters"] == EMPTY | {"account_ids": [str(home.checking.id), str(home.card.id)]}
    assert fake_ai.requests == []
    assert not session.scalars(select(AIUsage)).all()


def test_a_question_with_nothing_in_it_that_can_be_sent_isnt_sent_anywhere(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)

    result = filters_of(admin_client, "alex@example.com")

    assert result == {"filters": EMPTY, "ignored": []}
    assert fake_ai.requests == []


def test_account_numbers_and_names_in_a_question_never_reach_the_ai(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)

    search(admin_client, "what went to account 99887766554433, ending in 4410, at Harbor?")

    (seen,) = fake_ai.requests
    assert not [secret for secret in SECRETS if secret in seen.body]


def test_a_search_is_counted_as_one(admin_client: TestClient, session: Session) -> None:
    household(session)
    configure(admin_client)

    search(admin_client, "coffee")

    (usage,) = session.scalars(select(AIUsage)).all()
    assert usage.purpose == "search"


# ---- Which accounts a question names ---------------------------------------------------------


def test_an_account_is_named_by_its_name_its_banks_or_a_word_only_it_has(
    session: Session,
) -> None:
    home = household(session)
    named = {
        "Everyday Checking transactions": ([home.checking.id], "transactions"),
        "at harbor credit union": ([home.checking.id], "at"),
        "at Harbor": ([home.checking.id], "at"),
        "my visa": ([home.card.id], "my"),
        "Tartan Rewards Visa Signature": ([home.card.id], ""),
        "my checking": ([home.checking.id], "my"),
        "Tartan": ([home.card.id], ""),
        "nothing named": ([], "nothing named"),
    }

    for question, (ids, rest) in named.items():
        assert accounts_in(session, question) == (rest, ids), question


def test_a_word_that_names_no_account_in_particular_or_more_than_one_is_left_alone(
    session: Session,
) -> None:
    home = household(session)
    one = add_account(session, "Joint savings")
    two = add_account(session, "Rainy savings")
    # Short words, numbers and words like "card" in a name don't name it.
    add_account(session, "Old store card")
    add_account(session, "Retirement 401(k)")

    assert accounts_in(session, "savings credit card account") == (
        "savings credit card account",
        [],
    )
    # "Rainy savings" is a whole name, and "joint" is a word only one account's name has.
    assert accounts_in(session, "joint rainy savings") == ("", [two.id, one.id])
    assert accounts_in(session, "my savings") == ("my savings", [])
    # Numbers and short words don't name anything.
    assert accounts_in(session, "401 vis") == ("401 vis", [])
    assert home.checking.id not in accounts_in(session, "savings")[1]


def test_an_account_named_twice_is_found_once(session: Session) -> None:
    home = household(session)

    assert accounts_in(session, "visa and Rewards Visa and visa") == ("and and", [home.card.id])


def test_a_household_with_no_accounts_names_none(session: Session) -> None:
    assert accounts_in(session, "anything at all") == ("anything at all", [])
