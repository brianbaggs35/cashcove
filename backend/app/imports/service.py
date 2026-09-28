"""Previewing and importing statement files, undoing imports, and saved formats."""

import base64
import binascii
import datetime as dt
import uuid
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from fastapi import status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth.deps import ApiError
from app.finance.accounts import get_account, importable_account, move_balance
from app.imports.csvfile import CsvFile, signature
from app.imports.files import FileProblem, Statement, decode, sniff
from app.imports.matching import Reviewed, review
from app.imports.ofx import read_ofx
from app.imports.qif import read_qif
from app.models import (
    Account,
    AccountSource,
    FileFormat,
    FileImport,
    ImportProfile,
    Transaction,
    TransactionSource,
    User,
)
from app.models.base import utcnow
from app.schemas.imports import (
    AccountSuggestion,
    BalanceChoice,
    BalanceOut,
    BankHistory,
    FileImportOut,
    ImportCreate,
    ImportOptions,
    ImportPreview,
    ImportPreviewRequest,
    ImportSummary,
    MatchOut,
    PreviewRow,
    ProfileSave,
    RowStatus,
    StatementOut,
)

# Imports listed on the Import tab.
RECENT = 50
IMPORTABLE = frozenset({"new", "possible_duplicate"})


@dataclass
class ReadFile:
    format: FileFormat
    options: ImportOptions
    statements: list[Statement]
    # The saved format it was read with.
    profile: ImportProfile | None
    csv: CsvFile | None

    def statement(self, index: int) -> tuple[int, Statement]:
        """The statement asked for, or the last one when there aren't that many."""
        index = min(index, len(self.statements) - 1)
        return index, self.statements[index]


def get_profile(db: Session, profile_id: uuid.UUID) -> ImportProfile:
    profile = db.get(ImportProfile, profile_id)
    if profile is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That saved format doesn't exist anymore."
        )
    return profile


def _content(content: str) -> bytes:
    try:
        return base64.b64decode(content, validate=True)
    except binascii.Error:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unreadable_file",
            "The file didn't arrive in one piece. Choose it again.",
        ) from None


def _matching_profile(db: Session, headers: list[str]) -> ImportProfile | None:
    """The saved format for files with these column names, the latest used if several."""
    if not headers:
        return None
    return db.scalar(
        select(ImportProfile)
        .where(ImportProfile.signature == signature(headers))
        .order_by(ImportProfile.last_used_at.desc().nulls_last(), ImportProfile.created_at)
        .limit(1)
    )


type Upload = ImportPreviewRequest | ImportCreate


def _read_csv(db: Session, text: str, body: Upload, locale: str, today: dt.date) -> ReadFile:
    csv_file = CsvFile(text)
    profile = get_profile(db, body.profile_id) if body.profile_id else None
    options = body.options
    if options is None:
        detected = csv_file.detect(locale)
        profile = profile or _matching_profile(db, csv_file.headers(detected.csv))
        options = _profile_options(csv_file, profile) if profile else detected
    statement = csv_file.read(options, today)
    return ReadFile(FileFormat.CSV, options, [statement], profile, csv_file)


def _profile_options(csv_file: CsvFile, profile: ImportProfile) -> ImportOptions:
    options = ImportOptions.model_validate(profile.options)
    if options.csv is not None and profile.headers:
        options.csv = csv_file.relocate(options.csv, profile.headers)
    return options


def read_file(db: Session, body: Upload, locale: str, today: dt.date) -> ReadFile:
    """The file's statements, read the way asked or the way that fits it best."""
    try:
        text = decode(_content(body.content))
        match sniff(text):
            case FileFormat.OFX:
                statements, options = read_ofx(text, body.options)
                return ReadFile(FileFormat.OFX, options, statements, None, None)
            case FileFormat.QIF:
                statements, options = read_qif(text, body.options, locale)
                return ReadFile(FileFormat.QIF, options, statements, None, None)
            case _:
                return _read_csv(db, text, body, locale, today)
    except FileProblem as problem:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "unreadable_file", problem.message
        ) from None


def _likely_account(
    db: Session, statement: Statement, profile: ImportProfile | None
) -> Account | None:
    """The account a file most likely belongs in: the one its saved format was last used
    with, the one whose last digits it has, or the only one kept by hand it could go in."""
    if profile is not None and profile.account_id is not None:
        account = db.get(Account, profile.account_id)
        if account is not None and not account.is_closed:
            return account
    accounts = list(db.scalars(select(Account).where(Account.closed_at.is_(None))))
    same = [account for account in accounts if statement.mask and account.mask == statement.mask]
    if len(same) == 1:
        return same[0]
    manual = [account for account in accounts if account.source == AccountSource.MANUAL]
    return manual[0] if len(manual) == 1 else None


