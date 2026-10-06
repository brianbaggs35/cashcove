"""The AI providers Cashcove can use, and the models it offers for each.

The hosted providers' lists are kept to small, inexpensive models on purpose (no Opus, Fable,
Astra or Sol), and come from their official documentation as it was on 2026-10-06:

- Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
- OpenAI: https://developers.openai.com/api/docs/models and, for what is being shut down,
  https://developers.openai.com/api/docs/deprecations
- Ollama: https://docs.ollama.com/cloud (its models are whatever the server lists, so Ollama's
  are fetched rather than listed here)

Prices are the providers' list prices in US dollars per million tokens, which is also what a
token costs in millionths of a dollar: that's how a call's cost is worked out and stored.
Ollama's cloud prices are from https://ollama.com/pricing, which lists each cloud model by name.
"""

import datetime as dt
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.ai.tokens import Tokens
from app.models.ai import AIProvider

OLLAMA_CLOUD_URL = "https://ollama.com"
ANTHROPIC_URL = "https://api.anthropic.com"
OPENAI_URL = "https://api.openai.com"
# From inside Cashcove's container, "localhost" is the container itself. This name reaches the
# computer it runs on (docker-compose.yml maps it), which is where Ollama usually is.
OLLAMA_LOCAL_URL = "http://host.docker.internal:11434"


@dataclass(frozen=True)
class Price:
    """What a million tokens cost, in US dollars."""

    input: Decimal
    output: Decimal
    # Input read back from the provider's cache, where that costs less.
    cached: Decimal | None = None
    # What writing input to the cache costs, as a multiple of what the input does. OpenAI's
    # GPT-5.6 and later charge 1.25 times for it.
    cache_write: Decimal = Decimal(1)
    # Ollama Cloud charges less outside weekday business hours, for some of its models.
    off_peak: "Price | None" = None


@dataclass(frozen=True)
class ModelChoice:
    """One model someone can pick."""

    id: str
    name: str
    # A line of advice shown beside it, e.g. when the provider is shutting it down.
    note: str | None = None
    deprecated: bool = False
    # What it costs, or None where it isn't known.
    price: Price | None = None
    # How hard Anthropic's models think before answering; only some take it.
    effort: Literal["low", "medium"] | None = None


@dataclass(frozen=True)
class ProviderInfo:
    key: AIProvider
    name: str
    summary: str
    needs_key: bool
    needs_url: bool
    # Where Ollama is, to start from; the hosted providers' addresses are fixed.
    default_url: str | None
    # Where to make a key.
    key_url: str | None
    docs_url: str
    models: tuple[ModelChoice, ...]
    default_model: str | None


def _price(
    input: str,
    output: str,
    cached: str | None = None,
    *,
    cache_write: str = "1",
    off_peak: Price | None = None,
) -> Price:
    return Price(
        Decimal(input),
        Decimal(output),
        None if cached is None else Decimal(cached),
        Decimal(cache_write),
        off_peak,
    )


ANTHROPIC_MODELS = (
    ModelChoice(
        "claude-haiku-4-5-20251001",
        "Claude Haiku 4.5",
        note="The fastest and cheapest. Anthropic won't retire it before October 15, 2026.",
        price=_price("1", "5"),
    ),
    ModelChoice(
        "claude-sonnet-5-5",
        "Claude Sonnet 5.5",
        note="The best mix of speed and intelligence.",
        price=_price("2", "10"),
        effort="medium",
    ),
)

OPENAI_MODELS = (
    ModelChoice(
        "gpt-6-luna",
        "GPT-6 Luna",
        note="The most efficient GPT-6, for focused, high-volume work.",
        price=_price("0.1", "0.5", "0.01", cache_write="1.25"),
    ),
    ModelChoice(
        "gpt-5.6-luna",
        "GPT-5.6 Luna",
        note="Cost-sensitive work on GPT-5.6.",
        price=_price("0.2", "1.2", "0.02", cache_write="1.25"),
    ),
    ModelChoice(
        "gpt-5.4-mini",
        "GPT-5.4 mini",
        price=_price("0.75", "4.5", "0.075"),
    ),
    ModelChoice(
        "gpt-5.4-nano",
        "GPT-5.4 nano",
        note="OpenAI is shutting it down on April 1, 2027. Use GPT-6 Luna instead.",
        deprecated=True,
        price=_price("0.2", "1.25", "0.02"),
    ),
    ModelChoice(
        "gpt-5-mini",
        "GPT-5 mini",
        note="OpenAI is shutting it down on December 11, 2026. Use GPT-5.6 Luna instead.",
        deprecated=True,
        price=_price("0.25", "2", "0.025"),
    ),
    ModelChoice(
        "gpt-5-nano",
        "GPT-5 nano",
        note="OpenAI is shutting it down on December 11, 2026. Use GPT-5.6 Luna instead.",
        deprecated=True,
        price=_price("0.05", "0.4", "0.005"),
    ),
)

