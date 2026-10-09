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
    AutomationDirection,
    AutomationMatch,
    AutomationScope,
    Confidence,
    RecommendationStatus,
    ReviewSource,
    ReviewStatus,
    TransactionSource,
)
from app.schemas.automations import OverlappingAutomation
from app.schemas.budget import Day
from app.schemas.fields import STRICT, AmountOut
from app.schemas.transactions import Sort

# A statement's PDF can be this big, and base64 takes four characters for every three bytes.
MAX_STATEMENT_BYTES = 10 * 1024 * 1024
MAX_STATEMENT_CONTENT = -(-MAX_STATEMENT_BYTES // 3) * 4

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
    conversation_id: uuid.UUID | None = None
    # The date where the person is, which "this month" and "last week" are measured from.
    today: Day | None = None

    @model_validator(mode="after")
    def _ends_with_a_question(self) -> Self:
        if self.messages[-1].role != "user":
            raise PydanticCustomError("question", "The last message has to be a question.")
        return self


class ProposalStepOut(BaseModel):
    """One change in a proposal, in Cashcove's words and never the AI's: what it will do, with
    the details people need to decide."""

    tool: str
    title: str
    summary: str
    details: list[str]


# `expired` is a pending proposal nobody decided on in time, which can't be approved any more.
ProposalState = Literal["pending", "approved", "rejected", "expired"]


class ProposalOut(BaseModel):
    """Changes the AI proposed, and where they stand. Nothing in one has happened until it is
    approved."""

    id: uuid.UUID
    state: ProposalState
    title: str
    message: str
    steps: list[ProposalStepOut]
    created_at: dt.datetime
    expires_at: dt.datetime
    decided_at: dt.datetime | None
    note: str | None
    # What each change did, once approved.
    results: list[str]


class ProposalReject(BaseModel):
    """Turning proposed changes down, and optionally why, which the AI is told so it can try
    again."""

    model_config = STRICT

    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None

    @model_validator(mode="after")
    def _blank_is_none(self) -> Self:
        self.note = self.note or None
        return self


class ProposalQuery(BaseModel):
    model_config = STRICT

    state: ProposalState | None = None
    page: Annotated[int, Field(ge=1, le=100_000)] = 1
    page_size: Annotated[int, Field(ge=1, le=100)] = 20


class ProposalPage(BaseModel):
    items: list[ProposalOut]
    total: int
    page: int
    page_size: int


class ChatOut(BaseModel):
    reply: str
    conversation_id: uuid.UUID
    # Changes the AI would make, which wait for an admin to approve or turn them down.
    proposal: ProposalOut | None = None


class ChatConversationOut(BaseModel):
    id: uuid.UUID
    title: str
    created_at: dt.datetime
    updated_at: dt.datetime
    message_count: int


class ChatConversationMessageOut(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    proposal: ProposalOut | None = None


class ChatConversationDetailOut(ChatConversationOut):
    messages: list[ChatConversationMessageOut]


class StatementIn(BaseModel):
    """A PDF statement to read the transactions off."""

    model_config = STRICT

    file_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    # The PDF itself, base64-encoded.
    content: Annotated[str, StringConstraints(min_length=1, max_length=MAX_STATEMENT_CONTENT)]


class StatementRowOut(BaseModel):
    """One transaction as the AI read it, which may need checking."""

    # Its number among the rows, counted from 1.
    line: int
    date: dt.date | None
    payee: str
    # Positive for money in, negative for money out.
    amount: AmountOut | None
    # Why it should be checked, in words for people.
    note: str | None


class StatementOut(BaseModel):
    file_name: str
    rows: list[StatementRowOut]
    # The account the statement seems to be for, from the last digits and the bank it shows. That
    # was worked out here, and none of it was sent to the AI.
    account_id: uuid.UUID | None
    # How many lines looked like transactions but weren't.
    skipped: int


class SearchIn(BaseModel):
    """What someone typed to find transactions, in their own words."""

    model_config = STRICT

    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    # The date where the person is, which "last month" and "in March" are measured from.
    today: Day | None = None


class SearchFilters(BaseModel):
    """The Transactions tab's filters that a question came to, which the tab applies as if they
    had been chosen by hand. Nothing here says what any transaction is."""

    # Words to look for in payees, descriptions, notes and categories.
    q: str
    account_ids: list[uuid.UUID]
    category_ids: list[uuid.UUID]
    uncategorized: bool
    start: dt.date | None
    end: dt.date | None
    direction: Literal["in", "out"] | None
    status: Literal["pending", "posted"] | None
    sources: list[TransactionSource]
    # How big the amount is, whichever way the money went.
    min_amount: AmountOut | None
    max_amount: AmountOut | None
    sort: Sort | None


class SearchOut(BaseModel):
    filters: SearchFilters
    # Parts of the question that couldn't be used, in words for people.
    ignored: list[str]


class AutomationSuggestionOut(BaseModel):
    """An automation the AI suggests, from a category someone chose for the same payee again and
    again, to be checked, changed and created: nothing has been. It is what an automation is made
    of, which the form for a new one takes as it stands."""

    # Which of the suggestions it is, for as long as the answer is on the screen.
    ref: str
    name: str
    payees: list[str]
    match: AutomationMatch
    direction: AutomationDirection
    category_id: uuid.UUID
    apply_to: AutomationScope
    # The AI's reason for wording it so, in a sentence.
    reason: str
    # What it's drawn from, worked out here: how many times that category was chosen for what it
    # matches, and the last time.
    choices: int
    last_chosen: dt.date
    # A few of the payees it matches, as the household's transactions have them.
    examples: list[str]
    # How many transactions with no category it would sort now, and how many it matches that
    # were put in some other category, which it leaves alone.
    sorts_now: int
    elsewhere: int
    # Other automations that give some of the same transactions a category, and win since they
    # are older.
    overlaps: list[OverlappingAutomation]


class AutomationSuggestions(BaseModel):
    suggestions: list[AutomationSuggestionOut]
    # How many payees had a category chosen for them often enough to be looked at. With none,
    # there was nothing to ask the AI.
    considered: int


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
