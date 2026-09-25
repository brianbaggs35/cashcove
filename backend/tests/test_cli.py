import runpy
import sys

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app import cli, config, db
from app.auth import setup
from app.config import Settings
from app.models import User
from app.models.base import utcnow


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
