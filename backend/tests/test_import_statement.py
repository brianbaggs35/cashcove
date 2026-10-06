"""A PDF statement's transactions, once read and checked, going through the import."""

import datetime as dt
import json
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.imports.files import FileProblem
from app.imports.statement import MARKER, UNKNOWN_PAYEE, UNREADABLE, is_statement, read_statement
from app.models import Account, FileFormat, FileImport, Transaction
from tests.finance import add_account, add_category, add_group, add_transaction
from tests.helpers import error
from tests.imports import previewed, upload


def document(*rows: dict[str, Any]) -> str:
    return json.dumps({"format": MARKER, "version": 1, "rows": list(rows)})


ROWS = (
    {"date": "2026-09-03", "payee": "Whole Foods", "amount": "-84.12"},
    {"date": "2026-09-05", "payee": "Acme Corp", "amount": "2400.00"},
)


@pytest.fixture
def checking(session: Session) -> Account:
    return add_account(session, "Everyday checking", mask="4410")


def test_a_document_is_told_from_the_files_banks_export() -> None:
    assert is_statement(document(*ROWS))
    assert is_statement("  \n" + document())
    assert not is_statement("Date,Description,Amount\n09/03/2026,Whole Foods,-84.12")
    assert not is_statement('{"something": "else"}')
    assert not is_statement("<OFX></OFX>")


def test_each_row_is_a_transaction_with_a_line_number() -> None:
    (statement,) = read_statement(document(*ROWS))

    assert [(row.line, row.date, row.description, row.amount) for row in statement.rows] == [
        (1, dt.date(2026, 9, 3), "Whole Foods", Decimal("-84.12")),
        (2, dt.date(2026, 9, 5), "Acme Corp", Decimal("2400.00")),
    ]
    assert all(row.problem is None for row in statement.rows)


@pytest.mark.parametrize(
    ("row", "problem"),
    [
        ({"payee": "Whole Foods", "amount": "-84.12"}, "It has no date."),
        ({"date": "2026-09-03", "payee": "Whole Foods"}, "It has no amount."),
        ({"date": "2026-09-03", "payee": "Whole Foods", "amount": "0.00"}, "Its amount is zero."),
    ],
)
def test_a_row_that_cant_be_imported_says_why(row: dict[str, Any], problem: str) -> None:
    (statement,) = read_statement(document(row))

    assert statement.rows[0].problem == problem


def test_a_row_without_a_payee_is_named() -> None:
    (statement,) = read_statement(document({"date": "2026-09-03", "payee": "  ", "amount": "-1"}))

    assert statement.rows[0].description == UNKNOWN_PAYEE


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        "[]",
        json.dumps({"format": MARKER, "version": 2, "rows": []}),
        json.dumps({"format": "other", "version": 1, "rows": []}),
        # What it doesn't know about is refused, not ignored.
        json.dumps({"format": MARKER, "version": 1, "rows": [{"payee": "x", "balance": "1"}]}),
        document({"date": "2026-02-30", "payee": "x", "amount": "-1"}),
        document({"date": "2026-09-03", "payee": "x", "amount": "-1.234"}),
        document({"date": "2026-09-03", "payee": "x" * 201, "amount": "-1"}),
        document({"date": "2026-09-03", "payee": "x", "amount": "1" * 13}),
    ],
)
def test_a_document_that_isnt_one_is_refused(text: str) -> None:
    with pytest.raises(FileProblem) as caught:
        read_statement(text)

    assert caught.value.message == UNREADABLE


def test_a_document_has_a_limit_on_its_rows() -> None:
    rows = [{"date": "2026-09-03", "payee": "x", "amount": "-1"}] * 2_001
    text = document(*rows)

    with pytest.raises(FileProblem):
        read_statement(text)


def test_the_preview_reads_it_as_a_pdf_and_checks_it_against_the_account(
    admin_client: TestClient, checking: Account, session: Session
) -> None:
    add_category(session, "Groceries", add_group(session))

    preview = previewed(
        admin_client, document(*ROWS), file_name="september.pdf", account_id=str(checking.id)
    )

    assert preview["format"] == "pdf"
    assert preview["file_name"] == "september.pdf"
    assert preview["account_id"] == str(checking.id)
    assert [
        (row["line"], row["payee"], row["amount"], row["status"]) for row in preview["rows"]
    ] == [
        (1, "Whole Foods", "-84.12", "new"),
        (2, "Acme Corp", "2400.00", "new"),
    ]
    assert preview["summary"]["new"] == 2
    assert preview["summary"]["first_date"] == "2026-09-03"
    assert preview["csv"] is None
    assert preview["profile_id"] is None
    assert preview["balance"]["suggested"] in {"move", "keep"}


def test_a_row_the_account_has_already_is_a_duplicate(
    admin_client: TestClient, checking: Account, session: Session
) -> None:
    add_transaction(session, checking, "-84.12", "Whole Foods", date=dt.date(2026, 9, 3))

    preview = previewed(admin_client, document(*ROWS), account_id=str(checking.id))

    assert [row["status"] for row in preview["rows"]] == ["duplicate", "new"]


def test_importing_it_adds_the_rows_chosen_and_remembers_it_came_from_a_pdf(
    admin_client: TestClient, checking: Account, session: Session
) -> None:
    response = admin_client.post(
        "/api/imports",
        json=upload(
            document(*ROWS),
            file_name="september.pdf",
            options={},
            account_id=str(checking.id),
            lines=[1, 2],
            balance="move",
        ),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["format"], body["file_name"], body["added"]) == ("pdf", "september.pdf", 2)
    record = session.scalars(select(FileImport)).one()
    assert record.format == FileFormat.PDF
    session.expire_all()
    transactions = session.scalars(select(Transaction).order_by(Transaction.date)).all()
    assert [(item.payee, item.amount) for item in transactions] == [
        ("Whole Foods", Decimal("-84.12")),
        ("Acme Corp", Decimal("2400.00")),
    ]
    assert all(item.import_id == record.id for item in transactions)
    stored = session.get(Account, checking.id)
    assert stored is not None
    assert stored.balance == Decimal("3315.88")


def test_a_document_that_isnt_one_cant_be_previewed(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/imports/preview", json=upload(f'{{"format": "{MARKER}", "rows": 3}}')
    )

    assert response.status_code == 422
    assert error(response) == "unreadable_file"
    assert response.json()["detail"]["message"] == UNREADABLE
