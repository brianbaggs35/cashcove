"""Each provider's wire format, as its documentation describes it, and how failures read."""

import json
from collections.abc import Callable
from typing import Any

import httpx2 as httpx
import pytest

from app.ai import errors
from app.ai.errors import AIError
from app.ai.providers import (
    MAX_BYTES,
    TIMEOUT,
    AIClient,
    Connection,
    Message,
    normalize_url,
    timeout_of,
)
from app.ai.tokens import Tokens
from app.models import AIProvider

SYSTEM = "You answer questions."
TURNS = [Message("user", "Hi"), Message("assistant", "Hello"), Message("user", "How much?")]
Handler = Callable[[httpx.Request], httpx.Response]


def client(connection: Connection, handler: Handler) -> AIClient:
    return AIClient(connection, version="9.9.9", transport=httpx.MockTransport(handler))


def recording(
    reply: httpx.Response,
) -> tuple[list[httpx.Request], Handler]:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return reply

    return seen, handle


def body_of(request: httpx.Request) -> dict[str, Any]:
    result: dict[str, Any] = json.loads(request.content)
    return result


LOCAL = Connection(AIProvider.OLLAMA_LOCAL, base_url="http://host.docker.internal:11434")
CLOUD = Connection(AIProvider.OLLAMA_CLOUD, api_key="ollama-secret-key")
ANTHROPIC = Connection(AIProvider.ANTHROPIC, api_key="sk-ant-secret-key")
OPENAI = Connection(AIProvider.OPENAI, api_key="sk-openai-secret-key")


def ask(connection: Connection, handler: Handler, model: str = "m", tokens: int = 100) -> Any:
    with client(connection, handler) as ai:
        return ai.complete(model, SYSTEM, TURNS, max_tokens=tokens)


def failure(connection: Connection, handler: Handler) -> AIError:
    with pytest.raises(AIError) as caught:
        ask(connection, handler)
    return caught.value


# ---- The address of an Ollama server ---------------------------------------------------------


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("http://localhost:11434", "http://localhost:11434"),
        ("  http://localhost:11434/  ", "http://localhost:11434"),
        ("HTTP://Host.Docker.Internal:11434", "http://host.docker.internal:11434"),
        ("https://ollama.lan", "https://ollama.lan"),
        ("http://192.168.1.20:11434/ollama/", "http://192.168.1.20:11434/ollama"),
        ("http://[::1]:11434", "http://[::1]:11434"),
    ],
)
def test_an_ollama_address_is_tidied(given: str, expected: str) -> None:
    assert normalize_url(given) == expected


@pytest.mark.parametrize(
    "given",
    [
        "",
        "localhost:11434",
        "ftp://localhost",
        "file:///etc/passwd",
        "http://",
        "http://user:pass@localhost:11434",
        "http://user@localhost:11434",
        "http://localhost:11434?x=1",
        "http://localhost:11434#top",
        "http://localhost:99999",
        "http://localhost:abc",
        "http://localhost:0",
        "http://169.254.169.254/latest/meta-data",
        "http://169.254.0.1",
        "http://[fe80::1]:11434",
        "http://0.0.0.0:11434",
        "http://224.0.0.1",
        "http://metadata.google.internal",
        "http://[fd00:ec2::254]",
    ],
)
def test_an_address_that_isnt_an_ollama_server_is_refused(given: str) -> None:
    with pytest.raises(ValueError, match=r"."):
        normalize_url(given)


# ---- Ollama ---------------------------------------------------------------------------------


def ollama_reply(**fields: Any) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "message": {"role": "assistant", "content": "Eighty."},
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 120,
            "eval_count": 7,
            **fields,
        },
    )


def test_ollama_on_your_computer_is_asked_to_chat_without_streaming() -> None:
    seen, handle = recording(ollama_reply())

    answer = ask(LOCAL, handle, "llama3.2:3b", tokens=500)

    assert (answer.text, answer.tokens.input, answer.tokens.output) == ("Eighty.", 120, 7)
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == "http://host.docker.internal:11434/api/chat"
    assert "authorization" not in request.headers
    assert request.headers["user-agent"] == "Cashcove/9.9.9"
    assert body_of(request) == {
        "model": "llama3.2:3b",
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
            {"role": "user", "content": "How much?"},
        ],
        # Ollama's default context is 4k tokens, which would cut the finance data off.
        "options": {"num_predict": 500, "num_ctx": 16384},
    }