def _bank_history(db: Session, account: Account) -> BankHistory | None:
    """The days of the account's transactions that came from its bank through Plaid, which
    the file's transactions are likely already among."""
    count, start, end = db.execute(
        select(func.count(), func.min(Transaction.date), func.max(Transaction.date)).where(
            Transaction.account_id == account.id,
            Transaction.source == TransactionSource.PLAID,
        )
    ).one()
    if not count:
        return None
    return BankHistory(start=start, end=None if account.is_linked else end)


def _suggested_balance(
    db: Session, account: Account, statement: Statement, reviewed: list[Reviewed]
) -> BalanceChoice:
    """Take the file's balance when it has one. Otherwise, add up the transactions when
    they're newer than every one the account has, and leave the balance alone when they're
    history it already counts. A linked account's bank keeps its balance."""
    if account.is_linked:
        return "keep"
    if statement.closing is not None:
        return "file"
    latest = db.scalar(
        select(func.max(Transaction.date)).where(Transaction.account_id == account.id)
    )
    if latest is None:
        return "move" if account.balance == 0 else "keep"
    days = [item.row.date for item in reviewed if item.status == "new" and item.row.date]
    return "move" if days and min(days) > latest else "keep"


def _row_out(item: Reviewed) -> PreviewRow:
    row = item.row
    return PreviewRow(
        line=row.line,
        date=row.date,
        amount=row.amount,
        payee=item.payee,
        description=row.description or None,
        memo=row.memo,
        category_id=item.category_id,
        status=item.status,
        problem=row.problem,
        match=MatchOut.model_validate(item.match) if item.match else None,
    )


def _summary(reviewed: list[Reviewed]) -> ImportSummary:
    days = [item.row.date for item in reviewed if item.status != "invalid" and item.row.date]

    def count(status: RowStatus) -> int:
        return sum(item.status == status for item in reviewed)

    return ImportSummary(
        rows=len(reviewed),
        new=count("new"),
        duplicates=count("duplicate"),
        possible_duplicates=count("possible_duplicate"),
        invalid=count("invalid"),
        first_date=min(days, default=None),
        last_date=max(days, default=None),
    )


def preview(db: Session, body: ImportPreviewRequest, locale: str, today: dt.date) -> ImportPreview:
    """How the file reads, and what importing it into the account would do."""
    read = read_file(db, body, locale, today)
    index, statement = read.statement(body.statement)
    if body.account_id is not None:
        account: Account | None = importable_account(db, body.account_id, lock=False)
    else:
        account = _likely_account(db, statement, read.profile)
    reviewed = review(db, statement.rows, account)
    return ImportPreview(
        format=read.format,
        file_name=body.file_name,
        options=read.options,
        profile_id=read.profile.id if read.profile else None,
        csv=read.csv.preview(read.options.csv) if read.csv and read.options.csv else None,
        statements=[
            StatementOut(
                index=number,
                name=item.name,
                institution=item.institution,
                type=item.type,
                mask=item.mask,
                currency=item.currency,
                count=len(item.rows),
            )
            for number, item in enumerate(read.statements)
        ],
        statement=index,
        new_account=AccountSuggestion(
            name=statement.name,
            institution=statement.institution,
            type=statement.type,
            mask=statement.mask,
            currency=statement.currency,
        ),
        account_id=account.id if account else None,
        bank_history=_bank_history(db, account) if account else None,
        rows=[_row_out(item) for item in reviewed],
        summary=_summary(reviewed),
        balance=BalanceOut(
            current=account.balance,
            closing=statement.closing,
            closing_date=statement.closing_date,
            suggested=_suggested_balance(db, account, statement, reviewed),
        )
        if account
        else None,
    )


def _taken(db: Session, name: str, profile_id: uuid.UUID | None) -> None:
    clash = db.scalar(
        select(ImportProfile.id).where(
            func.lower(ImportProfile.name) == name.lower(), ImportProfile.id != profile_id
        )
    )
    if clash is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "name_taken",
            f"There's already a saved format called {name}. Choose another name.",
            field="name",
        )


def _save_profile(
    db: Session, save: ProfileSave, read: ReadFile, options: ImportOptions
) -> ImportProfile:
    profile = get_profile(db, save.id) if save.id else ImportProfile()
    _taken(db, save.name, save.id)
    headers = read.csv.headers(options.csv) if read.csv and options.csv else []
    profile.name = save.name
    profile.headers = headers
    profile.signature = signature(headers) if headers else None
    profile.options = options.model_dump(mode="json")
    db.add(profile)
    # Saved first, for the import to refer to.
    db.flush()
    return profile


