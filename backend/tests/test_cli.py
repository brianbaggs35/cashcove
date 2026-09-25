import runpy
import sys

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app import cli, config, db
from app.auth import setup
from app.auth.tokens import hash_token
from app.config import Settings
from app.models import AuditEvent, PasswordReset, RecoveryCode, User
from app.models.base import utcnow
from tests.helpers import add_user


@pytest.fixture(autouse=True)
def use_test_database(
    monkeypatch: pytest.MonkeyPatch, engine: Engine, settings: Settings, session: Session
) -> None:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    for module in (cli, db):
        monkeypatch.setattr(module, "get_sessionmaker", lambda: factory)
    for module in (cli, config):
        monkeypatch.setattr(module, "get_settings", lambda: settings)


def test_prints_a_setup_code_and_where_to_use_it(
    capsys: pytest.CaptureFixture[str], session: Session
) -> None:
    assert cli.main(["setup-code"]) == 0
    output = capsys.readouterr().out
    assert "https://cashcove.example.com/welcome" in output
    code = output.split("One-time setup code:")[1].split()[0]
    assert setup.code_is_valid(session, code, utcnow())


def test_prints_just_the_code(capsys: pytest.CaptureFixture[str], session: Session) -> None:
    assert cli.main(["setup-code", "--plain"]) == 0
    code = capsys.readouterr().out.strip()
    assert setup.code_is_valid(session, code, utcnow())


def test_does_nothing_once_set_up(
    capsys: pytest.CaptureFixture[str], session: Session, admin: User
) -> None:
    assert cli.main(["setup-code", "--if-needed"]) == 0
    assert capsys.readouterr() == ("", "")
    assert cli.main(["setup-code"]) == 1
    assert "already set up" in capsys.readouterr().err


def test_runs_as_a_module(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", ["app.cli", "setup-code", "--plain"])
    monkeypatch.delitem(sys.modules, "app.cli")
    with pytest.raises(SystemExit) as exited:
        runpy.run_module("app.cli", run_name="__main__")
    assert exited.value.code == 0
    assert len(capsys.readouterr().out.strip()) == 14


def test_prints_a_reset_link_for_a_locked_out_admin(
    capsys: pytest.CaptureFixture[str], session: Session, admin: User
) -> None:
    assert cli.main(["reset-link", " ALEX@example.com "]) == 0
    output = capsys.readouterr().out
    assert "alex@example.com" in output
    link = output.strip().splitlines()[-1]
    assert link.startswith("https://cashcove.example.com/reset-password#")
    token = link.split("#")[1]
    reset = session.scalars(select(PasswordReset)).one()
    assert reset.token_hash == hash_token(token)
    assert reset.created_by_id is None
    event = session.scalars(select(AuditEvent)).one()
    assert (event.event, event.user_id, event.actor_id) == (
        "password_reset_created",
        admin.id,
        admin.id,
    )
    assert event.details == {"via": "command line"}
    assert event.ip_address is None


def test_reset_links_need_an_active_account(
    capsys: pytest.CaptureFixture[str], session: Session, settings: Settings
) -> None:
    assert cli.main(["reset-link", "nobody@example.com"]) == 1
    assert "no account with the email nobody@example.com" in capsys.readouterr().err
    add_user(session, settings, email="jo@example.com", name="Jo", is_active=False)
    assert cli.main(["reset-link", "jo@example.com"]) == 1
    assert "turned off" in capsys.readouterr().err
    assert session.query(PasswordReset).count() == 0


def test_turns_off_two_step_verification(
    capsys: pytest.CaptureFixture[str], session: Session, admin: User
) -> None:
    admin.totp_secret = "sealed-secret"
    session.add(RecoveryCode(user_id=admin.id, code_hash=hash_token("code")))
    session.commit()
    assert cli.main(["turn-off-2fa", admin.email]) == 0
    assert "Two-step verification is off for alex@example.com" in capsys.readouterr().out
    session.refresh(admin)
    assert admin.totp_secret is None
    assert session.query(RecoveryCode).count() == 0
    assert session.scalars(select(AuditEvent.event)).all() == ["two_factor_reset"]
    # Running it again changes nothing and records nothing.
    assert cli.main(["turn-off-2fa", admin.email]) == 0
    assert session.query(AuditEvent).count() == 1
    assert cli.main(["turn-off-2fa", "nobody@example.com"]) == 1
