"""A stand-in for the AI providers, for the end-to-end tests and the API's own tests.

It answers the requests Cashcove makes (app/ai/providers.py) from memory, the way each provider
does: Anthropic's Messages API, OpenAI's Responses API, and Ollama's chat and tags endpoints, on
the household's own computer (any address, except one that is down) and in Ollama's cloud. Each
provider checks its key, and what it is asked is answered by rules rather than by a model:

- a second opinion on how transactions are sorted suggests a category for a payee it
  recognizes (see RULES) and says nothing about the rest;
- the lines of a bank statement are answered with the transaction each one is: its date, its
  payee tidied up, and its amount, which is money in for a payroll, a deposit, a refund or a
  payment to a card and money out for anything else;
- a question is answered with how many recent transactions it was given and what was asked;
- "Reply with OK" is answered with OK.

Every request is kept, as the provider received it, so tests can check what was and wasn't sent.
"""

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx2 as httpx

# The made-up keys the fake accepts.
KEYS = {
    "anthropic": "e2e-anthropic-key",
    "openai": "e2e-openai-key",
    "ollama_cloud": "e2e-ollama-cloud-key",
}
# What an Ollama server on the household's computer has, which includes a model that only
# turns text into numbers.
LOCAL_MODELS = (
    ("llama3.2:3b", "3.2B", "llama"),
    ("qwen3:8b", "8.2B", "qwen3"),
    ("nomic-embed-text:latest", "137M", "nomic-bert"),
)
CLOUD_MODELS = (("gemma4:31b", "31B", "gemma4"), ("gpt-oss:120b", "120B", "gptoss"))
# An Ollama server that can't be reached.
DOWN_HOST = "ollama-down.example.test"
ANTHROPIC_MODELS = frozenset({"claude-sonnet-5-5", "claude-haiku-4-5-20251001"})
OPENAI_MODELS = frozenset(
    {"gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-5-nano"}
)

# Payees the fake recognizes, by what they contain, and the category it suggests for them.
RULES = (
    ("venmo", "Gifts & donations"),
    ("starbucks", "Coffee"),
    ("netflix", "Subscriptions"),
    ("shell", "Gas & fuel"),
    ("uber", "Rideshare & taxis"),
)

_STATEMENT_LINE = re.compile(r"^(\d+) \| (.+?) \| (.*) \| (.*)$", re.MULTILINE)
_STATEMENT_YEAR = re.compile(r"^Statement year: (\d{4})$", re.MULTILINE)
_MONEY_IN = re.compile(r"payroll|deposit|refund|autopay|payment - thank|credit|interest paid", re.I)
_PLACEHOLDER = re.compile(r"\[[a-z]+\]|#")
_MONTH_NUMBERS = {
    name: number
    for number, name in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
        start=1,
    )
}
_TRANSACTION = re.compile(r"^(t\d+) \| \S+ \| (.*) \| \S+ \S+ \| currently: (.*)$", re.MULTILINE)
_RECENT = re.compile(r"^\d{4}-\d{2}-\d{2} \|", re.MULTILINE)


@dataclass(frozen=True)
class Seen:
    """A request as a provider received it."""

    provider: str
    method: str
    host: str
    path: str
    # Whether it came with the right key (where the provider asks for one).
    authorized: bool
    # The request's body, as sent.
    body: str


def _tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _review(system: str) -> str:
    """The suggestions for the transactions listed in a second opinion's instructions."""
    suggestions: list[dict[str, str]] = []
    for ref, payee, current in _TRANSACTION.findall(system):
        for word, category in RULES:
            if word in payee.lower() and current != category:
                suggestions.append(
                    {
                        "id": ref,
                        "category": category,
                        "confidence": "high",
                        "reason": f"A payee like {payee}.",
                    }
                )
                break
    return json.dumps({"suggestions": suggestions})


def _iso_date(text: str, year: int) -> str:
    """A date as a statement writes it, the way the AI is asked to give it."""
    words = text.replace(",", " ").replace(".", " ").split()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if "/" in text:
        month, day, *years = (int(part) for part in text.split("/"))
        written = years[0] if years else year
        return f"{written + 2000 if written < 100 else written:04d}-{month:02d}-{day:02d}"
    if words[0][:3].lower() in _MONTH_NUMBERS:
        month_word, day_word, *tail = words
    else:
        day_word, month_word, *tail = words
    written = int(tail[0]) if tail else year
    return f"{written:04d}-{_MONTH_NUMBERS[month_word[:3].lower()]:02d}-{int(day_word):02d}"


def _statement(system: str) -> str:
    """The transactions the numbered lines of a statement are."""
    found = _STATEMENT_YEAR.search(system)
    year = int(found.group(1)) if found else 2026
    lines = system.partition("Lines:")[2]
    transactions: list[dict[str, str | int]] = []
    for number, date, text, amounts in _STATEMENT_LINE.findall(lines):
        amount = next(
            token
            for token in amounts.split()
            if re.fullmatch(r"[-+(]?\$?[\d,]+\.\d{2}\)?-?", token)
        )
        value = amount.strip("-+()$").replace(",", "")
        payee = " ".join(_PLACEHOLDER.sub("", text).split()).title()
        sign = "" if _MONEY_IN.search(text) else "-"
        transactions.append(
            {
                "line": int(number),
                "date": _iso_date(date, year),
                "payee": payee,
                "amount": f"{sign}{value}",
            }
        )
    return json.dumps({"transactions": transactions})


