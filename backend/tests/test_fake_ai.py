"""The stand-in for the AI providers, which the end-to-end tests and the API's tests rely on."""

import json
from typing import Any

import httpx2 as httpx
import pytest

from app.ai import errors
from app.ai.errors import AIError
from app.ai.providers import AIClient, Connection, Message
from app.models import AIProvider
from e2e.ai import DOWN_HOST, KEYS, RULES, FakeAI

SYSTEM = "You answer."
REVIEW = (
    "You give a second opinion on how a household's transactions are sorted.\n"
    "t1 | 2026-09-18 | Venmo | -40.00 USD | currently: (none)\n"
    "t2 | 2026-09-18 | STARBUCKS #4 | -4.50 USD | currently: Groceries\n"
    "t3 | 2026-09-18 | Whole Foods | -84.12 USD | currently: Groceries\n"
    "t4 | 2026-09-18 | Netflix | -15.49 USD | currently: Subscriptions\n"
    "t5 | 2026-09-18 | Uber Eats | -22.00 USD | currently: (none)\n"
)

CONNECTIONS = {
    "anthropic": (Connection(AIProvider.ANTHROPIC, api_key=KEYS["anthropic"]), "claude-sonnet-5-5"),
    "openai": (Connection(AIProvider.OPENAI, api_key=KEYS["openai"]), "gpt-6-luna"),
    "ollama_cloud": (
        Connection(AIProvider.OLLAMA_CLOUD, api_key=KEYS["ollama_cloud"]),
        "gemma4:31b",
    ),
    "ollama_local": (
        Connection(AIProvider.OLLAMA_LOCAL, base_url="http://host.docker.internal:11434"),
        "llama3.2:3b",
    ),
}


def ask(
    fake: FakeAI, connection: Connection, model: str, system: str = SYSTEM, question: str = "Hi?"
) -> str:
    with AIClient(connection, version="1", transport=fake.transport) as client:
        return client.complete(model, system, [Message("user", question)], max_tokens=100).text


@pytest.mark.parametrize("provider", list(CONNECTIONS))
def test_every_provider_answers_a_question_with_what_it_was_given(provider: str) -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS[provider]
    system = (
        "Intro\n\n## Latest transactions, newest first (last 45 days)\n"
        "2026-09-18 | Venmo | Uncategorized | -40.00 USD\n"
        "2026-09-17 | Whole Foods | Groceries | -84.12 USD\n\n"
        "## Transactions whose payee matches the question\n"
        "2026-09-01 | Venmo | Uncategorized | -5.00 USD\n"
    )

    reply = ask(fake, connection, model, system, "How much on Venmo?")

    assert reply == "I can see 2 recent transactions. You asked: How much on Venmo?"
    (seen,) = fake.requests
    assert (seen.provider, seen.method, seen.authorized) == (provider, "POST", True)


def test_a_question_with_no_latest_transactions_sees_none() -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS["openai"]

    assert ask(fake, connection, model).startswith("I can see 0 recent transactions.")


@pytest.mark.parametrize("provider", list(CONNECTIONS))
def test_every_provider_says_ok_when_asked_to(provider: str) -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS[provider]

    assert ask(fake, connection, model, "Reply with the single word OK.") == "OK"


@pytest.mark.parametrize("provider", list(CONNECTIONS))
def test_a_second_opinion_suggests_categories_for_payees_it_recognizes(provider: str) -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS[provider]

    reply = ask(fake, connection, model, REVIEW)

    assert json.loads(reply) == {
        "suggestions": [
            {
                "id": "t1",
                "category": "Gifts & donations",
                "confidence": "high",
                "reason": "A payee like Venmo.",
            },
            {
                "id": "t2",
                "category": "Coffee",
                "confidence": "high",
                "reason": "A payee like STARBUCKS #4.",
            },
            {
                "id": "t5",
                "category": "Rideshare & taxis",
                "confidence": "high",
                "reason": "A payee like Uber Eats.",
            },
        ]
    }


def test_the_payees_it_recognizes_are_the_rules() -> None:
    assert [word for word, _ in RULES] == ["venmo", "starbucks", "netflix", "shell", "uber"]


def test_it_can_be_made_to_answer_with_anything() -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS["anthropic"]
    fake.say = "Not JSON at all."

    assert ask(fake, connection, model, REVIEW) == "Not JSON at all."

    fake.reset()
    assert fake.say is None
    assert fake.requests == []


@pytest.mark.parametrize("provider", ["anthropic", "openai", "ollama_cloud"])
def test_a_wrong_key_is_turned_down_like_the_provider_does(provider: str) -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS[provider]
    wrong = Connection(connection.provider, connection.base_url, "not-the-key")

    with pytest.raises(AIError) as caught:
        ask(fake, wrong, model)

    assert caught.value.code == errors.UNAUTHORIZED
    assert fake.requests[0].authorized is False


@pytest.mark.parametrize("provider", list(CONNECTIONS))
def test_a_model_the_provider_doesnt_have_isnt_found(provider: str) -> None:
    fake = FakeAI()
    connection, _ = CONNECTIONS[provider]

    with pytest.raises(AIError) as caught:
        ask(fake, connection, "claude-opus-5-5")

    assert caught.value.code == errors.NOT_FOUND


def test_ollama_lists_its_models_on_the_computer_and_in_the_cloud() -> None:
    fake = FakeAI()

    with AIClient(CONNECTIONS["ollama_local"][0], version="1", transport=fake.transport) as client:
        local = [model.id for model in client.models()]
    with AIClient(CONNECTIONS["ollama_cloud"][0], version="1", transport=fake.transport) as client:
        cloud = [model.id for model in client.models()]

    # The model that only makes embeddings can't chat, so it's left out.
    assert local == ["llama3.2:3b", "qwen3:8b"]
    assert cloud == ["gemma4:31b", "gpt-oss:120b"]
    assert [(seen.provider, seen.path) for seen in fake.requests] == [
        ("ollama_local", "/api/tags"),
        ("ollama_cloud", "/api/tags"),
    ]


def test_ollama_doesnt_know_other_paths() -> None:
    fake = FakeAI()
    request = httpx.Request("GET", "http://host.docker.internal:11434/api/version")

    response = fake.transport.handle_request(request)

    assert response.status_code == 404


def test_a_server_that_is_down_cant_be_reached() -> None:
    fake = FakeAI()
    down = Connection(AIProvider.OLLAMA_LOCAL, base_url=f"http://{DOWN_HOST}:11434")

    with pytest.raises(AIError) as caught:
        ask(fake, down, "llama3.2:3b")

    assert caught.value.code == errors.UNREACHABLE
    assert fake.requests == []


def test_every_request_is_kept_as_the_provider_got_it() -> None:
    fake = FakeAI()
    connection, model = CONNECTIONS["openai"]

    ask(fake, connection, model, question="What is 4410?")

    (seen,) = fake.requests
    body: dict[str, Any] = json.loads(seen.body)
    assert (seen.host, seen.path) == ("api.openai.com", "/v1/responses")
    assert body["input"] == [{"role": "user", "content": "What is 4410?"}]
    assert "4410" in seen.body
