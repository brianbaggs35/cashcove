"""The end-to-end tests' harness: the baseline, resetting to it, and signing in without the form."""

import base64
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import coverage
import pytest
from coverage.data import CoverageData
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from webauthn.helpers import base64url_to_bytes

from app.auth import tokens
from app.auth.service import load_preferences, totp_box
from app.auth.sessions import SESSION_COOKIE
from app.config import Settings, get_settings
from app.db import get_session
from app.finance.categories import SUGGESTED
from app.models import (
    Account,
    AuditEvent,
    Budget,
    BudgetAmount,
    Category,
    CategoryGroup,
    Connection,
    ConnectionSync,
    FileImport,
    ImportProfile,
    Invitation,
    LoginThrottle,
    Passkey,
    RecoveryCode,
    Transaction,
    User,
    UserSession,
)
from e2e.api import current_coverage
from e2e.baseline import SAVED_SIGN_INS
from e2e.main import create_e2e_app
from e2e.plaid import FakePlaid
from tests.authenticator import Authenticator
from tests.helpers import ORIGIN, add_user, error, sign_in, totp_code, use_session

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
    e2e.post("/api/auth/sign-in", json={"email": stranger.email, "password": "wrong-password"})
    assert count(session, LoginThrottle) > 0

    response = e2e.post("/api/e2e/reset")

    assert response.status_code == 200
    assert set(session.scalars(select(User.email))) == BASELINE_EMAILS
    # Sessions, sign-in history and lockouts from earlier tests are gone, leaving the
    # baseline's own.
    baseline = response.json()
    devices = {device["id"] for user in baseline["users"].values() for device in user["devices"]}
    assert {str(id) for id in session.scalars(select(UserSession.id))} == devices
    assert count(session, AuditEvent) == len(baseline["activity"])
    assert count(session, LoginThrottle) == 0
    assert baseline == e2e.get("/api/e2e/baseline").json()


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


