"""Talking to the AI providers' APIs: Ollama (on the household's computer or in its cloud),
Anthropic and OpenAI.

Each follows the provider's own documentation, as it was on 2026-10-06:

- Ollama: ``POST /api/chat`` with ``stream: false`` and ``GET /api/tags``
  (https://docs.ollama.com/api/chat, https://docs.ollama.com/cloud), with the cloud's key as a
  bearer token. A model's context is only 4k tokens on most computers unless a request asks
  for more (``options.num_ctx``), which would silently cut the finance data off, so it does.
- Anthropic: ``POST /v1/messages`` with ``x-api-key`` and ``anthropic-version: 2023-06-01``
  (https://platform.claude.com/docs/en/api/messages). Thinking counts toward ``max_tokens``,
  so it's generous; only the ``text`` blocks are the answer; Sonnet 5.5 is asked for medium
  effort, which suits chat; no sampling parameters are sent, which newer models refuse.
- OpenAI: the Responses API, ``POST /v1/responses``, which the GPT-6 guide says to start with
  (https://developers.openai.com/api/docs/guides/latest-model). ``store`` is false so
  OpenAI doesn't keep the conversation, no sampling parameters are sent (reasoning models
  refuse them), and ``max_output_tokens`` counts reasoning too, so it's generous.

Only the Ollama address is chosen by a person, and it can only be asked for ``/api/chat`` and
``/api/tags``. Redirects aren't followed, and answers are read up to a size limit.
"""

import ipaddress
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import urlsplit

import httpx2 as httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from app.ai import errors
from app.ai.catalog import ANTHROPIC_URL, OLLAMA_CLOUD_URL, OPENAI_URL, ModelChoice, find_model
from app.ai.errors import AIError
from app.ai.tokens import Tokens
from app.models.ai import AIProvider

# A slow model, or one that's still loading, can take minutes; reaching it shouldn't.
TIMEOUT = httpx.Timeout(300.0, connect=10.0)
# The most an answer or a list can be before it's refused.
MAX_BYTES = 4 * 1024 * 1024
# How much of a conversation Ollama keeps in view, which is more than its small default.
OLLAMA_CONTEXT = 16384
ANTHROPIC_VERSION = "2023-06-01"
# Hosts a request is never sent to: where cloud servers keep their own credentials.
BLOCKED_HOSTS = frozenset({"metadata.google.internal", "metadata", "fd00:ec2::254"})


@dataclass(frozen=True)
class Connection:
    """What's needed to reach a provider."""

    provider: AIProvider
    # Only Ollama on the household's computer has an address; the others are fixed.
    base_url: str | None = None
    api_key: str | None = None


@dataclass(frozen=True)
class Message:
    role: str
    content: str


@dataclass(frozen=True)
class Completion:
    """An answer, and what it cost in tokens."""

    text: str
    tokens: Tokens


def normalize_url(value: str) -> str:
    """The address of an Ollama server, without a trailing slash, or ValueError saying what's
    wrong with it."""
    parts = urlsplit(value.strip())
    try:
        port = parts.port
    except ValueError:
        port = -1
    host = (parts.hostname or "").lower()
    if parts.scheme not in {"http", "https"} or not host:
        raise ValueError("Enter the address as http://host:11434 or https://host")
    if parts.username is not None or parts.password is not None:
        raise ValueError("The address can't have a user name or password in it")
    if parts.query or parts.fragment:
        raise ValueError("The address can't have a query or a fragment")
    if port == -1 or port == 0:
        raise ValueError("The port isn't a number from 1 to 65535")
    if _blocked(host):
        raise ValueError("That address is reserved for the cloud's own credentials")
    path = parts.path.rstrip("/")
    return f"{parts.scheme}://{parts.netloc.lower()}{path}"


def _blocked(host: str) -> bool:
    if host in BLOCKED_HOSTS:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_link_local or address.is_unspecified or address.is_multicast


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _OllamaDetails(_Model):
    parameter_size: str | None = None
    family: str | None = None


class _OllamaModel(_Model):
    name: str | None = None
    model: str | None = None
    details: _OllamaDetails | None = None


class _OllamaTags(_Model):
    models: list[_OllamaModel] = []


# Models that only turn text into numbers, which can't answer anything.
_EMBEDDING_FAMILIES = frozenset({"bert", "nomic-bert", "xlm-roberta", "bge", "snowflake"})


def _is_chat_model(entry: _OllamaModel, name: str) -> bool:
    family = entry.details.family if entry.details and entry.details.family else ""
    return "embed" not in name.lower() and family.lower() not in _EMBEDDING_FAMILIES


