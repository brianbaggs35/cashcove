"""Importing statement files. Everyone can see what's been imported and the saved formats;
only admins import files, undo imports, and rename or delete saved formats."""

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.auth.deps import AdminAuth, CurrentAuth, Db
from app.auth.service import load_preferences
from app.imports.service import (
    get_profile,
    import_file,
    preview,
    recent_imports,
    rename_profile,
    undo,
)
from app.models import ImportProfile
from app.models.base import utcnow
from app.schemas.imports import (
    FileImportOut,
    ImportCreate,
    ImportPreview,
    ImportPreviewRequest,
    ImportProfileOut,
    ImportProfileUpdate,
)
from app.schemas.transactions import BulkResult

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("")
def list_imports(auth: CurrentAuth, db: Db) -> list[FileImportOut]:
    """The latest imports, newest first."""
    return recent_imports(db)


@router.post("/preview")
def preview_import(body: ImportPreviewRequest, auth: AdminAuth, db: Db) -> ImportPreview:
    """How a file reads, and which of its transactions the account already has. Nothing is
    saved."""
    locale = load_preferences(db).general.locale
    return preview(db, body, locale, utcnow().date())


@router.post("", status_code=status.HTTP_201_CREATED)
def create_import(body: ImportCreate, auth: AdminAuth, db: Db) -> FileImportOut:
    """Imports the chosen transactions from a file into an open account."""
    locale = load_preferences(db).general.locale
    record = import_file(db, body, auth.user, locale, utcnow().date())
    return FileImportOut.model_validate(record).model_copy(update={"created_by": auth.user.name})


@router.delete("/{import_id}")
def undo_import(import_id: uuid.UUID, auth: AdminAuth, db: Db) -> BulkResult:
    """Deletes the transactions an import added, and puts the balance back."""
    return BulkResult(count=undo(db, import_id))


@router.get("/profiles")
def list_profiles(auth: CurrentAuth, db: Db) -> list[ImportProfileOut]:
    profiles = db.scalars(select(ImportProfile).order_by(func.lower(ImportProfile.name)))
    return [ImportProfileOut.model_validate(profile) for profile in profiles]


@router.patch("/profiles/{profile_id}")
def update_profile(
    profile_id: uuid.UUID, body: ImportProfileUpdate, auth: AdminAuth, db: Db
) -> ImportProfileOut:
    return ImportProfileOut.model_validate(rename_profile(db, profile_id, body.name))


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Forgets a saved format. Files imported with it stay."""
    db.delete(get_profile(db, profile_id))
    db.commit()
