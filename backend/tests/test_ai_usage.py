"""What the AI has been used for and what it cost."""

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AIProvider, AIPurpose, AIUsage, User
from tests.helpers import error, sign_in

TODAY = dt.date(2026, 10, 6)


def at(day: dt.date, hour: int = 12) -> dt.datetime:
    return dt.datetime(day.year, day.month, day.day, hour, tzinfo=dt.UTC)


def add_usage(
    session: Session,
    when: dt.datetime,
    *,
    provider: AIProvider = AIProvider.OPENAI,
    model: str = "gpt-6-luna",
    purpose: AIPurpose = AIPurpose.CHAT,
    tokens_in: int = 1000,
    tokens_out: int = 200,
    cost: int | None = 200,
) -> None:
    session.add(
        AIUsage(
            created_at=when,
            provider=provider,
            model=model,
            purpose=purpose,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            cost_micros=cost,
        )
    )
    session.commit()


def usage(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/ai/usage", params={"today": TODAY.isoformat(), **params})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_nothing_used_is_all_zeros_with_every_day_in_the_range(admin_client: TestClient) -> None:
    result = usage(admin_client, days=7)

    assert (result["first_day"], result["last_day"]) == ("2026-09-30", "2026-10-06")
    assert result["totals"] == {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_micros": 0}
    assert result["this_month"] == result["totals"]
    assert [day["day"] for day in result["days"]] == [
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
    ]
    assert all(
        day == {"day": day["day"], "calls": 0, "tokens": 0, "cost_micros": 0}
        for day in result["days"]
    )
    assert (result["models"], result["purposes"], result["unpriced_calls"]) == ([], [], 0)


def test_a_days_calls_tokens_and_cost_add_up(admin_client: TestClient, session: Session) -> None:
    add_usage(session, at(TODAY), tokens_in=1000, tokens_out=200, cost=200)
    add_usage(session, at(TODAY, 23), tokens_in=500, tokens_out=100, cost=100)
    add_usage(session, at(TODAY - dt.timedelta(days=2)), tokens_in=2000, tokens_out=50, cost=300)

    result = usage(admin_client, days=7)

    assert result["totals"] == {
        "calls": 3,
        "input_tokens": 3500,
        "output_tokens": 350,
        "cost_micros": 600,
    }
    by_day = {day["day"]: day for day in result["days"]}
    assert by_day["2026-10-06"] == {
        "day": "2026-10-06",
        "calls": 2,
        "tokens": 1800,
        "cost_micros": 300,
    }
    assert by_day["2026-10-04"] == {
        "day": "2026-10-04",
        "calls": 1,
        "tokens": 2050,
        "cost_micros": 300,
    }
    assert by_day["2026-10-05"]["calls"] == 0


def test_days_are_utc_days(admin_client: TestClient, session: Session) -> None:
    add_usage(session, dt.datetime(2026, 10, 5, 23, 59, 59, tzinfo=dt.UTC))
    add_usage(session, dt.datetime(2026, 10, 6, 0, 0, 0, tzinfo=dt.UTC))

    by_day = {day["day"]: day["calls"] for day in usage(admin_client, days=3)["days"]}

    assert by_day == {"2026-10-04": 0, "2026-10-05": 1, "2026-10-06": 1}


def test_the_longest_range_lists_every_day_it_covers(admin_client: TestClient) -> None:
    days = usage(admin_client, days=366)["days"]

    assert len(days) == 366
    assert days[0]["day"] == "2025-10-06"
    assert days[-1]["day"] == "2026-10-06"


def test_only_the_days_in_the_range_count(admin_client: TestClient, session: Session) -> None:
    add_usage(session, at(TODAY - dt.timedelta(days=7)))
    add_usage(session, at(TODAY - dt.timedelta(days=6)))
    add_usage(session, at(TODAY + dt.timedelta(days=1)))

    assert usage(admin_client, days=7)["totals"]["calls"] == 1
    assert usage(admin_client, days=8)["totals"]["calls"] == 2


def test_the_month_so_far_is_shown_whatever_the_range(
    admin_client: TestClient, session: Session
) -> None:
    add_usage(session, at(dt.date(2026, 9, 30)), cost=1000)
    add_usage(session, at(dt.date(2026, 10, 1)), cost=10)
    add_usage(session, at(TODAY), cost=20)

    result = usage(admin_client, days=1)

    assert result["totals"]["cost_micros"] == 20
    assert result["this_month"] == {
        "calls": 2,
        "input_tokens": 2000,
        "output_tokens": 400,
        "cost_micros": 30,
    }


def test_each_model_and_each_purpose_is_counted_by_itself(
    admin_client: TestClient, session: Session
) -> None:
    add_usage(session, at(TODAY), model="gpt-6-luna", cost=200)
    add_usage(session, at(TODAY), model="gpt-6-luna", purpose=AIPurpose.REVIEW, cost=100)
    add_usage(
        session,
        at(TODAY),
        provider=AIProvider.ANTHROPIC,
        model="claude-sonnet-5-5",
        purpose=AIPurpose.REVIEW,
        tokens_in=4000,
        tokens_out=1000,
        cost=18000,
    )
    add_usage(session, at(TODAY), model="gpt-9-imaginary", purpose=AIPurpose.TEST, cost=1)

    result = usage(admin_client)

    assert [
        (model["label"], model["calls"], model["cost_micros"]) for model in result["models"]
    ] == [
        ("Claude Sonnet 5.5 (Anthropic)", 1, 18000),
        ("GPT-6 Luna (OpenAI)", 2, 300),
        ("gpt-9-imaginary (OpenAI)", 1, 1),
    ]
    sonnet = result["models"][0]
    assert (sonnet["key"], sonnet["provider"], sonnet["purpose"]) == (
        "claude-sonnet-5-5",
        "anthropic",
        None,
    )
    assert (sonnet["input_tokens"], sonnet["output_tokens"]) == (4000, 1000)
    assert [(item["key"], item["label"], item["calls"]) for item in result["purposes"]] == [
        ("review", "Second opinions on categories", 2),
        ("chat", "Questions in the AI tab", 1),
        ("test", "Connection tests", 1),
    ]
    assert result["purposes"][0]["purpose"] == "review"
    assert result["purposes"][0]["provider"] is None


def test_ollama_on_your_computer_costs_nothing_and_ollama_cloud_has_no_price_per_call(
    admin_client: TestClient, session: Session
) -> None:
    add_usage(session, at(TODAY), provider=AIProvider.OLLAMA_LOCAL, model="llama3.2:3b", cost=0)
    add_usage(session, at(TODAY), provider=AIProvider.OLLAMA_CLOUD, model="gemma4:31b", cost=None)
    add_usage(session, at(TODAY), provider=AIProvider.OLLAMA_CLOUD, model="gemma4:31b", cost=None)
    add_usage(session, at(TODAY), cost=50)

    result = usage(admin_client)

    assert result["unpriced_calls"] == 2
    assert result["totals"]["cost_micros"] == 50
    labels = {model["label"]: model for model in result["models"]}
    assert labels["gemma4:31b (Ollama Cloud)"]["calls"] == 2
    assert labels["gemma4:31b (Ollama Cloud)"]["cost_micros"] == 0
    assert labels["llama3.2:3b (Ollama (on your computer))"]["cost_micros"] == 0


def test_the_latest_day_is_today_unless_it_says(admin_client: TestClient, session: Session) -> None:
    add_usage(session, at(TODAY))

    default = admin_client.get("/api/ai/usage").json()

    assert default["last_day"] == dt.datetime.now(dt.UTC).date().isoformat()
    assert len(default["days"]) == 30


@pytest.mark.parametrize(
    "params",
    [{"days": 0}, {"days": 367}, {"days": "many"}, {"today": "2200-01-01"}, {"today": "soon"}],
)
def test_a_range_that_makes_no_sense_is_refused(
    admin_client: TestClient, params: dict[str, Any]
) -> None:
    assert admin_client.get("/api/ai/usage", params=params).status_code == 422


def test_viewers_can_see_the_cost(client: TestClient, viewer: User, session: Session) -> None:
    add_usage(session, at(TODAY))
    sign_in(client, viewer.email)

    assert usage(client)["totals"]["calls"] == 1


def test_usage_needs_someone_signed_in(client: TestClient) -> None:
    assert error(client.get("/api/ai/usage")) == "not_signed_in"
