"""AI: choosing a provider, asking questions about the household's money, second opinions on how
transactions are sorted, and what it all cost.

Everyone in the household can read what's set up (never the key), ask questions and see the
suggestions and the cost; only admins change the provider or the key, start a review, and apply
or dismiss what it suggests. Every request to a provider is made here, by the server, so a key
never reaches the browser and the browser never talks to a provider.
"""

import base64
import binascii
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Query, status

from app.ai import automations, chat, errors, reviews, search, service, statements
from app.ai.catalog import PROVIDERS, ModelChoice, Price, cloud_price, find_model, provider_info
from app.ai.deps import AISessions, AITransport
from app.ai.errors import AIError
from app.ai.privacy import Protected
from app.ai.providers import AIClient, Message
from app.ai.usage import usage
from app.auth.deps import AdminAuth, ApiError, AppSettings, CurrentAuth, Db
from app.finance.exchange_rates import ExchangeRates
from app.models import AIProvider, AIPurpose, ReviewSource
from app.models.base import utcnow
from app.schemas.ai import (
    AISettingsIn,
    AISettingsOut,
    AutomationSuggestions,
    ChatIn,
    ChatOut,
    ConnectionIn,
    ConnectionTestOut,
    ModelOut,
    ModelsOut,
    ProviderOut,
    RecommendationIds,
    RecommendationPage,
    RecommendationQuery,
    RecommendationResult,
    ReviewIn,
    ReviewOut,
    SearchIn,
    SearchOut,
    StatementIn,
    StatementOut,
    StatementRowOut,
    UsageOut,
)
from app.schemas.budget import Day

router = APIRouter(prefix="/ai", tags=["ai"])

# A request that was refused before it was sent, or can't be sent until AI is set up, is the
# caller's to fix; anything else went wrong with the provider.
STATUS = {
    errors.NOT_CONFIGURED: status.HTTP_409_CONFLICT,
    errors.BLOCKED: status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def _model_out(model: ModelChoice, price: Price | None) -> ModelOut:
    return ModelOut(
        id=model.id,
        name=model.name,
        note=model.note,
        deprecated=model.deprecated,
        input_price=None if price is None else format(price.input, "f"),
        output_price=None if price is None else format(price.output, "f"),
    )


def _problem(error: AIError) -> ApiError:
    return ApiError(STATUS.get(error.code, status.HTTP_502_BAD_GATEWAY), error.code, error.message)


@router.get("/providers")
def read_providers(auth: CurrentAuth) -> list[ProviderOut]:
    """The providers that can be chosen, and the models each offers, which for Ollama are
    fetched from the server."""
    return [
        ProviderOut(
            key=provider.key,
            name=provider.name,
            summary=provider.summary,
            needs_key=provider.needs_key,
            needs_url=provider.needs_url,
            default_url=provider.default_url,
            key_url=provider.key_url,
            docs_url=provider.docs_url,
            default_model=provider.default_model,
            models=[_model_out(model, model.price) for model in provider.models],
        )
        for provider in PROVIDERS
    ]


@router.get("/settings")
def read_settings(auth: CurrentAuth, db: Db, settings: AppSettings) -> AISettingsOut:
    return service.settings_out(db, settings)


@router.put("/settings")
def update_settings(
    body: AISettingsIn, auth: AdminAuth, db: Db, settings: AppSettings
) -> AISettingsOut:
    """Chooses the provider and model. The key is kept encrypted, and kept when it's left out
    for the provider it was saved for."""
    service.save(db, settings, body, auth.user)
    return service.settings_out(db, settings)


@router.delete("/settings", status_code=status.HTTP_204_NO_CONTENT)
def remove_settings(auth: AdminAuth, db: Db) -> None:
    """Turns AI off and forgets the key."""
    service.clear(db)


@router.post("/models")
def fetch_models(
    body: ConnectionIn, auth: AdminAuth, db: Db, settings: AppSettings, transport: AITransport
) -> ModelsOut:
    """The models to choose from. For Ollama, asks the server (the address and key can be ones
    not saved yet); the others have a short list."""
    info = provider_info(body.provider)
    if info.models:
        return ModelsOut(models=[_model_out(model, model.price) for model in info.models])
    try:
        connection = service.draft_connection(
            db, settings, body.provider, body.base_url, body.api_key
        )
        with AIClient(connection, version=settings.version, transport=transport) as client:
            found = client.models()
    except AIError as error:
        raise _problem(error) from error
    # Ollama Cloud's models have prices (its own list); a server on the household's own
    # computer costs nothing.
    cloud = body.provider == AIProvider.OLLAMA_CLOUD
    return ModelsOut(
        models=[_model_out(model, cloud_price(model.id) if cloud else None) for model in found]
    )


@router.post("/test")
def test_connection(
    body: ConnectionIn, auth: AdminAuth, db: Db, settings: AppSettings, transport: AITransport
) -> ConnectionTestOut:
    """Tries the provider as the form has it, without saving: with a model, by asking it to say
    OK; for Ollama without one, by listing what it has."""
    info = provider_info(body.provider)
    model = body.model or info.default_model
    try:
        connection = service.draft_connection(
            db, settings, body.provider, body.base_url, body.api_key
        )
        if model is None:
            with AIClient(connection, version=settings.version, transport=transport) as client:
                count = len(client.models())
            return ConnectionTestOut(
                ok=True, message=f"Connected. {info.name} has {count} models to choose from."
            )
        gateway = service.Gateway(
            db,
            settings,
            service.AIConfig(connection, model),
            Protected.of([]),
            transport=transport,
            user_id=auth.user.id,
        )
        gateway.ask(
            AIPurpose.TEST,
            "Reply with the single word OK.",
            "",
            [Message("user", "Reply with OK.")],
            max_tokens=256,
        )
    except AIError as error:
        return ConnectionTestOut(ok=False, message=error.message)
    choice = find_model(body.provider, model)
    return ConnectionTestOut(ok=True, message=f"{choice.name if choice else model} answered.")


@router.post("/chat")
def ask(
    body: ChatIn,
    auth: CurrentAuth,
    db: Db,
    settings: AppSettings,
    rates: ExchangeRates,
    transport: AITransport,
) -> ChatOut:
    """Answers the last question in a conversation from the household's records, with account
    numbers, account names and bank names kept out of everything sent."""
    config = service.require(db, settings)
    try:
        reply = chat.answer(
            db,
            settings,
            config,
            rates,
            transport,
            auth.user,
            body.messages,
            body.today or utcnow().date(),
        )
    except AIError as error:
        raise _problem(error) from error
    return ChatOut(reply=reply)


@router.post("/search")
def find_transactions(
    body: SearchIn, auth: CurrentAuth, db: Db, settings: AppSettings, transport: AITransport
) -> SearchOut:
    """Turns what someone typed into the Transactions tab's filters. It only says which filters, for
    the tab to apply, and finds nothing itself, so everyone who can see transactions can ask.
    The accounts it names are found here and no account or bank name is sent to the AI."""
    config = service.require(db, settings)
    try:
        return search.find(
            db,
            settings,
            config,
            transport,
            auth.user,
            body.query,
            body.today or utcnow().date(),
        )
    except AIError as error:
        raise _problem(error) from error


@router.post("/automation-suggestions")
def suggest_automations(
    auth: AdminAuth, db: Db, settings: AppSettings, transport: AITransport
) -> AutomationSuggestions:
    """Automations for the payees the household has put in the same category again and again,
    worded by the AI and tried on its transactions. None is created: they are for an admin to
    check, change and create like any other. Nothing is asked of the AI when there are none."""
    config = service.require(db, settings)
    try:
        return automations.suggest(db, settings, config, transport, auth.user)
    except AIError as error:
        raise _problem(error) from error


@router.post("/statements")
def read_statement(
    body: StatementIn, auth: AdminAuth, db: Db, settings: AppSettings, transport: AITransport
) -> StatementOut:
    """Reads a PDF statement for the transactions on it, which nothing adds: they're checked and
    corrected first, and then imported like any file's. The PDF is read here, and the AI is
    only sent its transactions, with nothing in them that names an account, a bank or a person."""
    config = service.require(db, settings)
    try:
        data = base64.b64decode(body.content, validate=True)
    except binascii.Error:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unreadable_statement",
            "The file didn't arrive in one piece. Choose it again.",
        ) from None
    try:
        reading = statements.read(db, settings, config, transport, auth.user, data)
    except statements.StatementProblem as problem:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "unreadable_statement", problem.message
        ) from None
    except AIError as error:
        raise _problem(error) from error
    return StatementOut(
        file_name=body.file_name,
        rows=[
            StatementRowOut(
                line=row.line,
                date=row.date,
                payee=row.payee,
                amount=row.amount,
                note=row.note,
            )
            for row in reading.rows
        ],
        account_id=reading.account.id if reading.account else None,
        skipped=reading.skipped,
    )