def _balance_change(
    account: Account, choice: BalanceChoice, total: Decimal, statement: Statement
) -> Decimal:
    if account.is_linked and choice != "keep":
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bank_balance",
            f"The bank keeps {account.name}'s balance, so importing leaves it as it is.",
        )
    if choice == "move":
        return total
    if choice == "file":
        if statement.closing is None:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "no_closing_balance",
                "This file doesn't say what the balance is. Choose another way to update it.",
            )
        return statement.closing - account.balance
    return Decimal(0)


def import_file(
    db: Session, body: ImportCreate, user: User, locale: str, today: dt.date
) -> FileImport:
    """Imports the rows chosen from the preview that still can be: ones already in the
    account by now are left out."""
    account = importable_account(db, body.account_id)
    read = read_file(db, body, locale, today)
    _, statement = read.statement(body.statement)
    wanted = set(body.lines)
    reviewed = review(db, statement.rows, account)
    chosen = [item for item in reviewed if item.row.line in wanted and item.status in IMPORTABLE]
    if not chosen:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "nothing_to_import",
            f"Those transactions are already in {account.name}, or can't be read.",
        )
    total = sum((item.row.amount or Decimal(0) for item in chosen), Decimal(0))
    change = _balance_change(account, body.balance, total, statement)
    now = utcnow()
    profile = read.profile
    if body.save_profile is not None and read.format == FileFormat.CSV:
        profile = _save_profile(db, body.save_profile, read, body.options)
    if profile is not None:
        profile.account_id = account.id
        profile.last_used_at = now
    days = [item.row.date for item in chosen if item.row.date]
    record = FileImport(
        account_id=account.id,
        profile_id=profile.id if profile else None,
        file_name=body.file_name,
        format=read.format,
        added=len(chosen),
        skipped=len(statement.rows) - len(chosen),
        total=total,
        balance_change=change,
        first_date=min(days),
        last_date=max(days),
        created_by_id=user.id,
        created_at=now,
    )
    db.add(record)
    db.flush()
    for item in chosen:
        row = item.row
        db.add(
            Transaction(
                account_id=account.id,
                date=row.date,
                amount=row.amount,
                payee=item.payee,
                original_description=row.description or None,
                category_id=item.category_id,
                notes=row.memo,
                source=TransactionSource.FILE,
                external_id=row.external_id,
                import_id=record.id,
            )
        )
    if change:
        account.balance += change
        account.balance_updated_at = now
    db.commit()
    return record


def undo(db: Session, import_id: uuid.UUID) -> int:
    """Deletes what an import added, wherever those transactions are now, and puts back the
    part of its change to the balance that's still in effect. Returns how many it deleted.

    Transactions of it that were deleted, changed or moved since each moved the balance
    already, so only the rest is put back: the balance ends up as if the import never
    happened, with everything else that changed since still counted.
    """
    record = db.get(FileImport, import_id, with_for_update=True)
    if record is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "not_found", "That import has been undone already."
        )
    rows = list(
        db.scalars(select(Transaction).where(Transaction.import_id == record.id).with_for_update())
    )
    remaining = sum((row.amount for row in rows if row.account_id == record.account_id), Decimal(0))
    changes: defaultdict[uuid.UUID, Decimal] = defaultdict(Decimal)
    changes[record.account_id] = record.total - remaining - record.balance_change
    # Ones moved to another account come off its balance, as deleting them there would.
    for row in rows:
        if row.account_id != record.account_id:
            changes[row.account_id] -= row.amount
    now = utcnow()
    # Locked in the same order every time, as deleting transactions locks them.
    for account_id in sorted(changes):
        move_balance(get_account(db, account_id, lock=True), changes[account_id], now)
    db.execute(delete(Transaction).where(Transaction.id.in_([row.id for row in rows])))
    db.delete(record)
    db.commit()
    return len(rows)


def recent_imports(db: Session) -> list[FileImportOut]:
    rows = db.execute(
        select(FileImport, User.name)
        .outerjoin(User, User.id == FileImport.created_by_id)
        .order_by(FileImport.created_at.desc(), FileImport.id)
        .limit(RECENT)
    ).all()
    return [
        FileImportOut.model_validate(record).model_copy(update={"created_by": name})
        for record, name in rows
    ]


def rename_profile(db: Session, profile_id: uuid.UUID, name: str) -> ImportProfile:
    profile = get_profile(db, profile_id)
    _taken(db, name, profile.id)
    profile.name = name
    db.commit()
    return profile
