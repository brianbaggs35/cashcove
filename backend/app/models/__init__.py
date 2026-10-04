"""ORM models. Import every model module here so Alembic autogenerate sees it."""

from app.models.account import LIABILITY_TYPES, Account, AccountSource, AccountType
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
from app.models.automation import Automation, AutomationMatch, AutomationScope
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
from app.models.subscription import PaymentFrequency, Subscription
from app.models.transaction import Transaction, TransactionSource
from app.models.user import Role, User

__all__ = [
    "LIABILITY_TYPES",
    "Account",
    "AccountSource",
    "AccountType",
    "AppSettings",
    "AuditEvent",
    "AuthChallenge",
    "Automation",
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
    "RecoveryCode",
    "Role",
    "Subscription",
    "SyncTrigger",
    "TimestampMixin",
    "Transaction",
    "TransactionSource",
    "User",
    "UserSession",
]
