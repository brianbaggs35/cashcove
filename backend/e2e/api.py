"""Endpoints the Playwright tests call to set up each test, under /api/e2e.

They reset the database, sign browsers in without going through the sign-in form, and hand
over the API's code coverage. Only ``e2e.main`` mounts them.
"""

import base64
import tempfile
from pathlib import Path
from typing import Annotated

import coverage
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from app.auth import sessions
from app.auth.deps import AppSettings, Db, fail
from app.auth.service import session_state
from app.auth.setup import issue_code
from app.models import User
from app.models.base import utcnow
from app.schemas.auth import SessionState
from e2e import baseline
from e2e.baseline import Baseline

router = APIRouter(tags=["e2e"])


@router.get("/baseline", response_model=Baseline)
def describe_baseline(settings: AppSettings) -> Baseline:
    """What the baseline holds, without touching the database."""
    return baseline.describe(settings)


@router.post("/reset", response_model=Baseline)
def reset_to_baseline(db: Db, settings: AppSettings) -> Baseline:
    """Replaces everything in the database with the baseline."""
    baseline.clear(db)
    baseline.seed(db, settings, utcnow())
    db.commit()
    return baseline.describe(settings)


class FreshInstall(BaseModel):
    setup_code: str


@router.post("/fresh-install", response_model=FreshInstall)
def reset_to_fresh_install(db: Db) -> FreshInstall:
    """Empties the database, as on the first start, and returns the setup wizard's code."""
    baseline.clear(db)
    code = issue_code(db, utcnow())
    db.commit()
    return FreshInstall(setup_code=code)


class SessionRequest(BaseModel):
    email: EmailStr
    remember: bool = False


@router.post("/sessions", response_model=SessionState)
def start_session(
    body: SessionRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> SessionState:
    """Signs this browser in as someone, skipping the password, two-step and rate limits."""
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None:
        fail(status.HTTP_404_NOT_FOUND, "not_found", f"Nobody signs in as {body.email}.")
    if not user.is_active:
        fail(status.HTTP_409_CONFLICT, "account_disabled", f"{body.email}'s account is off.")
    session = sessions.start(db, request, response, user, remember=body.remember, now=utcnow())
    db.commit()
    return session_state(db, settings, session)


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


@router.get("/coverage", response_model=CoverageReport)
def api_coverage(measurement: Measurement) -> CoverageReport:
    """The API's coverage so far, as an HTML report and an LCOV file."""
    if measurement is None:
        fail(status.HTTP_404_NOT_FOUND, "coverage_off", "The API isn't running under coverage.")
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
