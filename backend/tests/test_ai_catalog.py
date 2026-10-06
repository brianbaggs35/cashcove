import datetime as dt

import pytest

from app.ai.catalog import (
    ANTHROPIC_MODELS,
    OLLAMA_CLOUD_PRICES,
    OPENAI_MODELS,
    PROVIDERS,
    cloud_price,
    cost_micros,
    find_model,
    is_off_peak,
    provider_info,
)
from app.ai.tokens import Tokens
from app.models import AIProvider

# A Wednesday in the middle of the day UTC, which is peak time for Ollama Cloud.
PEAK = dt.datetime(2026, 10, 7, 14, 0, tzinfo=dt.UTC)

LARGE = ("opus", "fable", "mythos", "astra", "sol", "terra", "pro", "codex")


def test_every_provider_is_offered_once() -> None:
    assert [provider.key for provider in PROVIDERS] == list(AIProvider)
    assert provider_info(AIProvider.OPENAI).name == "OpenAI"


def test_only_the_small_models_asked_for_are_offered() -> None:
    assert [model.id for model in ANTHROPIC_MODELS] == [
        "claude-haiku-4-5-20251001",
        "claude-sonnet-5-5",
    ]
    assert [model.id for model in OPENAI_MODELS] == [
        "gpt-6-luna",
        "gpt-5.6-luna",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5-mini",
        "gpt-5-nano",
    ]
    for model in (*ANTHROPIC_MODELS, *OPENAI_MODELS):
        assert not any(word in model.id for word in LARGE), model.id


def test_gpt_6_luna_is_the_default_for_openai_and_haiku_4_5_for_anthropic() -> None:
    assert provider_info(AIProvider.OPENAI).default_model == "gpt-6-luna"
    assert provider_info(AIProvider.ANTHROPIC).default_model == "claude-haiku-4-5-20251001"


def test_every_default_is_one_of_the_models() -> None:
    for provider in PROVIDERS:
        if provider.models:
            assert provider.default_model in {model.id for model in provider.models}
        else:
            assert provider.default_model is None


def test_models_being_shut_down_say_so() -> None:
    deprecated = {model.id for model in OPENAI_MODELS if model.deprecated}
    assert deprecated == {"gpt-5.4-nano", "gpt-5-mini", "gpt-5-nano"}
    assert all(find_model(AIProvider.OPENAI, name).note for name in deprecated)  # type: ignore[union-attr]


def test_ollama_needs_an_address_or_a_key_and_the_others_a_key() -> None:
    assert provider_info(AIProvider.OLLAMA_LOCAL).needs_url
    assert not provider_info(AIProvider.OLLAMA_LOCAL).needs_key
    assert provider_info(AIProvider.OLLAMA_CLOUD).needs_key
    assert not provider_info(AIProvider.OLLAMA_CLOUD).needs_url
    assert provider_info(AIProvider.ANTHROPIC).needs_key
    assert provider_info(AIProvider.OPENAI).needs_key


def test_a_model_not_on_the_list_isnt_found() -> None:
    assert find_model(AIProvider.ANTHROPIC, "claude-opus-5-5") is None
    assert find_model(AIProvider.OPENAI, "gpt-6-astra") is None
    assert find_model(AIProvider.OLLAMA_LOCAL, "llama3.2:3b") is None


@pytest.mark.parametrize(
    ("provider", "model", "tokens_in", "tokens_out", "micros"),
    [
        # $2 and $10 a million tokens.
        (AIProvider.ANTHROPIC, "claude-sonnet-5-5", 1_000_000, 1_000_000, 12_000_000),
        (AIProvider.ANTHROPIC, "claude-haiku-4-5-20251001", 1000, 200, 2000),
        # $0.10 and $0.50 a million tokens.
        (AIProvider.OPENAI, "gpt-6-luna", 10_000, 2_000, 2000),
        (AIProvider.OPENAI, "gpt-5.4-mini", 1_000_000, 0, 750_000),
        (AIProvider.OPENAI, "gpt-5-nano", 0, 1_000_000, 400_000),
        # A fraction of a millionth rounds to the nearest whole one.
        (AIProvider.OPENAI, "gpt-5-nano", 9, 0, 0),
        (AIProvider.OPENAI, "gpt-5-nano", 10, 0, 1),
    ],
)
def test_a_calls_cost_follows_the_list_price(
    provider: AIProvider, model: str, tokens_in: int, tokens_out: int, micros: int
) -> None:
    assert cost_micros(provider, model, Tokens(tokens_in, tokens_out), PEAK) == micros


def test_input_read_from_the_cache_costs_the_cached_rate() -> None:
    # GPT-6 Luna: $0.10 in, $0.01 cached, $0.50 out. 800k of the million were cached.
    tokens = Tokens(input=1_000_000, output=100_000, cached=800_000)

    assert cost_micros(AIProvider.OPENAI, "gpt-6-luna", tokens, PEAK) == (
        200_000 * 0.1 + 800_000 * 0.01 + 100_000 * 0.5
    )


def test_input_written_to_the_cache_costs_a_quarter_more_on_gpt_5_6_and_later() -> None:
    # OpenAI's prompt caching guide: ordinary + cached x its rate + written x 1.25.
    tokens = Tokens(input=1_000_000, output=0, cached=100_000, written=300_000)

    luna = cost_micros(AIProvider.OPENAI, "gpt-6-luna", tokens, PEAK)
    older = cost_micros(AIProvider.OPENAI, "gpt-5.4-mini", tokens, PEAK)

    assert luna == round(600_000 * 0.1 + 100_000 * 0.01 + 300_000 * 0.1 * 1.25)
    # Earlier models don't charge extra for a write.
    assert older == round(600_000 * 0.75 + 100_000 * 0.075 + 300_000 * 0.75)


