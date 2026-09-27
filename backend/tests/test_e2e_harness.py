"""The end-to-end tests' harness: the baseline, resetting to it, and signing in without the form."""

import base64
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import coverage
import pytest
from coverage.data import CoverageData
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import tokens
from app.auth.service import load_preferences, totp_box
from app.config import Settings, get_settings
from app.db import get_session
from app.finance.categories import SUGGESTED
from app.models import (
    Account,
    AuditEvent,
    Category,
    CategoryGroup,
    Invitation,
    RecoveryCode,
    Transaction,
    TransactionSource,
    User,
    UserSession,
)
from e2e.api import current_coverage
from e2e.main import create_e2e_app
from tests.helpers import ORIGIN, add_user, error, sign_in, totp_code

BASELINE_EMAILS = {"alex@example.com", "jordan@example.com", "sam@example.com", "casey@example.com"}
RESET_AT = datetime(2026, 9, 20, 15, 30, tzinfo=UTC)


@pytest.fixture
def harness(settings: Settings, session: Session) -> FastAPI:
    def request_session() -> Iterator[Session]:
        try:
            yield session
        finally:
            session.rollback()

    app = create_e2e_app(settings)
    app.dependency_overrides[get_session] = request_session
    return app


@pytest.fixture
def e2e(harness: FastAPI) -> Iterator[TestClient]:
    with TestClient(harness, base_url=ORIGIN) as client:
        yield client


def count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_the_harness_refuses_to_run_outside_a_test_server(settings: Settings) -> None:
    production = settings.model_copy(update={"environment": "production"})
    with pytest.raises(RuntimeError, match="CASHCOVE_ENVIRONMENT=test"):
        create_e2e_app(production)


def test_the_harness_reads_its_settings_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # As the e2e image starts it: uvicorn e2e.main:create_e2e_app --factory
    monkeypatch.setenv("CASHCOVE_ENVIRONMENT", "test")
    get_settings.cache_clear()
    try:
        app = create_e2e_app()
    finally:
        get_settings.cache_clear()
    assert app.url_path_for("reset_to_baseline") == "/api/e2e/reset"


def test_reset_replaces_everything_with_the_baseline(
    e2e: TestClient, session: Session, settings: Settings
) -> None:
    stranger = add_user(session, settings, email="stranger@example.com", name="Pat Stranger")
    sign_in(e2e, stranger.email)
    assert count(session, UserSession) == 1

    response = e2e.post("/api/e2e/reset")

    assert response.status_code == 200
    assert set(session.scalars(select(User.email))) == BASELINE_EMAILS
    # Sessions, sign-in history and lockouts from earlier tests are gone.
    assert count(session, UserSession) == 0
    assert count(session, AuditEvent) == 0
    assert response.json() == e2e.get("/api/e2e/baseline").json()


def test_the_baseline_is_a_household_with_admins_a_viewer_and_a_turned_off_account(
    e2e: TestClient, session: Session, settings: Settings
) -> None:
    baseline = e2e.post("/api/e2e/reset").json()

    assert baseline["household_name"] == "The Rivera household"
    assert load_preferences(session).general.household_name == "The Rivera household"
    expected = {
        "admin": ("Alex Rivera", "admin", True),
        "two_step": ("Jordan Rivera", "admin", True),
        "viewer": ("Sam Rivera", "viewer", True),
        "deactivated": ("Casey Rivera", "viewer", False),
    }
    assert set(baseline["users"]) == set(expected)
    for key, (name, role, active) in expected.items():
        described = baseline["users"][key]
        stored = session.get(User, uuid.UUID(described["id"]))
        assert stored is not None
        assert (stored.name, stored.role.value, stored.is_active) == (name, role, active)
        assert (described["name"], described["role"], described["is_active"]) == (
            name,
            role,
            active,
        )
        assert stored.email == described["email"]
    # Newest members joined last, so lists have a stable order.
    joined = sorted(session.scalars(select(User)), key=lambda user: user.created_at)
    assert [user.name for user in joined] == [
        "Alex Rivera",
        "Jordan Rivera",
        "Sam Rivera",
        "Casey Rivera",
    ]
    jordan = baseline["users"]["two_step"]
    stored_jordan = session.get(User, uuid.UUID(jordan["id"]))
    assert stored_jordan is not None
    assert stored_jordan.totp_secret is not None
    assert totp_box(settings).decrypt(stored_jordan.totp_secret) == jordan["totp_secret"]
    assert len(jordan["recovery_codes"]) == count(session, RecoveryCode) == 10
    for key in ("admin", "viewer", "deactivated"):
        assert baseline["users"][key]["totp_secret"] is None
        assert baseline["users"][key]["recovery_codes"] == []


def test_baseline_accounts_sign_in_with_the_baseline_password(e2e: TestClient) -> None:
    users = e2e.post("/api/e2e/reset").json()["users"]

    for key in ("admin", "viewer"):
        user = users[key]
        result = sign_in(e2e, user["email"], user["password"])
        assert result["state"]["user"]["email"] == user["email"]

    casey = users["deactivated"]
    response = e2e.post(
        "/api/auth/sign-in", json={"email": casey["email"], "password": casey["password"]}
    )
    assert error(response) == "account_disabled"