def test_ollama_cloud_is_asked_at_ollama_com_with_the_key_as_a_bearer_token() -> None:
    seen, handle = recording(ollama_reply())

    ask(CLOUD, handle, "gemma4:31b")

    (request,) = seen
    assert str(request.url) == "https://ollama.com/api/chat"
    assert request.headers["authorization"] == "Bearer ollama-secret-key"
    assert body_of(request)["options"] == {"num_predict": 100}


def test_ollama_with_a_path_in_its_address_is_asked_there() -> None:
    seen, handle = recording(ollama_reply())
    ask(Connection(AIProvider.OLLAMA_LOCAL, base_url="https://ollama.lan/ollama"), handle)
    assert str(seen[0].url) == "https://ollama.lan/ollama/api/chat"


def test_an_ollama_answer_with_no_counts_costs_no_tokens() -> None:
    answer = ask(
        LOCAL,
        lambda _: httpx.Response(
            200, json={"message": {"content": "Hi"}, "prompt_eval_count": True}
        ),
    )
    assert (answer.text, answer.tokens.input, answer.tokens.output) == ("Hi", 0, 0)


def test_ollama_running_out_of_room_before_it_answers_is_an_error_that_still_counts() -> None:
    problem = failure(
        LOCAL,
        lambda _: ollama_reply(
            message={"role": "assistant", "content": "", "thinking": "hmm"}, done_reason="length"
        ),
    )

    assert problem.code == errors.EMPTY
    assert (problem.tokens.input, problem.tokens.output) == (120, 7)


def test_an_empty_ollama_answer_that_finished_is_just_empty() -> None:
    answer = ask(LOCAL, lambda _: ollama_reply(message={"role": "assistant", "content": ""}))
    assert answer.text == ""


# ---- Anthropic ------------------------------------------------------------------------------


def anthropic_reply(**fields: Any) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "Eighty."}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 300, "output_tokens": 12},
            **fields,
        },
    )


def test_anthropic_gets_the_messages_api_with_its_headers_and_medium_effort_for_sonnet() -> None:
    seen, handle = recording(anthropic_reply())

    answer = ask(ANTHROPIC, handle, "claude-sonnet-5-5", tokens=4000)

    assert (answer.text, answer.tokens.input, answer.tokens.output) == ("Eighty.", 300, 12)
    (request,) = seen
    assert str(request.url) == "https://api.anthropic.com/v1/messages"
    assert request.headers["x-api-key"] == "sk-ant-secret-key"
    assert request.headers["anthropic-version"] == "2023-06-01"
    assert body_of(request) == {
        "model": "claude-sonnet-5-5",
        "max_tokens": 4000,
        "system": SYSTEM,
        "messages": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
            {"role": "user", "content": "How much?"},
        ],
        "output_config": {"effort": "medium"},
    }


def test_haiku_isnt_sent_an_effort_it_doesnt_support() -> None:
    seen, handle = recording(anthropic_reply())

    ask(ANTHROPIC, handle, "claude-haiku-4-5-20251001")

    assert "output_config" not in body_of(seen[0])


def test_no_sampling_parameters_are_sent_which_newer_models_refuse() -> None:
    seen, handle = recording(anthropic_reply())
    ask(ANTHROPIC, handle, "claude-sonnet-5-5")
    assert not {"temperature", "top_p", "top_k"} & set(body_of(seen[0]))


def test_only_the_text_blocks_of_an_anthropic_answer_are_the_answer() -> None:
    answer = ask(
        ANTHROPIC,
        lambda _: anthropic_reply(
            content=[
                {"type": "thinking", "thinking": "Let me think", "signature": "x"},
                {"type": "text", "text": "Eighty"},
                {"type": "redacted_thinking", "data": "x"},
                {"type": "text", "text": " dollars."},
                "not a block",
            ]
        ),
    )
    assert answer.text == "Eighty dollars."


def test_anthropic_declining_is_an_error_that_still_counts() -> None:
    problem = failure(ANTHROPIC, lambda _: anthropic_reply(content=[], stop_reason="refusal"))
    assert problem.code == errors.REFUSED
    assert (problem.tokens.input, problem.tokens.output) == (300, 12)