def test_cached_and_written_tokens_are_parts_of_the_input_and_cant_add_up_to_more() -> None:
    # 10 tokens of input can't have had 100 of them cached: 10 at $0.01 is a tenth of a cent
    # of a millionth, which is nothing.
    assert cost_micros(AIProvider.OPENAI, "gpt-6-luna", Tokens(10, 0, cached=100), PEAK) == 0
    # A million tokens of input with all of it cached and 300k more written: the written
    # can only be what is left, which is none.
    assert cost_micros(
        AIProvider.OPENAI,
        "gpt-6-luna",
        Tokens(1_000_000, 0, cached=1_000_000, written=300_000),
        PEAK,
    ) == round(1_000_000 * 0.01)


def test_a_model_with_no_cached_rate_charges_the_input_rate_for_cached_input() -> None:
    # Ollama Cloud's mistral-large-3 has no cached price: $0.50 in.
    tokens = Tokens(input=1_000_000, output=0, cached=500_000)

    assert cost_micros(AIProvider.OLLAMA_CLOUD, "mistral-large-3", tokens, PEAK) == 500_000


def test_ollama_on_your_own_computer_costs_nothing() -> None:
    assert cost_micros(AIProvider.OLLAMA_LOCAL, "llama3.2:3b", Tokens(5000, 900), PEAK) == 0


@pytest.mark.parametrize(
    ("model", "micros"),
    [
        # Priced by name, whatever its size.
        ("gemma4:31b", 140_000 + 400_000),
        ("gemma4:2b", 140_000 + 400_000),
        ("gemma4", 140_000 + 400_000),
        # gpt-oss has a price for each size.
        ("gpt-oss:120b", 150_000 + 600_000),
        ("gpt-oss:20b", 70_000 + 300_000),
        ("kimi-k3", 3_000_000 + 15_000_000),
        ("nemotron-3-super:latest", 15_000 + 600_000),
    ],
)
def test_ollama_cloud_is_priced_by_its_own_price_list(model: str, micros: int) -> None:
    assert cost_micros(AIProvider.OLLAMA_CLOUD, model, Tokens(1_000_000, 1_000_000), PEAK) == micros


def test_a_cloud_model_not_on_ollamas_price_list_has_no_cost() -> None:
    assert cost_micros(AIProvider.OLLAMA_CLOUD, "gpt-oss:latest", Tokens(5000, 900), PEAK) is None
    assert cloud_price("brand-new:1b") is None


def test_every_ollama_cloud_model_on_its_price_list_has_a_price() -> None:
    assert len(OLLAMA_CLOUD_PRICES) == 17
    for name, price in OLLAMA_CLOUD_PRICES.items():
        assert price.input > 0, name
        assert price.output > 0, name
        assert cloud_price(name) is price


def test_two_cloud_models_cost_half_as_much_off_peak() -> None:
    night = dt.datetime(2026, 10, 7, 3, 0, tzinfo=dt.UTC)
    tokens = Tokens(1_000_000, 1_000_000)

    assert cost_micros(AIProvider.OLLAMA_CLOUD, "deepseek-v4.1-flash", tokens, PEAK) == 1_500_000
    assert cost_micros(AIProvider.OLLAMA_CLOUD, "deepseek-v4.1-flash", tokens, night) == 750_000
    assert cost_micros(AIProvider.OLLAMA_CLOUD, "deepseek-v4-pro", tokens, PEAK) == 5_280_000
    assert cost_micros(AIProvider.OLLAMA_CLOUD, "deepseek-v4-pro", tokens, night) == 2_640_000
    # The others cost the same at any time.
    assert cost_micros(AIProvider.OLLAMA_CLOUD, "gemma4:31b", tokens, night) == 540_000


@pytest.mark.parametrize(
    ("when", "off_peak"),
    [
        # Peak is 12:00 to 18:00 UTC on weekdays, so these are all off-peak:
        (dt.datetime(2026, 10, 7, 11, 59, tzinfo=dt.UTC), True),
        (dt.datetime(2026, 10, 7, 18, 0, tzinfo=dt.UTC), True),
        (dt.datetime(2026, 10, 7, 23, 0, tzinfo=dt.UTC), True),
        (dt.datetime(2026, 10, 3, 14, 0, tzinfo=dt.UTC), True),
        (dt.datetime(2026, 10, 4, 14, 0, tzinfo=dt.UTC), True),
        # and these are peak.
        (dt.datetime(2026, 10, 7, 12, 0, tzinfo=dt.UTC), False),
        (dt.datetime(2026, 10, 7, 17, 59, tzinfo=dt.UTC), False),
        (dt.datetime(2026, 10, 5, 15, 0, tzinfo=dt.UTC), False),
        (dt.datetime(2026, 10, 9, 15, 0, tzinfo=dt.UTC), False),
        # Whatever the time zone it's given in.
        (dt.datetime(2026, 10, 7, 9, 0, tzinfo=dt.timezone(dt.timedelta(hours=-5))), False),
    ],
)
def test_off_peak_is_outside_weekday_business_hours_utc(when: dt.datetime, off_peak: bool) -> None:
    assert is_off_peak(when) is off_peak


def test_a_model_with_no_price_has_no_cost() -> None:
    assert cost_micros(AIProvider.OPENAI, "gpt-9-imaginary", Tokens(5000, 900), PEAK) is None


def test_every_hosted_model_has_a_price_with_a_cached_rate() -> None:
    for model in (*ANTHROPIC_MODELS, *OPENAI_MODELS):
        assert model.price is not None, model.id
        assert model.price.input > 0
        assert model.price.output > model.price.input / 10
    for model in OPENAI_MODELS:
        assert model.price is not None, model.id
        assert model.price.cached is not None, model.id
        assert model.price.cached < model.price.input
