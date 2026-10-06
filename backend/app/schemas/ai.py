"""Request and response models for the AI tab and Settings > AI.

The provider's key only ever goes in: no response carries it, only whether one is saved.
"""

import datetime as dt
import re
import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.ai.catalog import find_model, provider_info
from app.ai.providers import normalize_url
from app.models import (
    AIProvider,
    AIPurpose,
    Confidence,
    RecommendationStatus,
    ReviewSource,
    ReviewStatus,
)
from app.schemas.budget import Day
from app.schemas.fields import STRICT, AmountOut

# A key is a single token. Providers' are well under this, and nothing here is ever logged.
ApiKey = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=8, max_length=512, pattern=r"^\S+$")
]
# Ollama's model names look like "llama3.2:3b" or "library/model:tag".
OLLAMA_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$")
ModelName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Address = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]


def _address(provider: AIProvider, base_url: str | None) -> str | None:
    """The Ollama address, checked, or none for providers that have a fixed one."""
    if not provider_info(provider).needs_url:
        return None
    if not base_url:
        raise PydanticCustomError("address_required", "Enter the address of your Ollama server.")
    try:
        return normalize_url(base_url)
    except ValueError as error:
        raise PydanticCustomError("address", "{reason}", {"reason": str(error)}) from error


class ModelOut(BaseModel):
    id: str
    name: str
    note: str | None
    deprecated: bool
    # What a million tokens in and out cost in US dollars, where the provider's price list has
    # the model (so not Ollama on the household's own computer, which costs nothing).
    input_price: str | None = None
    output_price: str | None = None


class ProviderOut(BaseModel):
    key: AIProvider
    name: str
    summary: str
    needs_key: bool
    needs_url: bool
    default_url: str | None
    key_url: str | None
    docs_url: str
    default_model: str | None
    # The models to choose from, or none for Ollama, whose models are fetched.
    models: list[ModelOut]


class AISettingsOut(BaseModel):
    """How AI is set up, without the key."""

    configured: bool
    provider: AIProvider | None
    model: str | None
    base_url: str | None
    api_key_set: bool
    review_imports: bool


class AISettingsIn(BaseModel):
    """Leave the key out to keep the one saved for the same provider."""

    model_config = STRICT

    provider: AIProvider
    model: ModelName
    base_url: Address | None = None
    api_key: ApiKey | None = None
    review_imports: bool = True

    @model_validator(mode="after")
    def _is_usable(self) -> Self:
        self.base_url = _address(self.provider, self.base_url)
        if provider_info(self.provider).models:
            if find_model(self.provider, self.model) is None:
                raise PydanticCustomError("unknown_model", "Choose one of the listed models.")
        elif not OLLAMA_MODEL.fullmatch(self.model):
            raise PydanticCustomError("model_name", "That isn't a model name Ollama uses.")
        if not provider_info(self.provider).needs_key:
            self.api_key = None
        return self


class ConnectionIn(BaseModel):
    """Settings as they are in the form, before they're saved, to try out."""

    model_config = STRICT

    provider: AIProvider
    base_url: Address | None = None
    api_key: ApiKey | None = None
    model: ModelName | None = None

    @model_validator(mode="after")
    def _is_usable(self) -> Self:
        self.base_url = _address(self.provider, self.base_url)
        if (
            self.model is not None
            and provider_info(self.provider).models
            and find_model(self.provider, self.model) is None
        ):
            raise PydanticCustomError("unknown_model", "Choose one of the listed models.")
        return self


class ModelsOut(BaseModel):
    models: list[ModelOut]


class ConnectionTestOut(BaseModel):
    ok: bool
    # What worked, or what to fix.
    message: str


class ChatTurn(BaseModel):
    model_config = STRICT

    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ChatIn(BaseModel):
    """A conversation so far, ending with the question to answer."""

    model_config = STRICT

    messages: Annotated[list[ChatTurn], Field(min_length=1, max_length=24)]
    # The date where the person is, which "this month" and "last week" are measured from.
    today: Day | None = None

    @model_validator(mode="after")
    def _ends_with_a_question(self) -> Self:
        if self.messages[-1].role != "user":
            raise PydanticCustomError("question", "The last message has to be a question.")
        return self


class ChatOut(BaseModel):
    reply: str


class ReviewIn(BaseModel):
    """Which transactions to get a second opinion on: the ones nobody chose a category for."""

    model_config = STRICT

    scope: Literal["uncategorized", "recent"] = "recent"
    # For "recent": how many days back.
    days: Annotated[int, Field(ge=1, le=365)] = 30
    limit: Annotated[int, Field(ge=5, le=200)] = 50
    # The date where the person is, which "the last 30 days" is counted back from.
    today: Day | None = None


class ReviewOut(BaseModel):
    id: uuid.UUID
    source: ReviewSource
    status: ReviewStatus
    import_id: uuid.UUID | None
    file_name: str | None
    provider: AIProvider
    model: str
    total: int
    reviewed: int
    error: str | None
    # What it found, and what's become of it.
    open: int
    applied: int
    dismissed: int
    created_by: str | None
    created_at: dt.datetime
    started_at: dt.datetime | None
    finished_at: dt.datetime | None


class RecommendationOut(BaseModel):
    id: uuid.UUID
    review_id: uuid.UUID
    transaction_id: uuid.UUID
    date: dt.date
    payee: str
    amount: AmountOut
    currency: str
    current_category_id: uuid.UUID | None
    suggested_category_id: uuid.UUID
    confidence: Confidence
    reason: str
    status: RecommendationStatus
    created_at: dt.datetime


class RecommendationCounts(BaseModel):
    open: int
    applied: int
    dismissed: int


class RecommendationPage(BaseModel):
    items: list[RecommendationOut]
    total: int
    page: int
    page_size: int
    counts: RecommendationCounts


class RecommendationQuery(BaseModel):
    model_config = STRICT

    status: RecommendationStatus = RecommendationStatus.OPEN
    review_id: uuid.UUID | None = None
    page: Annotated[int, Field(ge=1, le=100_000)] = 1
    page_size: Annotated[int, Field(ge=1, le=200)] = 50


class RecommendationIds(BaseModel):
    model_config = STRICT

    ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=200)]


class RecommendationResult(BaseModel):
    """How many changed, and how many were left because the transaction had moved on."""

    changed: int
    skipped: int


class UsageTotals(BaseModel):
    calls: int
    input_tokens: int
    output_tokens: int
    # In millionths of a US dollar, at the provider's list price.
    cost_micros: int


class UsageDay(BaseModel):
    day: dt.date
    calls: int
    tokens: int
    cost_micros: int


class UsageGroup(BaseModel):
    """The usage of one model, or for one purpose."""

    key: str
    label: str
    provider: AIProvider | None
    purpose: AIPurpose | None
    calls: int
    input_tokens: int
    output_tokens: int
    cost_micros: int


class UsageOut(BaseModel):
    """What the AI has been used for and what it cost, by list price, in UTC days."""

    first_day: dt.date
    last_day: dt.date
    totals: UsageTotals
    # The month so far, whatever range is shown.
    this_month: UsageTotals
    days: list[UsageDay]
    models: list[UsageGroup]
    purposes: list[UsageGroup]
    # Calls with no known cost, because the provider charges by plan (Ollama Cloud).
    unpriced_calls: int