def test_thinking_that_uses_all_the_room_is_an_error_that_still_counts() -> None:
    problem = failure(
        ANTHROPIC,
        lambda _: anthropic_reply(
            content=[{"type": "thinking", "thinking": "..."}], stop_reason="max_tokens"
        ),
    )
    assert problem.code == errors.EMPTY
    assert problem.tokens.output == 12


def test_an_anthropic_answer_cut_off_after_some_text_is_still_an_answer() -> None:
    answer = ask(ANTHROPIC, lambda _: anthropic_reply(stop_reason="max_tokens"))
    assert answer.text == "Eighty."


# ---- OpenAI ---------------------------------------------------------------------------------


def openai_reply(**fields: Any) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {"type": "reasoning", "summary": []},
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "Eighty.", "annotations": []}],
                },
            ],
            "usage": {"input_tokens": 250, "output_tokens": 40},
            **fields,
        },
    )


def test_openai_gets_the_responses_api_and_isnt_asked_to_keep_the_conversation() -> None:
    seen, handle = recording(openai_reply())

    answer = ask(OPENAI, handle, "gpt-6-luna", tokens=16000)

    assert (answer.text, answer.tokens.input, answer.tokens.output) == ("Eighty.", 250, 40)
    (request,) = seen
    assert str(request.url) == "https://api.openai.com/v1/responses"
    assert request.headers["authorization"] == "Bearer sk-openai-secret-key"
    assert body_of(request) == {
        "model": "gpt-6-luna",
        "instructions": SYSTEM,
        "input": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
            {"role": "user", "content": "How much?"},
        ],
        "max_output_tokens": 16000,
        # OpenAI keeps a response for 30 days unless it's told not to.
        "store": False,
    }


def test_openai_says_how_much_input_came_from_its_cache_and_went_into_it() -> None:
    answer = ask(
        OPENAI,
        lambda _: openai_reply(
            usage={
                "input_tokens": 5000,
                "output_tokens": 40,
                "input_tokens_details": {"cached_tokens": 3000, "cache_write_tokens": 1200},
            }
        ),
    )

    assert answer.tokens == Tokens(input=5000, output=40, cached=3000, written=1200)


def test_openai_without_cache_details_used_none() -> None:
    answer = ask(OPENAI, lambda _: openai_reply(usage={"input_tokens": 50, "output_tokens": 4}))

    assert answer.tokens == Tokens(input=50, output=4)


def test_openai_isnt_sent_parameters_that_reasoning_models_refuse() -> None:
    seen, handle = recording(openai_reply())
    ask(OPENAI, handle, "gpt-6-luna")
    assert not {"temperature", "top_p", "reasoning"} & set(body_of(seen[0]))


def test_openai_declining_is_an_error_that_still_counts() -> None:
    problem = failure(
        OPENAI,
        lambda _: openai_reply(
            output=[{"type": "message", "content": [{"type": "refusal", "refusal": "No."}]}]
        ),
    )
    assert problem.code == errors.REFUSED
    assert (problem.tokens.input, problem.tokens.output) == (250, 40)


def test_reasoning_that_uses_all_the_room_is_an_error_that_still_counts() -> None:
    problem = failure(
        OPENAI,
        lambda _: openai_reply(
            status="incomplete",
            output=[{"type": "reasoning", "summary": []}],
            incomplete_details={"reason": "max_output_tokens"},
        ),
    )
    assert problem.code == errors.EMPTY
    assert problem.tokens.output == 40


def test_an_incomplete_openai_answer_with_text_is_still_an_answer() -> None:
    assert ask(OPENAI, lambda _: openai_reply(status="incomplete")).text == "Eighty."


# ---- When a provider says no ---------------------------------------------------------------


@pytest.mark.parametrize("connection", [LOCAL, CLOUD, ANTHROPIC, OPENAI])
@pytest.mark.parametrize("status", [401, 403])
def test_a_key_that_isnt_accepted_is_unauthorized_and_never_repeated(
    connection: Connection, status: int
) -> None:
    problem = failure(
        connection,
        lambda _: httpx.Response(
            status, json={"error": {"message": "Incorrect API key provided: sk-openai-secr***"}}
        ),
    )

    assert problem.code == errors.UNAUTHORIZED
    assert "sk-" not in problem.message
    assert "***" not in problem.message