def test_the_two_step_account_takes_its_codes(e2e: TestClient) -> None:
    jordan = e2e.post("/api/e2e/reset").json()["users"]["two_step"]

    assert sign_in(e2e, jordan["email"], jordan["password"])["status"] == "two_factor_required"
    response = e2e.post("/api/auth/sign-in/totp", json={"code": totp_code(jordan["totp_secret"])})
    assert response.json()["status"] == "signed_in"

    assert sign_in(e2e, jordan["email"], jordan["password"])["status"] == "two_factor_required"
    response = e2e.post(
        "/api/auth/sign-in/recovery-code", json={"code": jordan["recovery_codes"][0]}
    )
    assert response.json()["status"] == "signed_in"


def test_the_pending_invitation_opens_from_its_link(e2e: TestClient, session: Session) -> None:
    invitation = e2e.post("/api/e2e/reset").json()["invitations"]["pending"]

    assert invitation["link"] == f"{ORIGIN}/invite#{invitation['token']}"
    preview = e2e.post("/api/auth/invitations/preview", json={"token": invitation["token"]})
    assert preview.status_code == 200
    assert preview.json()["email"] == invitation["email"] == "riley@example.com"
    assert preview.json()["invited_by"] == "Alex Rivera"
    assert preview.json()["household_name"] == "The Rivera household"
    stored = session.get(Invitation, uuid.UUID(invitation["id"]))
    assert stored is not None
    assert (stored.expires_at - stored.created_at).days == 7


