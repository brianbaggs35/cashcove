"""How the household's AI is set up, and the one way anything asks it something.

Every request goes through ``Gateway``, which checks that nothing that looks like account
information is in it before it leaves, and records what it cost afterwards.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

import httpx2 as httpx
from fastapi import status
from sqlalchemy.orm import Session

from app.ai import errors
from app.ai.catalog import cost_micros, provider_info
from app.ai.errors import AIError
from app.ai.privacy import Protected
from app.ai.providers import AIClient, Connection, Message, timeout_of
from app.ai.tokens import Tokens
from app.auth.crypto import DecryptionError
from app.auth.deps import ApiError
from app.auth.service import ai_box
from app.config import Settings
from app.models import AIProvider, AIPurpose, AISettings, AIUsage, User
from app.models.ai import SINGLETON_ID
from app.models.base import utcnow
from app.schemas.ai import AISettingsIn, AISettingsOut


@dataclass(frozen=True)
class AIConfig:
    """A provider that's ready to be asked, and the model to ask."""

    connection: Connection
    model: str

    @property
    def provider(self) -> AIProvider:
        return self.connection.provider


def load_row(db: Session) -> AISettings | None:
    return db.get(AISettings, SINGLETON_ID)


def _decrypted(settings: Settings, row: AISettings | None) -> str | None:
    """The saved key, or None when there isn't one or it was sealed with another secret."""
    if row is None or not row.api_key:
        return None
    try:
        return ai_box(settings).decrypt(row.api_key)
    except DecryptionError:
        return None


def active(db: Session, settings: Settings) -> AIConfig | None:
    """The provider and model to ask, or None until AI is set up (with a key, where one's
    needed)."""
    row = load_row(db)
    if row is None:
        return None
    key = _decrypted(settings, row)
    if provider_info(row.provider).needs_key and key is None:
        return None
    return AIConfig(Connection(row.provider, row.base_url, key), row.model)


def require(db: Session, settings: Settings) -> AIConfig:
    config = active(db, settings)
    if config is None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            errors.NOT_CONFIGURED,
            "AI isn't set up yet. An admin can choose a provider in Settings > AI.",
        )
    return config


def settings_out(db: Session, settings: Settings) -> AISettingsOut:
    row = load_row(db)
    if row is None:
        return AISettingsOut(
            configured=False,
            provider=None,
            model=None,
            base_url=None,
            api_key_set=False,
            review_imports=True,
        )
    return AISettingsOut(
        configured=active(db, settings) is not None,
        provider=row.provider,
        model=row.model,
        base_url=row.base_url,
        api_key_set=_decrypted(settings, row) is not None,
        review_imports=row.review_imports,
    )


def save(db: Session, settings: Settings, body: AISettingsIn, user: User) -> None:
    """Saves the provider, keeping the key already saved for it unless a new one is given. A key
    isn't kept for another provider, or for one that doesn't use one."""
    row = load_row(db)
    sealed = None
    if provider_info(body.provider).needs_key:
        if body.api_key:
            sealed = ai_box(settings).encrypt(body.api_key)
        elif row is not None and row.provider == body.provider and _decrypted(settings, row):
            sealed = row.api_key
        else:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "key_required",
                "Enter the provider's API key.",
            )
    row = row or AISettings(id=SINGLETON_ID)
    row.provider = body.provider
    row.model = body.model
    row.base_url = body.base_url
    row.api_key = sealed
    row.review_imports = body.review_imports
    row.updated_by_id = user.id
    db.add(row)
    db.commit()


def clear(db: Session) -> None:
    """Turns AI off and forgets the key."""
    row = load_row(db)
    if row is not None:
        db.delete(row)
        db.commit()


def draft_connection(
    db: Session,
    settings: Settings,
    provider: AIProvider,
    base_url: str | None,
    api_key: str | None,
) -> Connection:
    """The connection settings as they are in the form: with the saved key when the form
    leaves it blank for the provider it was saved for."""
    info = provider_info(provider)
    row = load_row(db)
    same = row is not None and row.provider == provider
    key = api_key or (_decrypted(settings, row) if same else None)
    if info.needs_key and key is None:
        raise AIError(errors.UNAUTHORIZED, "Enter the provider's API key first.")
    return Connection(
        provider, base_url if info.needs_url else None, key if info.needs_key else None
    )


class Gateway:
    """Asks the household's AI something, after checking the request and before counting its
    cost."""

    def __init__(
        self,
        db: Session,
        settings: Settings,
        config: AIConfig,
        protected: Protected,
        *,
        transport: httpx.BaseTransport | None = None,
        user_id: uuid.UUID | None = None,
        review_id: uuid.UUID | None = None,
    ) -> None:
        self._db = db
        self._settings = settings
        self._config = config
        self._protected = protected
        self._transport = transport
        self._user_id = user_id
        self._review_id = review_id

    def ask(
        self,
        purpose: AIPurpose,
        instructions: str,
        data: str,
        messages: Sequence[Message],
        *,
        max_tokens: int,
        timeout: float | None = None,
    ) -> str:
        """The model's answer. `instructions` is Cashcove's own wording and `data` is what it's
        drawn from the household's records, which, like the conversation, is checked first: if
        anything in them looks like account information, nothing is sent. It waits `timeout`
        seconds for the answer, or as long as it usually does."""
        self._protected.ensure_clean(data, *(message.content for message in messages))
        system = f"{instructions}\n\n{data}" if data else instructions
        with AIClient(
            self._config.connection,
            version=self._settings.version,
            transport=self._transport,
            timeout=timeout_of(timeout),
        ) as client:
            try:
                answer = client.complete(
                    self._config.model, system, messages, max_tokens=max_tokens
                )
            except AIError as error:
                self._record(purpose, error.tokens)
                raise
        self._record(purpose, answer.tokens)
        return answer.text

    def _record(self, purpose: AIPurpose, tokens: Tokens) -> None:
        """Counts the tokens an answer used, when it used any, and what they cost."""
        if not tokens.used:
            return
        provider, model, now = self._config.provider, self._config.model, utcnow()
        self._db.add(
            AIUsage(
                created_at=now,
                provider=provider,
                model=model,
                purpose=purpose,
                input_tokens=tokens.input,
                output_tokens=tokens.output,
                cost_micros=cost_micros(provider, model, tokens, now),
                user_id=self._user_id,
                review_id=self._review_id,
            )
        )
        self._db.commit()
