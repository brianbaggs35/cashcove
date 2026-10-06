"""AI: which provider the household uses, what it has been asked, and what it recommends.

The provider's key is kept encrypted, and nothing here holds account information: a review
only ever stores which category it would give a transaction, and a usage row only counts tokens.
"""

import datetime as dt
import uuid
from enum import StrEnum

from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UTCDateTime, enum_type, utcnow

SET_NULL = "SET NULL"
SINGLETON_ID = 1


class AIProvider(StrEnum):
    """Where the household's AI runs."""

    # Ollama on the household's own computer, which needs an address and no key.
    OLLAMA_LOCAL = "ollama_local"
    # Ollama's own cloud (ollama.com), with a key.
    OLLAMA_CLOUD = "ollama_cloud"
    ANTHROPIC = "anthropic"
    OPENAI = "openai"


class AIPurpose(StrEnum):
    """What a request to the AI was for."""

    CHAT = "chat"
    # A second opinion on how transactions are sorted.
    REVIEW = "review"
    # The Test button in Settings.
    TEST = "test"


class ReviewSource(StrEnum):
    """What started a review."""

    MANUAL = "manual"
    # A statement file that was just imported.
    IMPORT = "import"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class RecommendationStatus(StrEnum):
    OPEN = "open"
    APPLIED = "applied"
    DISMISSED = "dismissed"


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AISettings(TimestampMixin, Base):
    """The household's AI provider, as one row."""

    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=SINGLETON_ID)
    provider: Mapped[AIProvider] = mapped_column(enum_type(AIProvider, "ai_provider"))
    # Only Ollama on the household's computer has an address; the others are fixed.
    base_url: Mapped[str | None] = mapped_column(String(255))
    model: Mapped[str] = mapped_column(String(120))
    # The provider's key, encrypted with the app secret. It's never logged or sent to the
    # browser, and it isn't kept for a provider that doesn't use one.
    api_key: Mapped[str | None] = mapped_column(String(1024))
    # Whether a statement file that was just imported gets a second opinion from the AI.
    review_imports: Mapped[bool] = mapped_column(default=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete=SET_NULL)
    )


class AIReview(Base):
    """One pass of the AI over transactions, to second-guess how they were sorted."""

    __tablename__ = "ai_reviews"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    source: Mapped[ReviewSource] = mapped_column(enum_type(ReviewSource, "review_source"))
    status: Mapped[ReviewStatus] = mapped_column(
        enum_type(ReviewStatus, "review_status"), default=ReviewStatus.PENDING, index=True
    )
    # The file whose transactions it reviewed, while that import still exists.
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("file_imports.id", ondelete=SET_NULL), index=True
    )
    # Who started it, and what answered: kept as they were, whatever is set up later.
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete=SET_NULL)
    )
    provider: Mapped[AIProvider] = mapped_column(enum_type(AIProvider, "ai_provider"))
    model: Mapped[str] = mapped_column(String(120))
    # How many transactions it set out to look at, and how many it has.
    total: Mapped[int] = mapped_column(default=0)
    reviewed: Mapped[int] = mapped_column(default=0)
    # Why it stopped early, in words for people.
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    started_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime())
    finished_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime())


class AIRecommendation(Base):
    """A category the AI would give a transaction instead of the one it has. It's only ever a
    suggestion: nothing changes until someone applies it."""

    __tablename__ = "ai_recommendations"
    __table_args__ = (
        # Something suggested, and then dismissed, isn't suggested again.
        UniqueConstraint(
            "transaction_id",
            "suggested_category_id",
            name="uq_ai_recommendations_transaction_id_suggested_category_id",
        ),
        Index("ix_ai_recommendations_status_created_at", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    review_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ai_reviews.id", ondelete="CASCADE"), index=True
    )
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    # What the transaction had when it was reviewed, which says whether it still has it.
    current_category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete=SET_NULL)
    )
    suggested_category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE")
    )
    confidence: Mapped[Confidence] = mapped_column(enum_type(Confidence, "ai_confidence"))
    # Why, in the AI's words. Shown as plain text and never trusted.
    reason: Mapped[str] = mapped_column(String(300))
    status: Mapped[RecommendationStatus] = mapped_column(
        enum_type(RecommendationStatus, "recommendation_status"),
        default=RecommendationStatus.OPEN,
    )
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow)
    decided_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime())
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete=SET_NULL)
    )


class AIUsage(Base):
    """One answer from the AI, and what it cost in tokens."""

    __tablename__ = "ai_usage"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    provider: Mapped[AIProvider] = mapped_column(enum_type(AIProvider, "ai_provider"))
    model: Mapped[str] = mapped_column(String(120))
    purpose: Mapped[AIPurpose] = mapped_column(enum_type(AIPurpose, "ai_purpose"))
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    # What it cost in millionths of a US dollar at the provider's list price, or none where the
    # provider doesn't charge per token (an Ollama cloud plan) and it can't be worked out.
    cost_micros: Mapped[int | None] = mapped_column(BigInteger())
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete=SET_NULL))
    review_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_reviews.id", ondelete=SET_NULL), index=True
    )
