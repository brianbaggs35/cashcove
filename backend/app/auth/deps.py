"""FastAPI dependencies that authenticate requests and enforce roles."""

from dataclasses import dataclass
from typing import Annotated, Any, NoReturn

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import sessions
from app.auth.tokens import tokens_match
from app.config import Settings, get_settings
from app.db import get_session
from app.models import User, UserSession
from app.models.base import utcnow

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CSRF_HEADER = "X-CSRF-Token"

Db = Annotated[Session, Depends(get_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def fail(
    status_code: int,
    code: str,
    message: str,
    *,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> NoReturn:
    """Raises an error the web app can act on by ``code`` and show by ``message``."""
    raise HTTPException(
        status_code, detail={"code": code, "message": message, **extra}, headers=headers
    )


def verify_origin(request: Request, settings: AppSettings) -> None:
    """Refuses state-changing requests that a browser says came from another site.

    Together with SameSite=Strict cookies and the CSRF token, this stops other pages from
    submitting requests on someone's behalf, including forged sign-ins.
    """
    if request.method in SAFE_METHODS:
        return
    # Every copy of each header is checked, so a repeated header can't slip one past.
    origins = request.headers.getlist("origin")
    sites = request.headers.getlist("sec-fetch-site")
    if any(origin != settings.public_origin for origin in origins) or any(
        site not in {"same-origin", "none"} for site in sites
    ):
        fail(status.HTTP_403_FORBIDDEN, "cross_origin", "Requests must come from Cashcove itself.")


@dataclass(frozen=True)
class Auth:
    session: UserSession
    user: User


def current_auth(request: Request, db: Db) -> Auth:
    now = utcnow()
    session = sessions.load(db, request.cookies.get(sessions.SESSION_COOKIE), now)
    if session is None:
        fail(status.HTTP_401_UNAUTHORIZED, "not_signed_in", "Sign in to continue.")
    if request.method not in SAFE_METHODS and not tokens_match(
        session.csrf_token, request.headers.get(CSRF_HEADER, "")
    ):
        fail(status.HTTP_403_FORBIDDEN, "csrf", "This page is out of date. Reload and try again.")
    sessions.touch(session, now)
    db.commit()
    return Auth(session=session, user=session.user)


CurrentAuth = Annotated[Auth, Depends(current_auth)]


def require_admin(auth: CurrentAuth) -> Auth:
    if not auth.user.is_admin:
        fail(status.HTTP_403_FORBIDDEN, "admin_only", "Only admins can do that.")
    return auth


AdminAuth = Annotated[Auth, Depends(require_admin)]


def require_recent_verification(auth: CurrentAuth) -> Auth:
    """Sensitive changes need a password or passkey check from the last few minutes."""
    if utcnow() - auth.session.verified_at > sessions.RECENT_VERIFICATION:
        fail(
            status.HTTP_403_FORBIDDEN,
            "verification_required",
            "Confirm it's you to continue.",
        )
    return auth


VerifiedAuth = Annotated[Auth, Depends(require_recent_verification)]


def require_verified_admin(auth: AdminAuth) -> Auth:
    return require_recent_verification(auth)


VerifiedAdmin = Annotated[Auth, Depends(require_verified_admin)]
