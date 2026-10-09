"""ORM models. Import every model module here so Alembic autogenerate sees it."""

from app.models.account import LIABILITY_TYPES, Account, AccountSource, AccountType
from app.models.ai import (
    AIConversation,
    AIProposal,
    AIProvider,
    AIPurpose,
    AIRecommendation,
    AIReview,
    AISettings,
    AIUsage,
    Confidence,
    ProposalStatus,
    RecommendationStatus,
    ReviewSource,
    ReviewStatus,
)
from app.models.alerts import (
    AlertChannel,
    AlertDelivery,
    AlertSettings,
    AlertState,
    AlertType,
    SMTPTransport,
)
from app.models.app_settings import AppSettings
from app.models.audit import AuditEvent
from app.models.auth import (
    AuthChallenge,
    Invitation,
    LoginThrottle,
    Passkey,
    PasswordReset,
    RecoveryCode,
    UserSession,
)
from app.models.automation import (
    Automation,
    AutomationDirection,
    AutomationMatch,
    AutomationScope,
)
from app.models.base import Base, TimestampMixin
from app.models.budget import (
    Budget,
    BudgetAmount,
    BudgetExclusion,
    BudgetKind,
    BudgetLink,
    BudgetPeriod,
)
from app.models.category import Category, CategoryGroup, CategoryKind
from app.models.connection import (
    Connection,
    ConnectionProvider,
    ConnectionStatus,
    ConnectionSync,
    HistoryStatus,
    SyncTrigger,
)
from app.models.exchange_rate import ExchangeRate, ExchangeRateSpan
from app.models.imports import FileFormat, FileImport, ImportProfile
from app.models.subscription import PaymentFrequency, RecurringKind, Subscription
from app.models.transaction import Transaction, TransactionSource
from app.models.user import Role, User

__all__ = [
    "LIABILITY_TYPES",
    "AIConversation",
    "AIProposal",
    "AIProvider",
    "AIPurpose",
    "AIRecommendation",
    "AIReview",
    "AISettings",
    "AIUsage",
    "Account",
    "AccountSource",
    "AccountType",
    "AlertChannel",
    "AlertDelivery",
    "AlertSettings",
    "AlertState",
    "AlertType",
    "AppSettings",
    "AuditEvent",
    "AuthChallenge",
    "Automation",
    "AutomationDirection",
    "AutomationMatch",
    "AutomationScope",
    "Base",
    "Budget",
    "BudgetAmount",
    "BudgetExclusion",
    "BudgetKind",
    "BudgetLink",
    "BudgetPeriod",
    "Category",
    "CategoryGroup",
    "CategoryKind",
    "Confidence",
    "Connection",
    "ConnectionProvider",
    "ConnectionStatus",
    "ConnectionSync",
    "ExchangeRate",
    "ExchangeRateSpan",
    "FileFormat",
    "FileImport",
    "HistoryStatus",
    "ImportProfile",
    "Invitation",
    "LoginThrottle",
    "Passkey",
    "PasswordReset",
    "PaymentFrequency",
    "ProposalStatus",
    "RecommendationStatus",
    "RecoveryCode",
    "RecurringKind",
    "ReviewSource",
    "ReviewStatus",
    "Role",
    "SMTPTransport",
    "Subscription",
    "SyncTrigger",
    "TimestampMixin",
    "Transaction",
    "TransactionSource",
    "User",
    "UserSession",
]
