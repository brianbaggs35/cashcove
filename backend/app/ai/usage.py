"""What the AI has been used for, and what that cost.

Every answer is counted when it comes back (see ``service.Gateway``): its tokens, and its cost at
the provider's list price. Days are UTC days. Ollama on the household's own computer costs
nothing, and Ollama Cloud is billed by plan, so its tokens are counted without a cost.
"""

import datetime as dt
from collections.abc import Iterator
from datetime import UTC
from typing import Any

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.orm import Session

from app.ai.catalog import find_model, provider_info
from app.models import AIProvider, AIPurpose, AIUsage
from app.schemas.ai import UsageDay, UsageGroup, UsageOut, UsageTotals

PURPOSES = {
    AIPurpose.CHAT: "Questions in the AI tab",
    AIPurpose.REVIEW: "Second opinions on categories",
    AIPurpose.TEST: "Connection tests",
}


# The most days a range covers, which is the API's limit. It bounds the loop that lists them, so
# what was asked for only decides where the list stops.
MAX_DAYS = 366


def _each_day(first: dt.date, last: dt.date) -> Iterator[dt.date]:
    """Every day from `first` to `last`."""
    for offset in range(MAX_DAYS):
        day = first + dt.timedelta(days=offset)
        if day > last:
            break
        yield day


def _midnight(day: dt.date) -> dt.datetime:
    return dt.datetime.combine(day, dt.time.min, tzinfo=UTC)


def _measures() -> list[ColumnElement[Any]]:
    """Calls, tokens in, tokens out and cost, as whole numbers even where nothing was used."""
    return [
        func.count(),
        func.coalesce(func.sum(AIUsage.input_tokens), 0),
        func.coalesce(func.sum(AIUsage.output_tokens), 0),
        func.coalesce(func.sum(AIUsage.cost_micros), 0),
    ]


def _between(
    query: Select[*tuple[Any, ...]], first: dt.date, last: dt.date
) -> Select[*tuple[Any, ...]]:
    return query.where(
        AIUsage.created_at >= _midnight(first),
        AIUsage.created_at < _midnight(last + dt.timedelta(days=1)),
    )


def _totals(db: Session, first: dt.date, last: dt.date) -> UsageTotals:
    query = _between(select(*_measures()), first, last)
    calls, tokens_in, tokens_out, cost = db.execute(query).one()
    return UsageTotals(
        calls=calls, input_tokens=tokens_in, output_tokens=tokens_out, cost_micros=cost
    )


def _model_label(provider: AIProvider, model: str) -> str:
    choice = find_model(provider, model)
    return f"{choice.name if choice else model} ({provider_info(provider).name})"


def usage(db: Session, days: int, today: dt.date) -> UsageOut:
    """The AI's use in the `days` days up to `today`."""
    first = today - dt.timedelta(days=days - 1)
    day = func.date(func.timezone("UTC", AIUsage.created_at))
    per_day = {
        found: (calls, tokens_in + tokens_out, cost)
        for found, calls, tokens_in, tokens_out, cost in db.execute(
            _between(select(day, *_measures()), first, today).group_by(day)
        )
    }
    models = db.execute(
        _between(select(AIUsage.provider, AIUsage.model, *_measures()), first, today)
        .group_by(AIUsage.provider, AIUsage.model)
        .order_by(func.sum(AIUsage.cost_micros).desc().nulls_last(), AIUsage.model)
    ).all()
    purposes = db.execute(
        _between(select(AIUsage.purpose, *_measures()), first, today)
        .group_by(AIUsage.purpose)
        .order_by(func.count().desc(), AIUsage.purpose)
    ).all()
    unpriced = db.scalar(
        _between(select(func.count()).where(AIUsage.cost_micros.is_(None)), first, today)
    )
    return UsageOut(
        first_day=first,
        last_day=today,
        totals=_totals(db, first, today),
        this_month=_totals(db, today.replace(day=1), today),
        days=[
            UsageDay(
                day=found,
                calls=per_day.get(found, (0, 0, 0))[0],
                tokens=per_day.get(found, (0, 0, 0))[1],
                cost_micros=per_day.get(found, (0, 0, 0))[2],
            )
            for found in _each_day(first, today)
        ],
        models=[
            UsageGroup(
                key=model,
                label=_model_label(provider, model),
                provider=provider,
                purpose=None,
                calls=calls,
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                cost_micros=cost,
            )
            for provider, model, calls, tokens_in, tokens_out, cost in models
        ],
        purposes=[
            UsageGroup(
                key=purpose,
                label=PURPOSES[purpose],
                provider=None,
                purpose=purpose,
                calls=calls,
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                cost_micros=cost,
            )
            for purpose, calls, tokens_in, tokens_out, cost in purposes
        ],
        unpriced_calls=unpriced or 0,
    )