class AIClient:
    """One connection to a provider, which asks for a model's answer or lists its models."""

    def __init__(
        self,
        connection: Connection,
        *,
        version: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._connection = connection
        self._http = httpx.Client(
            timeout=TIMEOUT,
            transport=transport,
            headers={"User-Agent": f"Cashcove/{version}"},
        )

    def __enter__(self) -> "AIClient":
        return self

    def __exit__(self, *_: object) -> None:
        self._http.close()

    # ---- Models -----------------------------------------------------------------------

    def models(self) -> list[ModelChoice]:
        """The models an Ollama server offers, which are the ones that can chat. The hosted
        providers' models are the catalog's."""
        provider = self._connection.provider
        if provider not in {AIProvider.OLLAMA_LOCAL, AIProvider.OLLAMA_CLOUD}:
            raise AIError(errors.BAD_REQUEST, "Only Ollama has models to fetch.")
        data = self._request("GET", f"{self._ollama_base()}/api/tags", headers=self._headers())
        try:
            tags = _OllamaTags.model_validate(data)
        except ValidationError as error:
            raise AIError(errors.UNREADABLE, "Ollama's list of models couldn't be read.") from error
        found: dict[str, ModelChoice] = {}
        for entry in tags.models:
            name = entry.name or entry.model
            if name and _is_chat_model(entry, name):
                size = entry.details.parameter_size if entry.details else None
                found[name] = ModelChoice(name, name, note=size)
        return sorted(found.values(), key=lambda choice: choice.id.lower())

    # ---- Answers ----------------------------------------------------------------------

    def complete(
        self, model: str, system: str, messages: Sequence[Message], *, max_tokens: int
    ) -> Completion:
        """The model's answer to a conversation, where `system` says how to answer."""
        match self._connection.provider:
            case AIProvider.ANTHROPIC:
                return self._anthropic(model, system, messages, max_tokens)
            case AIProvider.OPENAI:
                return self._openai(model, system, messages, max_tokens)
            case _:
                return self._ollama(model, system, messages, max_tokens)

    def _ollama(
        self, model: str, system: str, messages: Sequence[Message], max_tokens: int
    ) -> Completion:
        options: dict[str, int] = {"num_predict": max_tokens}
        if self._connection.provider == AIProvider.OLLAMA_LOCAL:
            options["num_ctx"] = OLLAMA_CONTEXT
        body = {
            "model": model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                *({"role": item.role, "content": item.content} for item in messages),
            ],
            "options": options,
        }
        data = self._request(
            "POST", f"{self._ollama_base()}/api/chat", headers=self._headers(), json=body
        )
        text = _text(_object(data.get("message")).get("content"))
        used = Tokens(_count(data.get("prompt_eval_count")), _count(data.get("eval_count")))
        if not text and data.get("done_reason") == "length":
            raise _out_of_room(used)
        return Completion(text, used)

    def _anthropic(
        self, model: str, system: str, messages: Sequence[Message], max_tokens: int
    ) -> Completion:
        body: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": item.role, "content": item.content} for item in messages],
        }
        choice = find_model(AIProvider.ANTHROPIC, model)
        if choice is not None and choice.effort is not None:
            body["output_config"] = {"effort": choice.effort}
        data = self._request(
            "POST",
            f"{ANTHROPIC_URL}/v1/messages",
            headers={
                "x-api-key": self._connection.api_key or "",
                "anthropic-version": ANTHROPIC_VERSION,
            },
            json=body,
        )
        usage = _object(data.get("usage"))
        used = Tokens(_count(usage.get("input_tokens")), _count(usage.get("output_tokens")))
        if data.get("stop_reason") == "refusal":
            raise _refused(used)
        blocks = [_object(block) for block in _items(data.get("content"))]
        text = "".join(_text(block.get("text")) for block in blocks if block.get("type") == "text")
        if not text and data.get("stop_reason") == "max_tokens":
            raise _out_of_room(used)
        return Completion(text, used)

    def _openai(
        self, model: str, system: str, messages: Sequence[Message], max_tokens: int
    ) -> Completion:
        body = {
            "model": model,
            "instructions": system,
            "input": [{"role": item.role, "content": item.content} for item in messages],
            "max_output_tokens": max_tokens,
            "store": False,
        }
        data = self._request(
            "POST",
            f"{OPENAI_URL}/v1/responses",
            headers={"Authorization": f"Bearer {self._connection.api_key or ''}"},
            json=body,
        )
        parts = [
            _object(part)
            for item in map(_object, _items(data.get("output")))
            if item.get("type") == "message"
            for part in _items(item.get("content"))
        ]
        usage = _object(data.get("usage"))
        # OpenAI says how much of the input came from its cache and how much went into it.
        details = _object(usage.get("input_tokens_details"))
        used = Tokens(
            _count(usage.get("input_tokens")),
            _count(usage.get("output_tokens")),
            _count(details.get("cached_tokens")),
            _count(details.get("cache_write_tokens")),
        )
        if any(part.get("type") == "refusal" for part in parts):
            raise _refused(used)
        text = "".join(
            _text(part.get("text")) for part in parts if part.get("type") == "output_text"
        )
        if not text and data.get("status") == "incomplete":
            raise _out_of_room(used)
        return Completion(text, used)

    # ---- The wire ---------------------------------------------------------------------

    def _ollama_base(self) -> str:
        if self._connection.provider == AIProvider.OLLAMA_CLOUD:
            return OLLAMA_CLOUD_URL
        return (self._connection.base_url or "").rstrip("/")

    def _headers(self) -> dict[str, str]:
        """Ollama's cloud wants its key as a bearer token; a server on the household's own
        computer wants nothing."""
        if self._connection.provider == AIProvider.OLLAMA_CLOUD and self._connection.api_key:
            return {"Authorization": f"Bearer {self._connection.api_key}"}
        return {}

    def _request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """The JSON object a provider answers with, or the AIError that says why it didn't."""
        try:
            with self._http.stream(method, url, headers=headers, json=json) as response:
                body = _read(response)
                status = response.status_code
        except httpx.TimeoutException as error:
            raise AIError(
                errors.UNREACHABLE, "The AI didn't answer in time. A slow model may need longer."
            ) from error
        except (httpx.TransportError, httpx.InvalidURL) as error:
            raise AIError(errors.UNREACHABLE, self._unreachable()) from error
        if status != 200:
            raise _failure(status, body)
        try:
            data = _json(body)
        except ValueError as error:
            raise AIError(errors.UNREADABLE, "The AI's answer couldn't be read.") from error
        if not isinstance(data, dict):
            raise AIError(errors.UNREADABLE, "The AI's answer couldn't be read.")
        return cast("dict[str, Any]", data)

    def _unreachable(self) -> str:
        if self._connection.provider == AIProvider.OLLAMA_LOCAL:
            return (
                f"Cashcove can't reach Ollama at {self._connection.base_url}. Check that it's "
                "running, and that its address is one the Cashcove container can reach: "
                "localhost there is the container itself."
            )
        return "Cashcove can't reach the AI provider. Check the server's internet connection."