def test_the_baseline_has_accounts_kept_by_hand_linked_ones_and_a_closed_one(
    e2e: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("e2e.api.utcnow", lambda: RESET_AT)

    accounts = e2e.post("/api/e2e/reset").json()["accounts"]

    expected = {
        "checking": ("Everyday checking", "checking", "manual", "2450.18", False),
        "savings": ("Rainy day fund", "savings", "manual", "12500.00", False),
        "card": ("Rewards Visa", "credit_card", "plaid", "-612.40", False),
        "loan": ("Car loan", "loan", "manual", "-9120.00", False),
        "retirement": ("Retirement 401(k)", "investment", "plaid", "48210.55", False),
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
    assert stored["retirement"].external_id == "e2e-retirement"
    assert stored["savings"].notes == accounts["savings"]["notes"] == "Three months of expenses"
    assert stored["loan"].notes == accounts["loan"]["notes"] == "5.9% APR, paid off in 2029"
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
    history = baseline["history"]
    assert len(transactions) == 11
    assert len(transactions) + len(history) == count(session, Transaction) == 210
    for described in [*transactions.values(), *history]:
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
        # Linked accounts' transactions came from the bank, and older ones in the accounts kept
        # by hand from its CSV exports; both keep what the bank called them.
        from_bank = account["source"] == "plaid"
        imported = not from_bank and described["days_ago"] > 120
        source = "plaid" if from_bank else "file" if imported else "manual"
        assert stored.source.value == source
        assert (stored.external_id is None) == (source == "manual")
        if source != "manual":
            assert stored.original_description
    for key in ("coffee", "refund", "netflix"):
        stored = session.get(Transaction, uuid.UUID(transactions[key]["id"]))
        assert stored is not None
        assert stored.external_id == f"e2e-{key}"
    assert [key for key, item in transactions.items() if item["pending"]] == ["coffee"]
    assert not [item for item in history if item["pending"]]
    assert [key for key, item in transactions.items() if item["category"] is None] == ["venmo"]
    assert [item["payee"] for item in history if item["category"] is None] == ["Zelle payment"] * 3


def test_the_named_transactions_are_the_newest_and_the_only_ones_with_their_payees(
    e2e: TestClient,
) -> None:
    baseline = e2e.post("/api/e2e/reset").json()

    named = baseline["transactions"].values()
    history = baseline["history"]
    # History is newest first, and older than all of the named transactions but the store's.
    ages = [item["days_ago"] for item in history]
    assert ages == sorted(ages)
    assert min(ages) > max(item["days_ago"] for item in named if item["account"] != "closed")
    # Each named transaction is on a day of its own.
    assert len({item["days_ago"] for item in named}) == len(named)
    for item in named:
        payee = item["payee"].lower()
        others = [other for other in [*named, *history] if other["id"] != item["id"]]
        for other in others:
            text = " ".join(filter(None, (other["payee"], other["original_description"])))
            assert payee not in text.lower(), (item["payee"], other["payee"])


def test_the_history_spans_more_than_a_year_and_more_than_the_biggest_page(
    e2e: TestClient,
) -> None:
    history = e2e.post("/api/e2e/reset").json()["history"]

    # Every period, "Last year" included, has transactions whatever the date, and even
    # 200 to a page leaves a second page.
    assert max(item["days_ago"] for item in history) > 366
    assert len(history) + 11 > 200
    by_month = {item["days_ago"] // 30 for item in history}
    assert by_month == set(range(14))


def test_people_see_the_baseline_money_through_the_api(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    viewer = baseline["users"]["viewer"]
    sign_in(e2e, viewer["email"], viewer["password"])

    accounts = e2e.get("/api/accounts").json()
    transactions = e2e.get("/api/transactions").json()
    groups = e2e.get("/api/categories").json()

    # Open accounts first.
    assert [account["name"] for account in accounts] == [
        "Car loan",
        "Everyday checking",
        "Rainy day fund",
        "Retirement 401(k)",
        "Rewards Visa",
        "Old store card",
    ]
    assert {account["name"]: account["transaction_count"] for account in accounts} == {
        "Car loan": 0,
        "Everyday checking": 111,
        "Rainy day fund": 27,
        "Retirement 401(k)": 0,
        "Rewards Visa": 71,
        "Old store card": 1,
    }
    assert transactions["total"] == 210
    # The named transactions come first, newest first.
    named = baseline["transactions"]
    assert [item["payee"] for item in transactions["items"][:10]] == [
        item["payee"] for item in named.values() if item["account"] != "closed"
    ]
    assert transactions["totals"] == [
        {"currency": "USD", "count": 210, "money_in": "59592.43", "money_out": "-18655.66"}
    ]
    assert len(groups) == len(SUGGESTED)
    assert sum(len(group["categories"]) for group in groups) == 37


def test_the_baseline_has_the_imports_that_brought_in_the_older_history(
    e2e: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("e2e.api.utcnow", lambda: RESET_AT)

    baseline = e2e.post("/api/e2e/reset").json()

    imports = baseline["imports"]
    assert list(imports) == ["savings_history", "checking_history"]
    assert count(session, FileImport) == 2
    history = baseline["history"]
    for key, described in imports.items():
        stored = session.get(FileImport, uuid.UUID(described["id"]))
        assert stored is not None
        assert str(stored.account_id) == described["account_id"]
        assert described["account_id"] == baseline["accounts"][described["account"]]["id"]
        assert (stored.file_name, stored.format.value, stored.added, stored.skipped) == (
            described["file_name"],
            described["format"],
            described["added"],
            described["skipped"],
        )
        assert stored.created_at == RESET_AT - timedelta(hours=described["hours_ago"])
        mine = [item for item in history if item["file_import"] == key]
        assert len(mine) == described["added"]
        assert (
            stored.total
            == sum(Decimal(item["amount"]) for item in mine)
            == Decimal(described["total"])
        )
        assert stored.first_date == (RESET_AT - timedelta(days=described["first_days_ago"])).date()
        assert stored.last_date == (RESET_AT - timedelta(days=described["last_days_ago"])).date()
        rows = session.scalars(select(Transaction).where(Transaction.import_id == stored.id))
        assert sorted(str(row.id) for row in rows) == sorted(item["id"] for item in mine)
    # Every imported transaction came in with one of them.
    assert all(item["file_import"] for item in history if item["source"] == "file")
    assert not [item for item in history if item["source"] != "file" and item["file_import"]]
    saved = baseline["saved_formats"]
    assert list(saved) == ["harbor_checking", "maple_card"]
    assert imports["checking_history"]["saved_format"] == "harbor_checking"
    for described in saved.values():
        profile = session.get(ImportProfile, uuid.UUID(described["id"]))
        assert profile is not None
        assert (profile.name, profile.headers) == (described["name"], described["headers"])
        account = baseline["accounts"][described["account"]]["id"]
        assert str(profile.account_id) == account


def test_people_see_the_baseline_imports_through_the_api(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    viewer = baseline["users"]["viewer"]
    sign_in(e2e, viewer["email"], viewer["password"])

    imports = e2e.get("/api/imports").json()
    profiles = e2e.get("/api/imports/profiles").json()

    assert [item["file_name"] for item in imports] == [
        item["file_name"] for item in baseline["imports"].values()
    ]
    assert [item["created_by"] for item in imports] == ["Alex Rivera"] * 2
    assert [profile["name"] for profile in profiles] == [
        "Harbor Credit Union checking",
        "Maple store card",
    ]
    # The checking account's saved format reads its files.
    harbor = profiles[0]
    assert harbor["options"]["csv"]["columns"]["id"] == 4
    assert harbor["last_used_at"] is not None
    assert profiles[1]["last_used_at"] is None


def test_the_baseline_has_budgets_set_up_with_cashcove(
    e2e: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("e2e.api.utcnow", lambda: RESET_AT)

    baseline = e2e.post("/api/e2e/reset").json()

    budgets = baseline["budgets"]
    assert count(session, Budget) == len(budgets) == 17
    assert list(budgets)[:3] == ["Paycheck", "Interest & dividends", "Rent & mortgage"]
    starts: dict[str, dict[str, str | None]] = {}
    for name, described in budgets.items():
        stored = session.get(Budget, uuid.UUID(described["id"]))
        assert stored is not None
        assert described["category"] == name
        assert str(stored.category_id) == described["category_id"]
        assert described["category_id"] == baseline["categories"][name]["id"]
        assert stored.period.value == described["period"]
        rows = session.scalars(
            select(BudgetAmount)
            .where(BudgetAmount.budget_id == stored.id)
            .order_by(BudgetAmount.starts_on)
        )
        starts[name] = {
            f"{row.starts_on:%Y-%m}": None if row.amount is None else str(row.amount)
            for row in rows
        }
        assert [amount["amount"] for amount in described["amounts"]] == list(starts[name].values())
        rollover = described["rollover_months_ago"]
        assert stored.rollover_since == (
            None if rollover is None else datetime(2026, 9 - rollover, 1).date()
        )
    # Months count back from the reset's month, and yearly budgets are for its budget year.
    assert starts["Rent & mortgage"] == {"2026-05": "1850.00"}
    assert starts["Groceries"] == {"2026-05": "450.00", "2026-08": "500.00"}
    assert starts["Shopping"] == {"2026-05": "100.00", "2026-09": "150.00", "2026-10": "100.00"}
    assert [amount["ago"] for amount in budgets["Shopping"]["amounts"]] == [4, 0, -1]
    assert starts["Travel"] == {"2026-01": "2500.00"}
    assert budgets["Travel"]["period"] == "yearly"
    assert budgets["Restaurants"]["rollover_months_ago"] == 2
    kinds = {group["name"]: group["kind"] for group in baseline["category_groups"].values()}
    assert not [
        name for name in budgets if kinds[baseline["categories"][name]["group"]] == "transfer"
    ]


def test_people_see_the_baseline_budget_through_the_api(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    viewer = baseline["users"]["viewer"]
    sign_in(e2e, viewer["email"], viewer["password"])
    month = f"{datetime.now(UTC):%Y-%m}"

    body = e2e.get(f"/api/budget/months/{month}").json()

    found = {line["name"]: line for group in body["groups"] for line in group["categories"]}
    assert found["Shopping"]["amount"] == "150.00"
    assert found["Groceries"]["amount"] == "500.00"
    assert (found["Travel"]["period"], found["Travel"]["amount"]) == ("yearly", "2500.00")
    assert found["Restaurants"]["rollover"] is True
    assert found["Cash & ATM"]["period"] is None
    assert body["income"]["budgeted"] == "4010.00"
    # A twelfth of the yearly budgets counts in each month.
    assert body["spending"]["budgeted"] == "3891.67"


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


def use_saved_sign_in(e2e: TestClient, name: str) -> dict[str, Any]:
    response = e2e.post(f"/api/e2e/saved-sign-ins/{name}")
    assert response.status_code == 200, response.text
    return use_session(e2e, response.json())


def test_saved_sign_ins_sign_a_browser_in_as_the_admin_or_the_viewer(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()

    for name in ("admin", "viewer"):
        e2e.cookies.clear()
        state = use_saved_sign_in(e2e, name)

        assert state["user"]["email"] == baseline["users"][name]["email"]
        assert state["session"]["remember"] is True
        cookie = e2e.cookies.get(SESSION_COOKIE)
        assert cookie
        sessions = e2e.get("/api/account/sessions").json()
        assert sessions[0]["current"] is True
        saved = next(d for d in baseline["users"][name]["devices"] if d["saved_sign_in"])
        assert sessions[0]["id"] == saved["id"]
        assert saved["saved_sign_in"] == name


def test_saved_sign_ins_keep_working_after_a_reset(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")
    state = use_saved_sign_in(e2e, "admin")
    cookie = e2e.cookies.get(SESSION_COOKIE)
    # A change made through the saved sign-in, which the reset undoes.
    renamed = e2e.put("/api/account/profile", json={"name": "Alex R.", "email": "alex@example.com"})
    assert renamed.status_code == 200

    e2e.post("/api/e2e/reset")

    # The same cookie and CSRF token still work, as if nothing had happened.
    assert e2e.cookies.get(SESSION_COOKIE) == cookie
    session = e2e.get("/api/auth/session").json()["session"]
    assert session["csrf_token"] == state["session"]["csrf_token"]
    restored = e2e.put(
        "/api/account/profile", json={"name": "Alex Rivera", "email": "alex@example.com"}
    )
    assert restored.status_code == 200
    assert e2e.get("/api/account").json()["name"] == "Alex Rivera"


def test_a_saved_sign_in_ends_like_any_other_until_the_next_reset(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")
    use_saved_sign_in(e2e, "viewer")

    assert e2e.post("/api/auth/sign-out").status_code == 204

    assert error(e2e.post("/api/e2e/saved-sign-ins/viewer")) == "signed_out"
    e2e.post("/api/e2e/reset")
    assert use_saved_sign_in(e2e, "viewer")["user"]["email"] == "sam@example.com"


def test_saved_sign_ins_come_from_the_app_secret(settings: Settings) -> None:
    device = SAVED_SIGN_INS["admin"]
    token = device.token(settings)
    other = settings.model_copy(
        update={"secret_key": SecretStr("another-secret-key-at-least-32-long")}
    )

    # The same at every reset, so the files global setup saves keep working.
    assert device.token(settings.model_copy()) == token
    assert device.token(other) != token
    assert SAVED_SIGN_INS["viewer"].token(settings) != token
    assert device.csrf_token(settings) != token


def test_only_the_admin_and_the_viewer_have_saved_sign_ins(e2e: TestClient) -> None:
    e2e.post("/api/e2e/reset")

    assert e2e.post("/api/e2e/saved-sign-ins/two_step").status_code == 422


def test_people_are_signed_in_on_the_baseline_devices(e2e: TestClient, session: Session) -> None:
    users = e2e.post("/api/e2e/reset").json()["users"]

    assert {key: [d["device"] for d in user["devices"]] for key, user in users.items()} == {
        "admin": ["Chrome on Windows", "Safari on iPhone", "Firefox on macOS"],
        "two_step": ["Safari on iPad"],
        "viewer": ["Chrome on Windows", "Chrome on Android"],
        "deactivated": [],
    }
    use_saved_sign_in(e2e, "admin")
    listed = e2e.get("/api/account/sessions").json()
    assert [(item["device"], item["current"]) for item in listed] == [
        ("Chrome on Windows", True),
        ("Safari on iPhone", False),
        ("Firefox on macOS", False),
    ]
    assert [item["id"] for item in listed] == [d["id"] for d in users["admin"]["devices"]]
    assert [item["ip_address"] for item in listed] == [
        d["ip_address"] for d in users["admin"]["devices"]
    ]
    stored = session.get(UserSession, uuid.UUID(users["admin"]["devices"][1]["id"]))
    assert stored is not None
    assert stored.remember is True
    ended = e2e.post("/api/account/sessions/sign-out-others").json()
    assert ended == {"ended": 2}


def test_members_show_when_each_person_last_signed_in(e2e: TestClient) -> None:
    users = e2e.post("/api/e2e/reset").json()["users"]
    use_saved_sign_in(e2e, "admin")

    members = e2e.get("/api/users").json()

    last = {item["email"]: item["details"]["last_sign_in_at"] for item in members}
    now = datetime.now(UTC)
    for user in users.values():
        ago = now - datetime.fromisoformat(last[user["email"]])
        assert abs(ago - timedelta(hours=user["last_sign_in_hours_ago"])) < timedelta(minutes=5)


def test_the_admin_signs_in_with_the_baseline_passkey(
    e2e: TestClient, session: Session, settings: Settings
) -> None:
    alex = e2e.post("/api/e2e/reset").json()["users"]["admin"]
    [passkey] = alex["passkeys"]
    key = serialization.load_der_private_key(base64url_to_bytes(passkey["private_key"]), None)
    assert isinstance(key, ec.EllipticCurvePrivateKey)
    phone = Authenticator(
        credential_id=base64url_to_bytes(passkey["credential_id"]),
        key=key,
        user_handle=base64url_to_bytes(passkey["user_handle"]),
    )

    options = e2e.post("/api/auth/passkey/options").json()
    response = e2e.post(
        "/api/auth/passkey",
        json={"challenge_id": options["challenge_id"], "credential": phone.get(options["options"])},
    )

    assert response.status_code == 200, response.text
    assert response.json()["state"]["user"]["email"] == alex["email"]
    assert passkey["rp_id"] == settings.server_name
    assert (passkey["name"], passkey["provider"]) == ("Alex's iPhone", "iCloud Keychain")
    use_session(e2e, response.json())
    listed = e2e.get("/api/account/passkeys").json()
    assert [(item["id"], item["credential_id"]) for item in listed] == [
        (passkey["id"], passkey["credential_id"])
    ]
    assert listed[0]["backed_up"] is True
    stored = session.get(Passkey, uuid.UUID(passkey["id"]))
    assert stored is not None
    assert stored.sign_count == 1


def test_the_activity_log_tells_the_households_story(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    activity = baseline["activity"]

    use_saved_sign_in(e2e, "admin")
    household = e2e.get("/api/users/activity").json()
    own = e2e.get("/api/account/activity").json()

    assert [entry["id"] for entry in household] == [entry["id"] for entry in activity]
    assert [(entry["event"], entry["device"], entry["ip_address"]) for entry in household] == [
        (entry["event"], entry["device"], entry["ip_address"]) for entry in activity
    ]
    names = {key: user["name"] for key, user in baseline["users"].items()}
    for listed, described in zip(household, activity, strict=True):
        assert listed["user_name"] == names.get(described["user"])
        assert listed["actor_name"] == names.get(described["actor"])
        assert listed["details"] == described["details"]
    # More than the eight Settings shows before "Show all".
    assert len(own) == len([entry for entry in activity if entry["user"] == "admin"]) == 9
    riley = baseline["invitations"]["pending"]
    assert household[2]["details"] == {"email": riley["email"], "role": "viewer"}
    assert household[2]["actor_name"] == "Alex Rivera"


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


# ---- Bank connections and the stand-in for Plaid ------------------------------------------


def test_the_baseline_has_a_healthy_bank_and_one_that_wants_a_new_sign_in(
    e2e: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("e2e.api.utcnow", lambda: RESET_AT)
    baseline = e2e.post("/api/e2e/reset").json()
    connections = baseline["connections"]

    assert connections["tartan"] | {"id": None} == {
        "id": None,
        "institution": "Tartan Bank",
        "status": "healthy",
        "error_code": None,
        "accounts": ["card"],
        "skipped": ["Tartan Checking"],
        "last_synced_hours_ago": 3,
    }
    assert connections["fidelity"] | {"id": None} == {
        "id": None,
        "institution": "Fidelity",
        "status": "login_required",
        "error_code": "ITEM_LOGIN_REQUIRED",
        "accounts": ["retirement"],
        "skipped": [],
        "last_synced_hours_ago": 50,
    }
    for key, connection in connections.items():
        stored = session.get(Connection, uuid.UUID(connection["id"]))
        assert stored is not None
        assert stored.institution_name == connection["institution"]
        for account in connection["accounts"]:
            linked = session.get(Account, uuid.UUID(baseline["accounts"][account]["id"]))
            assert linked is not None
            assert linked.connection_id == stored.id, key
    assert count(session, ConnectionSync) == 7
    tartan = session.get_one(Connection, uuid.UUID(connections["tartan"]["id"]))
    assert tartan.last_synced_at == RESET_AT - timedelta(hours=3)

    use_saved_sign_in(e2e, "viewer")
    listed = {item["institution_name"]: item for item in e2e.get("/api/connections").json()}

    assert {account["name"]: account["state"] for account in listed["Tartan Bank"]["accounts"]} == {
        "Rewards Visa": "imported",
        "Tartan Checking": "skipped",
    }
    assert listed["Tartan Bank"]["last_sync"]["added"] == 1
    assert "sign in again" in listed["Fidelity"]["error_message"]
    assert e2e.get("/api/system").json()["plaid"] == {"configured": True, "environment": "sandbox"}


def test_the_baseline_banks_sync_and_reconnect_through_the_stand_in(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    tartan = baseline["connections"]["tartan"]["id"]
    fidelity = baseline["connections"]["fidelity"]["id"]
    use_saved_sign_in(e2e, "admin")

    added = e2e.post(
        "/api/e2e/plaid/transactions",
        json={
            "account_id": baseline["accounts"]["card"]["id"],
            "amount": "-12.34",
            "payee": "Corner Bakery",
            "category": "FOOD_AND_DRINK_RESTAURANT",
        },
    )
    synced = e2e.post(f"/api/connections/{tartan}/sync", json={}).json()

    assert added.status_code == 201
    # As Plaid reports it: positive when money leaves the account.
    assert (added.json()["account_id"], added.json()["amount"]) == ("e2e-card", 12.34)
    assert synced["last_sync"]["added"] == 1
    bakery = e2e.get("/api/transactions", params={"q": "Corner Bakery"}).json()["items"]
    assert [(item["amount"], item["category_id"]) for item in bakery] == [
        ("-12.34", baseline["categories"]["Restaurants"]["id"])
    ]

    assert e2e.post(f"/api/connections/{fidelity}/sync", json={}).json()["status"] == (
        "login_required"
    )
    update = e2e.post(f"/api/connections/{fidelity}/link-token", json={})
    assert update.json()["link_token"].startswith("link-sandbox-update-fidelity-")
    reconnected = e2e.post(
        f"/api/connections/{fidelity}/sync", json={"reason": "reconnected"}
    ).json()
    assert reconnected["status"] == "healthy"
    new = e2e.post("/api/connections/link-token", json={})
    assert new.json()["link_token"].startswith("link-sandbox-new-")


def test_a_bank_can_be_made_to_want_a_new_sign_in(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    tartan = baseline["connections"]["tartan"]["id"]
    use_saved_sign_in(e2e, "admin")

    response = e2e.post(
        f"/api/e2e/plaid/connections/{tartan}/error", json={"code": "ITEM_LOGIN_REQUIRED"}
    )

    assert response.status_code == 204
    assert e2e.post(f"/api/connections/{tartan}/sync", json={}).json()["status"] == (
        "login_required"
    )
    e2e.post(f"/api/e2e/plaid/connections/{tartan}/error", json={"code": None})
    assert e2e.post(f"/api/connections/{tartan}/sync", json={}).json()["status"] == "healthy"


def test_the_stand_in_only_knows_the_banks_it_has(e2e: TestClient) -> None:
    baseline = e2e.post("/api/e2e/reset").json()
    nowhere = "00000000-0000-0000-0000-000000000000"

    unknown_bank = e2e.post(f"/api/e2e/plaid/connections/{nowhere}/error", json={"code": None})
    unknown_account = e2e.post(
        "/api/e2e/plaid/transactions",
        json={"account_id": nowhere, "amount": "-1.00", "payee": "Shop"},
    )
    kept_by_hand = e2e.post(
        "/api/e2e/plaid/transactions",
        json={"account_id": baseline["accounts"]["checking"]["id"], "amount": "1", "payee": "x"},
    )

    assert [response.status_code for response in (unknown_bank, unknown_account, kept_by_hand)] == [
        404,
        404,
        404,
    ]


def test_resets_put_the_stand_in_back_to_the_baseline_banks(
    e2e: TestClient, harness: FastAPI
) -> None:
    e2e.post("/api/e2e/reset")
    use_saved_sign_in(e2e, "admin")
    connected = e2e.post("/api/connections", json={"public_token": "public-sandbox-platypus-1"})
    fake: FakePlaid = harness.state.fake_plaid

    assert connected.status_code == 201
    assert len(fake.items) == 3

    e2e.post("/api/e2e/reset")

    assert {item.bank.key for item in fake.items.values()} == {"tartan", "fidelity"}
