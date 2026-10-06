"""Reading a PDF statement through the API, and importing what it held."""

import base64
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import errors, statements
from app.models import Account, FileImport, Transaction
from e2e.ai import FakeAI
from tests.ai import SECRETS, configure, household
from tests.helpers import error
from tests.imports import upload
from tests.pdfs import CARD, CHECKING, make_pdf


def statement(data: bytes, name: str = "september.pdf", **fields: Any) -> dict[str, Any]:
    return {"file_name": name, "content": base64.b64encode(data).decode(), **fields}


def read(client: TestClient, data: bytes, **fields: Any) -> Any:
    return client.post("/api/ai/statements", json=statement(data, **fields))


@pytest.fixture
def ready(admin_client: TestClient, session: Session) -> TestClient:
    household(session)
    configure(admin_client)
    return admin_client


def test_a_statement_is_read_into_rows_and_the_account_it_seems_to_be_for(
    ready: TestClient, session: Session
) -> None:
    response = read(ready, make_pdf(CHECKING))

    assert response.status_code == 200, response.text
    body = response.json()
    checking = session.scalars(select(Account).where(Account.name == "Everyday checking")).one()
    assert body["file_name"] == "september.pdf"
    assert body["account_id"] == str(checking.id)
    assert body["skipped"] == 0
    assert [(row["line"], row["date"], row["payee"], row["amount"]) for row in body["rows"]] == [
        (1, "2026-09-02", "Wholefds Mkt Austin Tx", "-84.12"),
        (2, "2026-09-05", "Acme Corp Payroll Ppd", "2400.00"),
        (3, "2026-09-07", "Zelle Payment To", "-50.00"),
        (4, "2026-09-12", "Netflix.Com", "-15.49"),
        (5, "2026-09-15", "Atm Withdrawal", "-60.00"),
    ]
    assert all(row["note"] is None for row in body["rows"])


def test_a_statement_for_no_account_in_cashcove_suggests_none(
    admin_client: TestClient, fake_ai: FakeAI
) -> None:
    configure(admin_client)

    body = read(admin_client, make_pdf(CHECKING)).json()

    assert body["account_id"] is None
    assert len(body["rows"]) == 5


def test_nothing_that_identifies_anyone_leaves_through_the_api(
    ready: TestClient, fake_ai: FakeAI
) -> None:
    read(ready, make_pdf(CHECKING))
    read(ready, make_pdf(CARD))

    sent = "\n".join(request.body for request in fake_ai.requests)
    assert "WHOLEFDS" in sent
    for secret in (*SECRETS, "ALEX RIVERA", "123 Main Street", "000123-4410", "4155551234"):
        assert secret not in sent, secret


def test_reading_a_statement_is_counted_in_what_the_ai_cost(ready: TestClient) -> None:
    read(ready, make_pdf(CHECKING))

    usage = ready.get("/api/ai/usage").json()

    assert [(item["key"], item["label"], item["calls"]) for item in usage["purposes"]] == [
        ("statement", "Statements read", 1)
    ]


def test_what_was_read_goes_through_the_import_like_any_file(
    ready: TestClient, session: Session
) -> None:
    body = read(ready, make_pdf(CHECKING)).json()
    document = json.dumps(
        {
            "format": "cashcove-statement",
            "version": 1,
            "rows": [
                {"date": row["date"], "payee": row["payee"], "amount": row["amount"]}
                for row in body["rows"]
            ],
        }
    )
    options = {"file_name": "september.pdf", "account_id": body["account_id"]}

    preview = ready.post("/api/imports/preview", json=upload(document, **options)).json()
    created = ready.post(
        "/api/imports",
        json=upload(
            document,
            **options,
            options={},
            lines=[row["line"] for row in preview["rows"]],
            balance="keep",
        ),
    )

    assert preview["format"] == "pdf"
    assert [row["status"] for row in preview["rows"]] == ["new"] * 5
    assert created.status_code == 201, created.text
    assert (created.json()["format"], created.json()["added"]) == ("pdf", 5)
    assert session.scalars(select(FileImport.file_name)).all() == ["september.pdf"]
    assert len(session.scalars(select(Transaction)).all()) == 5


def test_a_statement_cant_be_read_before_ai_is_set_up(admin_client: TestClient) -> None:
    response = read(admin_client, make_pdf(CHECKING))

    assert response.status_code == 409
    assert error(response) == errors.NOT_CONFIGURED


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"GIF89a", statements.NOT_A_PDF),
        (make_pdf([]), statements.SCANNED),
        (make_pdf(["A letter from the bank."]), statements.NOTHING_FOUND),
    ],
)
def test_a_statement_that_cant_be_read_says_why(
    ready: TestClient, data: bytes, message: str
) -> None:
    response = read(ready, data)

    assert response.status_code == 422
    assert error(response) == "unreadable_statement"
    assert response.json()["detail"]["message"] == message


def test_a_file_that_arrives_broken_is_chosen_again(ready: TestClient) -> None:
    response = ready.post(
        "/api/ai/statements", json={"file_name": "a.pdf", "content": "not base64!"}
    )

    assert response.status_code == 422
    assert error(response) == "unreadable_statement"


@pytest.mark.parametrize(
    "body",
    [
        {"file_name": "a.pdf"},
        {"content": "JVBERg=="},
        {"file_name": "", "content": "JVBERg=="},
        {"file_name": "a.pdf", "content": ""},
        {"file_name": "a.pdf", "content": "A" * (14 * 1024 * 1024 + 8)},
        {"file_name": "a.pdf", "content": "JVBERg==", "account_id": "x"},
    ],
)
def test_the_request_has_to_be_exactly_a_name_and_a_file(
    ready: TestClient, body: dict[str, Any]
) -> None:
    assert ready.post("/api/ai/statements", json=body).status_code == 422


def test_what_the_ai_gets_wrong_is_an_error_not_a_guess(ready: TestClient, fake_ai: FakeAI) -> None:
    fake_ai.say = "I can't."

    response = read(ready, make_pdf(CHECKING))

    assert response.status_code == 502
    assert error(response) == errors.UNREADABLE


def test_a_key_the_provider_refuses_is_an_error(admin_client: TestClient, session: Session) -> None:
    household(session)
    configure(admin_client, api_key="not-the-key-at-all")

    response = read(admin_client, make_pdf(CHECKING))

    assert response.status_code == 502
    assert error(response) == errors.UNAUTHORIZED


def test_a_statement_that_would_share_an_account_number_is_stopped(
    ready: TestClient, fake_ai: FakeAI
) -> None:
    response = read(ready, make_pdf(["09/03  A SHOP  12345678.90"]))

    assert response.status_code == 422
    assert error(response) == errors.BLOCKED
    assert fake_ai.requests == []