def test_a_missing_model_is_not_found_with_what_the_provider_said() -> None:
    nested = failure(
        OPENAI,
        lambda _: httpx.Response(404, json={"error": {"message": "The model `x` does not exist"}}),
    )
    plain = failure(LOCAL, lambda _: httpx.Response(404, json={"error": "model 'x' not found"}))

    assert nested.code == plain.code == errors.NOT_FOUND
    assert "does not exist" in nested.message
    assert "model 'x' not found" in plain.message


def test_a_missing_model_with_nothing_said_is_still_not_found() -> None:
    problem = failure(ANTHROPIC, lambda _: httpx.Response(404, text="nope"))
    assert problem.code == errors.NOT_FOUND
    assert problem.message.endswith("model.")


def test_too_many_requests_or_no_credit_is_rate_limited() -> None:
    problem = failure(OPENAI, lambda _: httpx.Response(429, json={"error": {"message": "quota"}}))
    assert problem.code == errors.RATE_LIMITED


@pytest.mark.parametrize("status", [500, 502, 529])
def test_a_provider_having_a_problem_is_a_provider_error(status: int) -> None:
    problem = failure(ANTHROPIC, lambda _: httpx.Response(status, json={"type": "error"}))
    assert problem.code == errors.PROVIDER_ERROR


@pytest.mark.parametrize("status", [400, 422, 301])
def test_a_request_the_provider_turns_down_says_why(status: int) -> None:
    problem = failure(
        ANTHROPIC,
        lambda _: httpx.Response(
            status, json={"type": "error", "error": {"message": "max_tokens: too large\n  really"}}
        ),
    )
    assert problem.code == errors.BAD_REQUEST
    assert problem.message.endswith("down: max_tokens: too large really")


def test_what_a_provider_says_is_shortened() -> None:
    problem = failure(LOCAL, lambda _: httpx.Response(400, json={"error": "x" * 1000}))
    assert len(problem.message) < 300


@pytest.mark.parametrize("body", [b"", b"not json", b"[1, 2]", b'{"error": 5}'])
def test_an_unreadable_complaint_is_still_a_complaint(body: bytes) -> None:
    problem = failure(LOCAL, lambda _: httpx.Response(400, content=body))
    assert problem.code == errors.BAD_REQUEST
    assert problem.message.endswith("down.")


def test_an_unreachable_server_says_how_to_reach_ollama_from_the_container() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    problem = failure(LOCAL, down)

    assert problem.code == errors.UNREACHABLE
    assert "http://host.docker.internal:11434" in problem.message
    assert "localhost there is the container itself" in problem.message


@pytest.mark.parametrize("connection", [CLOUD, ANTHROPIC, OPENAI])
def test_an_unreachable_provider_points_at_the_internet_connection(connection: Connection) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    problem = failure(connection, down)

    assert problem.code == errors.UNREACHABLE
    assert "internet connection" in problem.message


def test_a_slow_answer_times_out_with_a_hint() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    problem = failure(LOCAL, slow)

    assert problem.code == errors.UNREACHABLE
    assert "didn't answer in time" in problem.message


def test_an_address_that_isnt_a_url_is_unreachable_not_a_crash() -> None:
    nowhere = Connection(AIProvider.OLLAMA_LOCAL, base_url="http://[::1")
    problem = failure(nowhere, lambda _: ollama_reply())
    assert problem.code == errors.UNREACHABLE


def test_an_address_with_no_scheme_is_refused_by_the_real_transport_without_a_request() -> None:
    nowhere = Connection(AIProvider.OLLAMA_LOCAL, base_url="nonsense")

    with AIClient(nowhere, version="9.9.9") as ai, pytest.raises(AIError) as caught:
        ai.complete("m", SYSTEM, TURNS, max_tokens=10)

    assert caught.value.code == errors.UNREACHABLE


@pytest.mark.parametrize("body", [b"", b"<html>", b"[1]", b'"text"'])
def test_an_answer_that_isnt_a_json_object_is_unreadable(body: bytes) -> None:
    problem = failure(OPENAI, lambda _: httpx.Response(200, content=body))
    assert problem.code == errors.UNREADABLE


def test_an_answer_that_is_too_big_is_refused() -> None:
    problem = failure(OPENAI, lambda _: httpx.Response(200, content=b"x" * (MAX_BYTES + 1)))
    assert problem.code == errors.UNREADABLE
    assert "too big" in problem.message