@router.get("/reviews")
def list_reviews(auth: CurrentAuth, db: Db) -> list[ReviewOut]:
    """The latest second opinions, newest first, with what each found."""
    return reviews.reviews(db)


@router.post("/reviews", status_code=status.HTTP_201_CREATED)
def start_review(
    body: ReviewIn,
    auth: AdminAuth,
    db: Db,
    settings: AppSettings,
    background: BackgroundTasks,
    transport: AITransport,
    sessions: AISessions,
) -> ReviewOut:
    """Starts a second opinion on transactions nobody chose a category for. It carries on after
    this answers; read it again to see how far it has got."""
    config = service.require(db, settings)
    ids = reviews.manual_ids(db, body, body.today or utcnow().date())
    review = reviews.create(db, config, source=ReviewSource.MANUAL, user=auth.user, ids=ids)
    if ids:
        background.add_task(reviews.run, sessions, settings, transport, review.id, ids)
    return reviews.reviews(db, review.id)[0]


@router.get("/reviews/{review_id}")
def read_review(review_id: uuid.UUID, auth: CurrentAuth, db: Db) -> ReviewOut:
    found = reviews.reviews(db, review_id)
    if not found:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "That review doesn't exist anymore.")
    return found[0]


@router.get("/recommendations")
def list_recommendations(
    query: Annotated[RecommendationQuery, Query()], auth: CurrentAuth, db: Db
) -> RecommendationPage:
    """What the AI suggested, with how many are waiting, applied and dismissed."""
    return reviews.recommendations(db, query)


@router.post("/recommendations/apply")
def apply_recommendations(body: RecommendationIds, auth: AdminAuth, db: Db) -> RecommendationResult:
    """Gives the transactions the categories suggested, as if someone chose them."""
    return reviews.apply(db, auth.user, body.ids)


@router.post("/recommendations/dismiss")
def dismiss_recommendations(
    body: RecommendationIds, auth: AdminAuth, db: Db
) -> RecommendationResult:
    """Turns suggestions down, so they aren't made again."""
    return reviews.dismiss(db, auth.user, body.ids)


@router.get("/usage")
def read_usage(
    auth: CurrentAuth,
    db: Db,
    days: Annotated[int, Query(ge=1, le=366)] = 30,
    today: Annotated[Day | None, Query(description="The last day to count.")] = None,
) -> UsageOut:
    """What the AI was asked and what it cost, a day at a time, by model and by what it was for."""
    return usage(db, days, today or utcnow().date())