def _read(response: httpx.Response) -> bytes:
    chunks: list[bytes] = []
    size = 0
    for chunk in response.iter_bytes():
        size += len(chunk)
        if size > MAX_BYTES:
            raise AIError(errors.UNREADABLE, "The AI's answer was too big to read.")
        chunks.append(chunk)
    return b"".join(chunks)


def _json(body: bytes) -> object:
    return json.loads(body)


def _object(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _items(value: object) -> list[object]:
    return cast("list[object]", value) if isinstance(value, list) else []


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _out_of_room(tokens: Tokens) -> AIError:
    return AIError(
        errors.EMPTY,
        "The AI ran out of room before it finished answering. Try again, or choose a model "
        "that answers more briefly.",
        tokens=tokens,
    )


def _refused(tokens: Tokens) -> AIError:
    return AIError(errors.REFUSED, "The AI declined to answer that.", tokens=tokens)


def _failure(status: int, body: bytes) -> AIError:
    """The AIError for an answer that says no. What the provider says about a key is never
    repeated, since it can hold part of it."""
    if status in {401, 403}:
        return AIError(
            errors.UNAUTHORIZED,
            "The provider didn't accept the key. Check it, and that it can use this model.",
        )
    if status == 429:
        return AIError(
            errors.RATE_LIMITED,
            "The provider says there have been too many requests, or the account is out of "
            "credit. Try again in a moment.",
        )
    detail = _provider_message(body)
    if status == 404:
        return AIError(
            errors.NOT_FOUND,
            "The provider doesn't have that model" + (f": {detail}" if detail else "."),
        )
    if status >= 500:
        return AIError(errors.PROVIDER_ERROR, "The AI provider had a problem. Try again later.")
    return AIError(
        errors.BAD_REQUEST,
        "The provider turned the request down" + (f": {detail}" if detail else "."),
    )


def _provider_message(body: bytes) -> str:
    """What a provider says went wrong, shortened: Anthropic nests it in ``error.message``,
    OpenAI too, and Ollama has ``error`` as the text itself."""
    try:
        data = _object(_json(body))
    except ValueError:
        return ""
    error = data.get("error")
    nested = _object(error)
    message = nested.get("message") if nested else error
    return " ".join(_text(message).split())[:200]
