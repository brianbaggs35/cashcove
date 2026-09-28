"""Endpoints the Playwright tests call to set up each test, under /api/e2e.

They reset the database, sign browsers in without going through the sign-in form, and hand
over the API's code coverage. Only ``e2e.main`` mounts them.
"""

import base64
import tempfile
from pathlib import Path
from typing import Annotated, Any

import coverage
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from app.auth import sessions
from app.auth.deps import ApiError, AppSettings, Db
from app.auth.service import session_state
from app.auth.setup import issue_code
from app.models import User
from app.models.base import utcnow
from app.schemas.auth import SessionState
from e2e import baseline
from e2e.baseline import Baseline, SavedSignInName
from e2e.plaid import FakeItem, FakePlaid

router = APIRouter(tags=["e2e"])


def fake_plaid(request: Request) -> FakePlaid:
    """The stand-in for Plaid that ``e2e.main`` plugs in."""
    fake: FakePlaid = request.app.state.fake_plaid
    return fake


Fake = Annotated[FakePlaid, Depends(fake_plaid)]


@router.get("/baseline")
def describe_baseline(settings: AppSettings) -> Baseline:
    """What the baseline holds, without touching the database."""
    return baseline.describe(settings)


@router.post("/reset")
def reset_to_baseline(db: Db, settings: AppSettings, fake: Fake) -> Baseline:
    """Replaces everything in the database with the baseline, and puts the stand-in for
    Plaid back to the baseline's banks."""
    fake.reset()
    baseline.clear(db)
    baseline.seed(db, settings, utcnow())
    db.commit()
    return baseline.describe(settings)


class FreshInstall(BaseModel):
    setup_code: str


@router.post("/fresh-install")
def reset_to_fresh_install(db: Db, fake: Fake) -> FreshInstall:
    """Empties the database, as on the first start, and returns the setup wizard's code."""
    fake.reset()
    baseline.clear(db)
    code = issue_code(db, utcnow())
    db.commit()
    return FreshInstall(setup_code=code)


class SessionRequest(BaseModel):
    email: EmailStr
    remember: bool = False


@router.post("/sessions")
def start_session(
    body: SessionRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> SessionState:
    """Signs this browser in as someone, skipping the password, two-step and rate limits."""
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", f"Nobody signs in as {body.email}.")
    if not user.is_active:
        raise ApiError(
            status.HTTP_409_CONFLICT, "account_disabled", f"{body.email}'s account is off."
        )
    session = sessions.start(db, request, response, user, remember=body.remember, now=utcnow())
    db.commit()
    return session_state(db, settings, session)


@router.post("/saved-sign-ins/{name}")
def use_saved_sign_in(
    name: SavedSignInName, response: Response, db: Db, settings: AppSettings
) -> SessionState:
    """Signs this browser in on the admin's or the viewer's saved sign-in.

    Global setup saves the cookie to a file, so specs can start signed in with
    ``test.use({ storageState })``. Every reset brings the session back with the same token,
    so the file keeps working.
    """
    token = baseline.SAVED_SIGN_INS[name].token(settings)
    session = sessions.load(db, token, utcnow())
    if session is None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "signed_out",
            f"The {name}'s saved sign-in has ended, e.g. a test signed out. Reset to the "
            "baseline to bring it back.",
        )
    sessions.set_cookie(
        response, sessions.SESSION_COOKIE, token, max_age=sessions.REMEMBERED.absolute
    )
    return session_state(db, settings, session)


# ---- The stand-in for Plaid -------------------------------------------------------------


def _bank(fake: FakePlaid, bank: str) -> FakeItem:
    try:
        return fake.item(bank)
    except KeyError:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", f"No bank called {bank} is connected."
        ) from None


class BankTransaction(BaseModel):
    # Plaid's account_id, like "e2e-card".
    account_id: str
    # As Plaid reports it: positive when money leaves the account.
    amount: str
    merchant: str
    # One of Plaid's categories, which decides the transaction's category in Cashcove.
    category: str = "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE"


@router.post("/plaid/{bank}/transactions")
def add_bank_transaction(bank: str, body: BankTransaction, fake: Fake) -> dict[str, Any]:
    """Has a connected bank (by key, like "tartan") report a new transaction, which the next
    sync brings in."""
    item = _bank(fake, bank)
    if body.account_id not in {account.account_id for account in item.accounts}:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", f"{bank} has no account {body.account_id}."
        )
    return fake.add_transaction(bank, body.account_id, body.amount, body.merchant, body.category)


class BankError(BaseModel):
    # An error code, like ITEM_LOGIN_REQUIRED, or null to clear it.
    code: str | None


@router.post("/plaid/{bank}/error", status_code=status.HTTP_204_NO_CONTENT)
def set_bank_error(bank: str, body: BankError, fake: Fake) -> None:
    """Has a connected bank fail its next syncs with an error until it's cleared, as when the
    bank wants someone to sign in again. Reconnecting clears it too."""
    _bank(fake, bank).error = body.code


# ---- Code coverage ----------------------------------------------------------------------


def current_coverage() -> coverage.Coverage | None:
    """The measurement the API was started under (``coverage run``), if any."""
    return coverage.Coverage.current()


Measurement = Annotated[coverage.Coverage | None, Depends(current_coverage)]


class CoverageFile(BaseModel):
    path: str
    # Base64, since the HTML report includes images.
    content: str


class CoverageReport(BaseModel):
    percent_covered: float
    files: list[CoverageFile]


@router.get("/coverage")
def api_coverage(measurement: Measurement) -> CoverageReport:
    """The API's coverage so far, as an HTML report and an LCOV file."""
    if measurement is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "coverage_off", "The API isn't running under coverage."
        )
    measurement.save()
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder)
        percent = measurement.html_report(directory=str(output / "html"))
        measurement.lcov_report(outfile=str(output / "lcov.info"))
        files = [
            CoverageFile(
                path=path.relative_to(output).as_posix(),
                content=base64.b64encode(path.read_bytes()).decode(),
            )
            for path in sorted(output.rglob("*"))
            if path.is_file()
        ]
    return CoverageReport(percent_covered=round(percent, 2), files=files)