def test_odd_shapes_in_an_answer_count_as_nothing() -> None:
    answer = ask(
        OPENAI,
        lambda _: httpx.Response(
            200,
            json={"output": "no", "usage": {"input_tokens": "5", "output_tokens": -3}},
        ),
    )
    assert (answer.text, answer.tokens.input, answer.tokens.output) == ("", 0, 0)


# ---- Models -----------------------------------------------------------------------------------


def tags(*models: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json={"models": list(models)})


def models_of(connection: Connection, handler: Handler) -> Any:
    with client(connection, handler) as ai:
        return ai.models()


def test_ollama_lists_its_models_that_can_chat_by_name() -> None:
    seen, handle = recording(
        tags(
            {"name": "qwen3:8b", "details": {"parameter_size": "8.2B", "family": "qwen3"}},
            {"name": "llama3.2:3b", "model": "llama3.2:3b", "details": {"family": "llama"}},
            {"name": "nomic-embed-text:latest", "details": {"family": "nomic-bert"}},
            {"name": "all-minilm:latest", "details": {"family": "bert"}},
            {"name": "mxbai-embed-large", "details": {}},
            {"model": "only-a-model-key:1b"},
            {"details": {"family": "llama"}},
            {"name": "qwen3:8b"},
        )
    )

    found = models_of(LOCAL, handle)

    assert [(model.id, model.name, model.note) for model in found] == [
        ("llama3.2:3b", "llama3.2:3b", None),
        ("only-a-model-key:1b", "only-a-model-key:1b", None),
        ("qwen3:8b", "qwen3:8b", None),
    ]
    assert str(seen[0].url) == "http://host.docker.internal:11434/api/tags"
    assert seen[0].method == "GET"


def test_the_size_of_a_model_is_its_note() -> None:
    (model,) = models_of(
        LOCAL, lambda _: tags({"name": "qwen3:8b", "details": {"parameter_size": "8.2B"}})
    )
    assert model.note == "8.2B"


def test_ollama_cloud_lists_models_from_ollama_com_with_the_key() -> None:
    seen, handle = recording(tags({"name": "gemma4:31b"}))

    found = models_of(CLOUD, handle)

    assert [model.id for model in found] == ["gemma4:31b"]
    assert str(seen[0].url) == "https://ollama.com/api/tags"
    assert seen[0].headers["authorization"] == "Bearer ollama-secret-key"


def test_ollama_cloud_lists_models_even_before_there_is_a_key() -> None:
    seen, handle = recording(tags({"name": "gemma4:31b"}))
    models_of(Connection(AIProvider.OLLAMA_CLOUD), handle)
    assert "authorization" not in seen[0].headers


def test_a_list_that_isnt_a_list_of_models_is_unreadable() -> None:
    with pytest.raises(AIError) as caught:
        models_of(LOCAL, lambda _: httpx.Response(200, json={"models": "none"}))
    assert caught.value.code == errors.UNREADABLE


def test_an_empty_server_has_no_models() -> None:
    assert models_of(LOCAL, lambda _: httpx.Response(200, json={})) == []


@pytest.mark.parametrize("connection", [ANTHROPIC, OPENAI])
def test_only_ollama_has_models_to_fetch(connection: Connection) -> None:
    with pytest.raises(AIError) as caught:
        models_of(connection, lambda _: tags())
    assert caught.value.code == errors.BAD_REQUEST


# ---- How long it waits -----------------------------------------------------------------------


def test_it_waits_as_long_as_usual_unless_told_how_long() -> None:
    assert timeout_of(None) is TIMEOUT
    assert timeout_of(42.5) == httpx.Timeout(42.5, connect=10.0)
    # It doesn't wait longer to connect than it waits altogether.
    assert timeout_of(3.0) == httpx.Timeout(3.0, connect=3.0)


def test_a_request_is_given_the_wait_it_was_asked_for() -> None:
    waits: list[dict[str, float | None]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        waits.append(request.extensions["timeout"])
        return openai_reply()

    for timeout in (TIMEOUT, timeout_of(20.0)):
        with AIClient(
            OPENAI, version="9.9.9", transport=httpx.MockTransport(handle), timeout=timeout
        ) as ai:
            ai.complete("m", SYSTEM, TURNS, max_tokens=10)

    assert waits == [
        {"connect": 10.0, "read": 300.0, "write": 300.0, "pool": 300.0},
        {"connect": 10.0, "read": 20.0, "write": 20.0, "pool": 20.0},
    ]