PROVIDERS = (
    ProviderInfo(
        key=AIProvider.OLLAMA_LOCAL,
        name="Ollama (on your computer)",
        summary="Runs models on your own hardware, so nothing leaves your network and nothing "
        "is billed.",
        needs_key=False,
        needs_url=True,
        default_url=OLLAMA_LOCAL_URL,
        key_url=None,
        docs_url="https://docs.ollama.com/api/introduction",
        models=(),
        default_model=None,
    ),
    ProviderInfo(
        key=AIProvider.OLLAMA_CLOUD,
        name="Ollama Cloud",
        summary="Ollama's hosted models (ollama.com), with a key from your Ollama account.",
        needs_key=True,
        needs_url=False,
        default_url=None,
        key_url="https://ollama.com/settings/keys",
        docs_url="https://docs.ollama.com/cloud",
        models=(),
        default_model=None,
    ),
    ProviderInfo(
        key=AIProvider.ANTHROPIC,
        name="Anthropic",
        summary="Claude, with an API key from the Claude Console.",
        needs_key=True,
        needs_url=False,
        default_url=None,
        key_url="https://platform.claude.com/settings/keys",
        docs_url="https://platform.claude.com/docs/en/about-claude/models/overview",
        models=ANTHROPIC_MODELS,
        default_model="claude-haiku-4-5-20251001",
    ),
    ProviderInfo(
        key=AIProvider.OPENAI,
        name="OpenAI",
        summary="GPT, with an API key from the OpenAI platform.",
        needs_key=True,
        needs_url=False,
        default_url=None,
        key_url="https://platform.openai.com/api-keys",
        docs_url="https://developers.openai.com/api/docs/models",
        models=OPENAI_MODELS,
        default_model="gpt-6-luna",
    ),
)

_BY_KEY = {provider.key: provider for provider in PROVIDERS}


def provider_info(provider: AIProvider) -> ProviderInfo:
    return _BY_KEY[provider]


def find_model(provider: AIProvider, model_id: str) -> ModelChoice | None:
    """A model from a hosted provider's list, or None for one that isn't on it."""
    return next((model for model in _BY_KEY[provider].models if model.id == model_id), None)


# Ollama Cloud's prices (https://ollama.com/pricing), by model name. A name without a tag stands
# for the model at any size, as "gemma4" does for "gemma4:31b". The two DeepSeek models cost half
# as much off-peak.
OLLAMA_CLOUD_PRICES = {
    "deepseek-v4.1-flash": _price(
        "0.30", "1.20", "0.006", off_peak=_price("0.15", "0.60", "0.003")
    ),
    "deepseek-v4-pro": _price("1.32", "3.96", "0.044", off_peak=_price("0.66", "1.98", "0.022")),
    "gemma4": _price("0.14", "0.40", "0.05"),
    "glm-5.3": _price("1.40", "4.40", "0.26"),
    "glm-5.3-flash": _price("0.15", "0.50", "0.03"),
    "glm-5.2": _price("1.40", "4.40", "0.26"),
    "gpt-oss:120b": _price("0.15", "0.60", "0.014"),
    "gpt-oss:20b": _price("0.07", "0.30", "0.035"),
    "kimi-k3": _price("3.00", "15.00", "0.30"),
    "kimi-k2.7-code": _price("0.95", "4.00", "0.19"),
    "kimi-k2.6": _price("0.95", "4.00", "0.16"),
    "minimax-m3": _price("0.60", "2.40", "0.12"),
    "minimax-m2.7": _price("0.30", "1.20", "0.06"),
    "mistral-large-3": _price("0.50", "1.50"),
    "nemotron-3-nano": _price("0.06", "0.24"),
    "nemotron-3-super": _price("0.015", "0.60", "0.015"),
    "nemotron-3-ultra": _price("0.10", "3.00", "0.10"),
}  # fmt: skip


def cloud_price(model_id: str) -> Price | None:
    """What an Ollama Cloud model costs, by its name with or without its tag, or None for one
    its price list doesn't have."""
    return OLLAMA_CLOUD_PRICES.get(model_id) or OLLAMA_CLOUD_PRICES.get(model_id.partition(":")[0])


def is_off_peak(when: dt.datetime) -> bool:
    """Whether it's outside Ollama Cloud's peak hours: 12:00 to 18:00 UTC on weekdays."""
    when = when.astimezone(dt.UTC)
    return when.weekday() >= 5 or not 12 <= when.hour < 18


def price_of(provider: AIProvider, model_id: str, when: dt.datetime) -> Price | None:
    """What the model costs at that time, or None where that isn't known."""
    if provider == AIProvider.OLLAMA_CLOUD:
        price = cloud_price(model_id)
        if price is not None and price.off_peak is not None and is_off_peak(when):
            return price.off_peak
        return price
    choice = find_model(provider, model_id)
    return None if choice is None else choice.price


def cost_micros(
    provider: AIProvider, model_id: str, tokens: Tokens, when: dt.datetime
) -> int | None:
    """What an answer cost, in millionths of a US dollar, at the provider's list price.

    Input read from the provider's cache costs less, and input written to it can cost more, as
    OpenAI's prompt caching guide works it out. Ollama on the household's own computer costs
    nothing. A model with no known price has no cost (None).
    """
    if provider == AIProvider.OLLAMA_LOCAL:
        return 0
    price = price_of(provider, model_id, when)
    if price is None:
        return None
    # Cached and written tokens are parts of the input, so they can't add up to more than it.
    cached_tokens = min(tokens.cached, tokens.input)
    written_tokens = min(tokens.written, tokens.input - cached_tokens)
    ordinary = tokens.input - cached_tokens - written_tokens
    cached_rate = price.input if price.cached is None else price.cached
    micros = (
        ordinary * price.input
        + cached_tokens * cached_rate
        + written_tokens * price.input * price.cache_write
        + tokens.output * price.output
    )
    return int(micros.quantize(Decimal(1), rounding=ROUND_HALF_UP))