def test_the_baseline_has_accounts_kept_by_hand_a_linked_card_and_a_closed_one(
    e2e: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("e2e.api.utcnow", lambda: RESET_AT)

    accounts = e2e.post("/api/e2e/reset").json()["accounts"]

    expected = {
        "checking": ("Everyday checking", "checking", "manual", "2450.18", False),
        "savings": ("Rainy day fund", "savings", "manual", "12500.00", False),
        "card": ("Rewards Visa", "credit_card", "plaid", "-612.40", False),
        "closed": ("Old store card", "credit_card", "manual", "0.00", True),
    }
    assert set(accounts) == set(expected)
    stored: dict[str, Account] = {}
    for key, (name, kind, source, balance, closed) in expected.items():
        described = accounts[key]
        account = session.get(Account, uuid.UUID(described["id"]))
        assert account is not None
        stored[key] = account
        assert (
            described["name"],
            described["type"],
            described["source"],
            described["balance"],
            described["closed"],
        ) == (name, kind, source, balance, closed)
        assert (
            account.name,
            account.type.value,
            account.source.value,
            account.balance,
            account.is_closed,
        ) == (name, kind, source, Decimal(balance), closed)
        assert account.currency == described["currency"] == "USD"
        assert (account.institution, account.mask) == (described["institution"], described["mask"])
    card = stored["card"]
    assert card.external_id == "e2e-card"
    assert (card.credit_limit, card.available_balance) == (Decimal("5000.00"), Decimal("4387.60"))
    assert (accounts["card"]["credit_limit"], accounts["card"]["available_balance"]) == (
        "5000.00",
        "4387.60",
    )
    assert card.balance_updated_at == RESET_AT - timedelta(hours=3)
    assert stored["checking"].external_id is None
    assert stored["savings"].notes == accounts["savings"]["notes"] == "Three months of expenses"
    assert stored["closed"].closed_at == RESET_AT - timedelta(days=20)


def test_the_baseline_has_the_suggested_categories_with_the_same_ids_every_time(
    e2e: TestClient, session: Session
) -> None:
    baseline = e2e.post("/api/e2e/reset").json()

    suggested = {name for group in SUGGESTED for _, name in group.categories}
    assert set(baseline["categories"]) == suggested
    stored = {category.name: category for category in session.scalars(select(Category))}
    assert set(stored) == suggested
    for name, described in baseline["categories"].items():
        category = stored[name]
        group = baseline["category_groups"][described["group"]]
        assert str(category.id) == described["id"]
        assert str(category.group_id) == described["group_id"] == group["id"]
        assert category.emoji == described["emoji"]
    groups = {group.name: group for group in session.scalars(select(CategoryGroup))}
    assert {name: (str(group.id), group.kind.value) for name, group in groups.items()} == {
        name: (group["id"], group["kind"]) for name, group in baseline["category_groups"].items()
    }
    assert e2e.post("/api/e2e/reset").json()["categories"] == baseline["categories"]


def test_the_baseline_transactions_are_dated_back_from_the_reset(
    e2e: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("e2e.api.utcnow", lambda: RESET_AT)

    baseline = e2e.post("/api/e2e/reset").json()

    transactions = baseline["transactions"]
    assert len(transactions) == count(session, Transaction) == 11
    for key, described in transactions.items():
        stored = session.get(Transaction, uuid.UUID(described["id"]))
        assert stored is not None
        assert stored.date == (RESET_AT - timedelta(days=described["days_ago"])).date()
        account = baseline["accounts"][described["account"]]
        assert str(stored.account_id) == described["account_id"] == account["id"]
        assert stored.amount == Decimal(described["amount"])
        assert (
            stored.payee,
            stored.notes,
            stored.pending,
            stored.source.value,
            stored.original_description,
        ) == (
            described["payee"],
            described["notes"],
            described["pending"],
            described["source"],
            described["original_description"],
        )
        category = described["category"]
        category_id = None if category is None else baseline["categories"][category]["id"]
        assert described["category_id"] == category_id
        assert (None if stored.category_id is None else str(stored.category_id)) == category_id
        # Only the linked card's transactions came from its bank.
        from_bank = account["source"] == "plaid"
        assert (stored.source == TransactionSource.PLAID) == from_bank
        assert stored.external_id == (f"e2e-{key}" if from_bank else None)
    assert [key for key, item in transactions.items() if item["pending"]] == ["coffee"]
    assert [key for key, item in transactions.items() if item["category"] is None] == ["venmo"]


def test_people_see_the_baseline_money_through_the_api(e2e: TestClient) -> None:
    viewer = e2e.post("/api/e2e/reset").json()["users"]["viewer"]
    sign_in(e2e, viewer["email"], viewer["password"])

    accounts = e2e.get("/api/accounts").json()
    transactions = e2e.get("/api/transactions").json()
    groups = e2e.get("/api/categories").json()

    # Open accounts first.
    assert [account["name"] for account in accounts] == [
        "Everyday checking",
        "Rainy day fund",
        "Rewards Visa",
        "Old store card",
    ]
    assert transactions["total"] == 11
    assert [item["payee"] for item in transactions["items"][:2]] == ["Blue Bottle Coffee", "Venmo"]
    assert transactions["totals"] == [
        {"currency": "USD", "count": 11, "money_in": "2428.62", "money_out": "-2425.51"}
    ]
    assert len(groups) == len(SUGGESTED)
    assert sum(len(group["categories"]) for group in groups) == 37


def test_resets_reuse_the_hashed_password(e2e: TestClient, session: Session) -> None:
    hashes: list[str | None] = []
    for _ in range(2):
        e2e.post("/api/e2e/reset")
        hashes.append(
            session.scalar(select(User.password_hash).where(User.email == "alex@example.com"))
        )
    assert hashes[0] is not None
    assert hashes[0] == hashes[1]


def test_a_fresh_install_empties_the_database_and_offers_a_setup_code(
    e2e: TestClient, session: Session
) -> None:
    e2e.post("/api/e2e/reset")

    code = e2e.post("/api/e2e/fresh-install").json()["setup_code"]

    assert count(session, User) == 0
    assert e2e.get("/api/auth/session").json()["setup_required"] is True
    assert e2e.post("/api/auth/setup/check", json={"setup_code": code}).status_code == 204


def test_sessions_sign_a_browser_in_without_the_form(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    response = e2e.post("/api/e2e/sessions", json={"email": "Sam@Example.com"})

    assert response.status_code == 200
    state = response.json()
    assert state["user"]["email"] == "sam@example.com"
    assert state["session"]["remember"] is False
    assert state["session"]["csrf_token"]
    # The cookie it set is what signs the browser in.
    assert e2e.get("/api/auth/session").json()["user"]["role"] == "viewer"


def test_sessions_can_be_remembered(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    state = e2e.post("/api/e2e/sessions", json={"email": "alex@example.com", "remember": True})

    assert state.json()["session"]["remember"] is True


def test_sessions_need_an_account_that_is_on(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    assert error(e2e.post("/api/e2e/sessions", json={"email": "nobody@example.com"})) == (
        "not_found"
    )
    assert error(e2e.post("/api/e2e/sessions", json={"email": "casey@example.com"})) == (
        "account_disabled"
    )


def test_coverage_is_the_measurement_the_api_runs_under() -> None:
    assert current_coverage() is coverage.Coverage.current()


def test_coverage_needs_the_api_to_run_under_it(e2e: TestClient, harness: FastAPI) -> None:
    harness.dependency_overrides[current_coverage] = lambda: None

    assert error(e2e.get("/api/e2e/coverage")) == "coverage_off"


def test_coverage_comes_back_as_an_html_report_and_lcov(
    e2e: TestClient, harness: FastAPI, tmp_path: Path
) -> None:
    # Coverage data for part of one module, as if the API had run it.
    data_file = tmp_path / ".coverage"
    data = CoverageData(basename=str(data_file))
    data.add_lines({str(Path(tokens.__file__).resolve()): [3, 4, 5, 11, 12]})
    data.write()
    measurement = coverage.Coverage(data_file=str(data_file), config_file=False)
    measurement.load()
    harness.dependency_overrides[current_coverage] = lambda: measurement

    response = e2e.get("/api/e2e/coverage")

    assert response.status_code == 200
    report = response.json()
    files = {entry["path"]: base64.b64decode(entry["content"]) for entry in report["files"]}
    assert "html/index.html" in files
    assert b"tokens.py" in files["lcov.info"]
    assert 0 < report["percent_covered"] < 100