def _answer(system: str, question: str) -> str:
    if "second opinion on how a household's transactions" in system:
        return _review(system)
    if system.startswith("You read lines from a bank statement"):
        return _statement(system)
    if system.startswith("Reply with the single word OK"):
        return "OK"
    latest = system.partition("## Latest transactions")[2].split("## Transactions whose", 1)[0]
    seen = len(_RECENT.findall(latest))
    return f"I can see {seen} recent transactions. You asked: {question}"


class FakeAI:
    """Answers like Anthropic, OpenAI and Ollama, and remembers what it was asked."""

    def __init__(self) -> None:
        self.requests: list[Seen] = []
        # Set to have every answer be this, like a model that doesn't do as it's told.
        self.say: str | None = None

    def reset(self) -> None:
        self.requests.clear()
        self.say = None

    def _reply(self, system: str, question: str) -> str:
        return _answer(system, question) if self.say is None else self.say

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == "api.anthropic.com":
            return self._anthropic(request)
        if host == "api.openai.com":
            return self._openai(request)
        if host == DOWN_HOST:
            raise httpx.ConnectError("The server is down", request=request)
        return self._ollama(request, cloud=host == "ollama.com", path=path)

    def _seen(self, request: httpx.Request, provider: str, authorized: bool) -> dict[str, Any]:
        self.requests.append(
            Seen(
                provider=provider,
                method=request.method,
                host=request.url.host,
                path=request.url.path,
                authorized=authorized,
                body=request.content.decode(),
            )
        )
        body: dict[str, Any] = json.loads(request.content) if request.content else {}
        return body

    # ---- Anthropic ----------------------------------------------------------------------

    def _anthropic(self, request: httpx.Request) -> httpx.Response:
        authorized = request.headers.get("x-api-key") == KEYS["anthropic"]
        body = self._seen(request, "anthropic", authorized)
        if not authorized:
            return _anthropic_error(401, "authentication_error", "invalid x-api-key")
        if body.get("model") not in ANTHROPIC_MODELS:
            return _anthropic_error(404, "not_found_error", f"model: {body.get('model')}")
        system = str(body["system"])
        messages: list[dict[str, str]] = body["messages"]
        reply = self._reply(system, messages[-1]["content"])
        return httpx.Response(
            200,
            json={
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": reply}],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": _tokens(system + json.dumps(messages)),
                    "output_tokens": _tokens(reply),
                },
            },
        )

    # ---- OpenAI -------------------------------------------------------------------------

    def _openai(self, request: httpx.Request) -> httpx.Response:
        authorized = request.headers.get("authorization") == f"Bearer {KEYS['openai']}"
        body = self._seen(request, "openai", authorized)
        if not authorized:
            return httpx.Response(
                401,
                json={
                    "error": {
                        "message": "Incorrect API key provided",
                        "type": "invalid_request_error",
                    }
                },
            )
        if body.get("model") not in OPENAI_MODELS:
            return httpx.Response(
                404, json={"error": {"message": f"The model {body.get('model')} does not exist"}}
            )
        system = str(body["instructions"])
        messages: list[dict[str, str]] = body["input"]
        reply = self._reply(system, messages[-1]["content"])
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": reply}],
                    }
                ],
                "usage": {
                    "input_tokens": _tokens(system + json.dumps(messages)),
                    "output_tokens": _tokens(reply),
                },
            },
        )

    # ---- Ollama -------------------------------------------------------------------------

    def _ollama(self, request: httpx.Request, *, cloud: bool, path: str) -> httpx.Response:
        provider = "ollama_cloud" if cloud else "ollama_local"
        authorized = not cloud or request.headers.get("authorization") == (
            f"Bearer {KEYS['ollama_cloud']}"
        )
        body = self._seen(request, provider, authorized)
        if path == "/api/tags":
            return httpx.Response(
                200, json={"models": _models(CLOUD_MODELS if cloud else LOCAL_MODELS)}
            )
        if path != "/api/chat":
            return httpx.Response(404, json={"error": "not found"})
        if not authorized:
            return httpx.Response(401, json={"error": "unauthorized"})
        known = {name for name, _, _ in (CLOUD_MODELS if cloud else LOCAL_MODELS)}
        if body.get("model") not in known:
            return httpx.Response(404, json={"error": f"model '{body.get('model')}' not found"})
        messages: list[dict[str, str]] = body["messages"]
        system = messages[0]["content"]
        reply = self._reply(system, messages[-1]["content"])
        return httpx.Response(
            200,
            json={
                "model": body["model"],
                "message": {"role": "assistant", "content": reply},
                "done": True,
                "done_reason": "stop",
                "prompt_eval_count": _tokens(json.dumps(messages)),
                "eval_count": _tokens(reply),
            },
        )


def _anthropic_error(status: int, kind: str, message: str) -> httpx.Response:
    return httpx.Response(
        status, json={"type": "error", "error": {"type": kind, "message": message}}
    )


def _models(models: tuple[tuple[str, str, str], ...]) -> list[dict[str, Any]]:
    return [
        {
            "name": name,
            "model": name,
            "details": {"parameter_size": size, "family": family},
        }
        for name, size, family in models
    ]
