"""Endpoints the Playwright tests call to set up each test, under /api/e2e.

They reset the database, sign browsers in without going through the sign-in form, and hand
over the API's code coverage. Only ``e2e.main`` mounts them.
"""

import base64
import tempfile
import uuid
from decimal import Decimal
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
from app.models import Account, Connection, User
from app.models.base import utcnow
from app.schemas.auth import SessionState
from e2e import baseline
from e2e.ai import FakeAI
from e2e.baseline import Baseline, SavedSignInName
from e2e.plaid import FakeItem, FakePlaid

router = APIRouter(tags=["e2e"])


def fake_plaid(request: Request) -> FakePlaid:
    """The stand-in for Plaid that ``e2e.main`` plugs in."""
    fake: FakePlaid = request.app.state.fake_plaid
    return fake


Fake = Annotated[FakePlaid, Depends(fake_plaid)]


def fake_ai(request: Request) -> FakeAI:
    """The stand-in for the AI providers that ``e2e.main`` plugs in."""
    ai: FakeAI = request.app.state.fake_ai
    return ai


FakeProviders = Annotated[FakeAI, Depends(fake_ai)]


@router.get("/baseline")
def describe_baseline(settings: AppSettings) -> Baseline:
    """What the baseline holds, without touching the database."""
    return baseline.describe(settings)


@router.post("/reset")
def reset_to_baseline(
    db: Db, settings: AppSettings, fake: Fake, providers: FakeProviders
) -> Baseline:
    """Replaces everything in the database with the baseline, and puts the stand-in for
    Plaid back to the baseline's banks and the stand-in for the AI providers back to having
    heard nothing."""
    fake.reset()
    providers.reset()
    baseline.clear(db)
    baseline.seed(db, settings, utcnow())
    db.commit()
    return baseline.describe(settings)


class FreshInstall(BaseModel):
    setup_code: str


@router.post("/fresh-install")
def reset_to_fresh_install(db: Db, fake: Fake, providers: FakeProviders) -> FreshInstall:
    """Empties the database, as on the first start, and returns the setup wizard's code."""
    fake.reset()
    providers.reset()
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


def _item(fake: FakePlaid, connection: Connection | None) -> FakeItem:
    try:
        return fake.item(connection.external_id if connection else "")
    except KeyError:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "No bank is connected with that ID."
        ) from None


class BankTransaction(BaseModel):
    # The account in Cashcove, which a bank keeps up to date.
    account_id: uuid.UUID
    # As Cashcove shows it: negative when money leaves the account.
    amount: Decimal
    payee: str
    # One of Plaid's categories, which decides the transaction's category in Cashcove.
    category: str = "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE"


@router.post("/plaid/transactions", status_code=status.HTTP_201_CREATED)
def add_bank_transaction(body: BankTransaction, db: Db, fake: Fake) -> dict[str, Any]:
    """Has an account's bank report a new transaction, which the bank's next sync brings in.
    Returns it as Plaid would."""
    account = db.get(Account, body.account_id)
    if account is None or account.connection_id is None or account.external_id is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "No bank keeps an account with that ID."
        )
    item = _item(fake, db.get(Connection, account.connection_id))
    # Plaid's amounts are positive when money leaves the account.
    return fake.add_transaction(
        item.item_id, account.external_id, str(-body.amount), body.payee, body.category
    )


class BankError(BaseModel):
    # An error code, like ITEM_LOGIN_REQUIRED, or null to clear it.
    code: str | None


@router.post("/plaid/connections/{connection_id}/error", status_code=status.HTTP_204_NO_CONTENT)
def set_bank_error(connection_id: uuid.UUID, body: BankError, db: Db, fake: Fake) -> None:
    """Has a connected bank fail its syncs with an error until it's cleared, as when the bank
    wants someone to sign in again. Reconnecting clears it too."""
    _item(fake, db.get(Connection, connection_id)).error = body.code


# ---- The stand-in for the AI providers ------------------------------------------------


class AIRequest(BaseModel):
    provider: str
    method: str
    host: str
    path: str
    authorized: bool
    # What was sent, exactly as the provider got it.
    body: str


@router.get("/ai/requests")
def ai_requests(providers: FakeProviders) -> list[AIRequest]:
    """Every request an AI provider has received since the last reset, to check what was sent."""
    return [
        AIRequest(
            provider=seen.provider,
            method=seen.method,
            host=seen.host,
            path=seen.path,
            authorized=seen.authorized,
            body=seen.body,
        )
        for seen in providers.requests
    ]


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
