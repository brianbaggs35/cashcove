import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.imports.ofx import NO_TRANSACTIONS
from app.models import (
    Account,
    AccountType,
    FileImport,
    ImportProfile,
    Transaction,
    TransactionSource,
)
from app.models.base import utcnow
from tests.finance import add_account, add_category, add_group, add_transaction, linked_account
from tests.helpers import error
from tests.imports import (
    CARD_CSV,
    CARD_OFX,
    CHECKING_CSV,
    HEADERLESS_CSV,
    OFX,
    QIF,
    previewed,
    upload,
)

# A statement with a summary above its transactions, which grows some months.
SUMMARIZED = """Description,,Summary Amt.
Beginning balance as of 09/01/2026,,"1,000.00"
Ending balance as of 09/26/2026,,"1,200.00"

Date,Description,Amount,Running Bal.
09/02/2026,"PAYROLL",500.00,"1,500.00"
09/03/2026,"RENT",-300.00,"1,200.00"
"""


@pytest.fixture
def checking(session: Session) -> Account:
    return add_account(session, "Everyday checking", mask="4410")


@pytest.fixture
def card(session: Session) -> Account:
    return add_account(
        session, "Travel card", type=AccountType.CREDIT_CARD, balance="-612.40", mask="3333"
    )


@pytest.fixture
def categories(session: Session) -> dict[str, str]:
    group = add_group(session)
    names = [
        "Groceries",
        "Travel",
        "Rideshare & taxis",
        "Credit card payments",
        "Utilities",
        "Paycheck",
    ]
    return {name: str(add_category(session, name, group).id) for name in names}


def balance_of(session: Session, account: Account) -> Decimal:
    session.expire_all()
    stored = session.get(Account, account.id)
    assert stored is not None
    return stored.balance


def statuses(preview: dict[str, Any]) -> list[str]:
    return [row["status"] for row in preview["rows"]]


def new_lines(preview: dict[str, Any]) -> list[int]:
    return [row["line"] for row in preview["rows"] if row["status"] == "new"]


def import_response(
    client: TestClient,
    text: str,
    account: Account,
    *,
    balance: str = "keep",
    file_name: str = "statement.csv",
    chosen: list[int] | None = None,
    **fields: Any,
) -> Any:
    preview = previewed(client, text, file_name=file_name, account_id=str(account.id))
    body = upload(
        text,
        file_name,
        options=preview["options"],
        profile_id=preview["profile_id"],
        account_id=str(account.id),
        lines=chosen or new_lines(preview) or [1],
        balance=balance,
        **fields,
    )
    return client.post("/api/imports", json=body)


def imported(client: TestClient, text: str, account: Account, **fields: Any) -> dict[str, Any]:
    response = import_response(client, text, account, **fields)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def transactions(session: Session) -> list[Transaction]:
    session.expire_all()
    return list(
        session.scalars(select(Transaction).order_by(Transaction.date, Transaction.created_at))
    )


# ---- Who can do what -----------------------------------------------------------------------


def test_everyone_sees_imports_and_saved_formats_but_only_admins_change_them(
    viewer_client: TestClient, checking: Account
) -> None:
    assert viewer_client.get("/api/imports").json() == []
    assert viewer_client.get("/api/imports/profiles").json() == []
    somewhere = uuid.uuid4()
    body = upload(CHECKING_CSV, options={}, account_id=str(checking.id), lines=[2], balance="keep")

    assert viewer_client.post("/api/imports/preview", json=upload(CHECKING_CSV)).status_code == 403
    assert viewer_client.post("/api/imports", json=body).status_code == 403
    assert viewer_client.delete(f"/api/imports/{somewhere}").status_code == 403
    rename = viewer_client.patch(f"/api/imports/profiles/{somewhere}", json={"name": "Harbor"})
    assert rename.status_code == 403
    assert viewer_client.delete(f"/api/imports/profiles/{somewhere}").status_code == 403


def test_imports_need_someone_signed_in(client: TestClient) -> None:
    assert client.get("/api/imports").status_code == 401
    assert client.post("/api/imports/preview", json=upload(CHECKING_CSV)).status_code == 401


# ---- Previewing ----------------------------------------------------------------------------


def test_a_csv_file_previews_with_its_layout_and_what_importing_it_would_do(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    preview = previewed(
        admin_client, CHECKING_CSV, file_name="checking.csv", account_id=str(checking.id)
    )

    assert (preview["format"], preview["file_name"], preview["profile_id"]) == (
        "csv",
        "checking.csv",
        None,
    )
    assert preview["options"]["csv"]["columns"]["id"] == 4
    assert [column["name"] for column in preview["csv"]["columns"]] == [
        "Date",
        "Description",
        "Amount",
        "Balance",
        "Transaction ID",
    ]
    assert preview["csv"]["missing"] == []
    assert preview["statements"] == [
        {
            "index": 0,
            "name": None,
            "institution": None,
            "type": None,
            "mask": None,
            "currency": None,
            "count": 5,
        }
    ]
    assert (preview["statement"], preview["account_id"]) == (0, str(checking.id))
    assert preview["rows"][0] == {
        "line": 2,
        "date": "2026-09-01",
        "amount": "1875.00",
        "payee": "NORTHWIND HEALTH PAYROLL PPD",
        "description": "NORTHWIND HEALTH PAYROLL PPD",
        "memo": None,
        "category_id": None,
        "status": "new",
        "problem": None,
        "match": None,
        "automation": None,
    }
    assert preview["summary"] == {
        "rows": 5,
        "new": 5,
        "duplicates": 0,
        "possible_duplicates": 0,
        "invalid": 0,
        "first_date": "2026-09-01",
        "last_date": "2026-09-05",
        "sorted": 0,
    }
    assert preview["balance"] == {
        "current": "1000.00",
        "closing": "2685.48",
        "closing_date": "2026-09-05",
        "suggested": "file",
    }
    # Nothing's saved until it's imported.
    assert transactions(session) == []


def test_changed_options_are_read_as_sent(admin_client: TestClient, checking: Account) -> None:
    detected = previewed(admin_client, CHECKING_CSV)["options"]

    flipped = previewed(admin_client, CHECKING_CSV, options={**detected, "flip": True})

    assert flipped["options"]["flip"] is True
    assert flipped["rows"][0]["amount"] == "-1875.00"
    # A CSV file can't be read without its layout.
    unread = previewed(admin_client, CHECKING_CSV, options={})
    assert (unread["csv"], unread["rows"], unread["summary"]["first_date"]) == (None, [], None)


def test_columns_that_arent_chosen_yet_are_listed(admin_client: TestClient) -> None:
    preview = previewed(admin_client, "Posted,Note\nyesterday,coffee\n")

    assert preview["csv"]["missing"] == ["date", "amount"]
    assert preview["rows"] == []
    assert preview["balance"] is None


def test_rows_that_cant_be_read_are_shown_with_why(admin_client: TestClient) -> None:
    preview = previewed(
        admin_client, "Date,Payee,Amount\n09/26/2026,SHOP,lots\n09/25/2026,CAFE,-2\n"
    )

    assert statuses(preview) == ["invalid", "new"]
    assert preview["rows"][0]["problem"] == "“lots” isn't an amount."
    assert (preview["summary"]["invalid"], preview["summary"]["first_date"]) == (1, "2026-09-25")


def test_a_column_holds_one_thing(admin_client: TestClient) -> None:
    options = {"csv": {"columns": {"date": 0, "amount": 0}}}

    response = admin_client.post("/api/imports/preview", json=upload(CHECKING_CSV, options=options))

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "column_reused"


def test_transactions_without_a_description_are_from_an_unknown_payee(
    admin_client: TestClient,
) -> None:
    preview = previewed(admin_client, "09/26/2026,-1.00\n09/25/2026,-2.00\n")

    assert [row["payee"] for row in preview["rows"]] == ["Unknown payee", "Unknown payee"]


def test_the_likeliest_account_is_chosen(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    # By the last digits of the account number.
    assert previewed(admin_client, OFX)["account_id"] == str(checking.id)
    assert previewed(admin_client, CARD_OFX)["account_id"] == str(card.id)
    # Not when there's no telling.
    unsure = previewed(admin_client, CHECKING_CSV)
    assert (unsure["account_id"], unsure["balance"]) == (None, None)
    assert statuses(unsure) == ["new"] * 5
    # The only account kept by hand that's open.
    linked_account(session)
    card.closed_at = utcnow()
    session.commit()
    assert previewed(admin_client, CHECKING_CSV)["account_id"] == str(checking.id)


@pytest.mark.parametrize(
    ("account", "status_code", "code"),
    [("closed", 409, "account_closed"), ("gone", 422, "unknown_account")],
)
def test_files_only_go_into_open_accounts(
    admin_client: TestClient, session: Session, account: str, status_code: int, code: str
) -> None:
    accounts = {
        "closed": add_account(session, "Old savings", closed_at=utcnow()).id,
        "gone": uuid.uuid4(),
    }

    response = admin_client.post(
        "/api/imports/preview", json=upload(CHECKING_CSV, account_id=str(accounts[account]))
    )

    assert response.status_code == status_code
    assert error(response) == code


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (b"%PDF-1.7", "PDF statements can't be imported."),
        (b"<OFX></OFX>", NO_TRANSACTIONS),
    ],
)
def test_files_that_cant_be_read_say_why(
    admin_client: TestClient, content: bytes, message: str
) -> None:
    response = admin_client.post("/api/imports/preview", json=upload(content))

    assert response.status_code == 422
    assert error(response) == "unreadable_file"
    assert response.json()["detail"]["message"].startswith(message)


def test_files_that_arrive_broken_are_chosen_again(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/imports/preview", json={"file_name": "statement.csv", "content": "not base64!"}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "unreadable_file",
        "message": "The file didn't arrive in one piece. Choose it again.",
    }


def test_saved_formats_that_are_gone_say_so(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/api/imports/preview", json=upload(CHECKING_CSV, profile_id=str(uuid.uuid4()))
    )

    assert response.status_code == 404
    assert error(response) == "not_found"


# ---- OFX and QIF files ---------------------------------------------------------------------


def test_ofx_files_suggest_their_account_and_balance(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    preview = previewed(admin_client, OFX, file_name="harbor.qfx", account_id=str(checking.id))

    assert (preview["format"], preview["csv"]) == ("ofx", None)
    assert preview["new_account"] == {
        "name": None,
        "institution": "Harbor Credit Union",
        "type": "checking",
        "mask": "4410",
        "currency": "USD",
    }
    assert [(row["payee"], row["memo"]) for row in preview["rows"]] == [
        ("WHOLEFDS MKT & CO", "AUSTIN TX"),
        ("CHECK 1043", "Check 1043"),
        ("ACME CORP", None),
    ]
    assert preview["balance"]["suggested"] == "file"

    record = imported(admin_client, OFX, checking, balance="file", file_name="harbor.qfx")

    assert (record["format"], record["added"], record["total"]) == ("ofx", 3, "2257.50")
    assert balance_of(session, checking) == Decimal("2310.55")
    assert [row.external_id for row in transactions(session)] == ["A3", "A2", "A1"]


def test_files_with_several_accounts_are_imported_one_at_a_time(
    admin_client: TestClient, checking: Account
) -> None:
    card = "<CCSTMTRS><CCACCTFROM><ACCTID>9999</CCACCTFROM><BANKTRANLIST>"
    card += "<STMTTRN><DTPOSTED>20260924<TRNAMT>-15.49<FITID>C1<NAME>NETFLIX</STMTTRN>"
    text = OFX.replace("</STMTRS>", f"</STMTRS>{card}</BANKTRANLIST></CCSTMTRS>")

    preview = previewed(admin_client, text, statement=1)

    assert [statement["count"] for statement in preview["statements"]] == [3, 1]
    assert preview["statement"] == 1
    assert preview["new_account"]["type"] == "credit_card"
    assert [row["payee"] for row in preview["rows"]] == ["NETFLIX"]
    # Past the last one is the last one.
    assert previewed(admin_client, text, statement=5)["statement"] == 1


def test_options_sent_for_ofx_files_are_used(admin_client: TestClient) -> None:
    preview = previewed(admin_client, OFX, options={"flip": True})

    assert preview["rows"][0]["amount"] == "42.50"


def test_qif_files_name_their_account_and_categories(
    admin_client: TestClient, checking: Account, categories: dict[str, str]
) -> None:
    preview = previewed(admin_client, QIF, account_id=str(checking.id))

    assert preview["format"] == "qif"
    assert preview["new_account"]["name"] == "Everyday Checking"
    assert [(row["payee"], row["category_id"]) for row in preview["rows"]] == [
        ("WHOLEFDS MKT", categories["Groceries"]),
        ("Parkside Apartments", None),
    ]


# ---- Duplicates ----------------------------------------------------------------------------


def test_transactions_already_in_the_account_are_left_out(
    admin_client: TestClient, checking: Account, card: Account
) -> None:
    imported(admin_client, CHECKING_CSV, checking)
    imported(admin_client, CARD_CSV, card)
    # A later export that overlaps the last one.
    later = CHECKING_CSV + "09/08/2026,CORNER MARKET,-12.00,2673.48,T1006\n"

    again = previewed(admin_client, later, account_id=str(checking.id))

    assert statuses(again) == ["duplicate"] * 5 + ["new"]
    assert again["summary"]["duplicates"] == 5
    match = again["rows"][0]["match"]
    assert (match["date"], match["amount"], match["payee"], match["source"]) == (
        "2026-09-01",
        "1875.00",
        "NORTHWIND HEALTH PAYROLL PPD",
        "file",
    )
    # Files without IDs are matched by date, amount and description.
    assert statuses(previewed(admin_client, CARD_CSV, account_id=str(card.id))) == ["duplicate"] * 4


def test_the_same_coffee_twice_is_two_transactions(
    admin_client: TestClient, checking: Account
) -> None:
    coffees = (
        "Date,Description,Amount\n09/03/2026,BLUE BOTTLE,-4.50\n09/03/2026,BLUE BOTTLE,-4.50\n"
    )
    assert statuses(previewed(admin_client, coffees, account_id=str(checking.id))) == ["new"] * 2

    imported(admin_client, coffees, checking, chosen=[2])

    assert statuses(previewed(admin_client, coffees, account_id=str(checking.id))) == [
        "duplicate",
        "new",
    ]


def test_rows_repeated_in_the_file_are_left_out(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    text = (
        "Date,Description,Amount,Transaction ID\n"
        "09/03/2026,COFFEE,-4.50,X1\n09/03/2026,COFFEE,-4.50,X1\n09/04/2026,BAGEL,-3.00,X1\n"
    )

    preview = previewed(admin_client, text, account_id=str(checking.id))

    assert statuses(preview) == ["new", "duplicate", "new"]
    assert preview["rows"][1]["problem"] == "It's in the file twice."
    imported(admin_client, text, checking)
    # The bagel shared the coffee's ID, so it goes without one.
    assert [(row.payee, row.external_id) for row in transactions(session)] == [
        ("COFFEE", "X1"),
        ("BAGEL", None),
    ]


def test_ids_that_arent_the_banks_own_are_left_off(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    header = "Date,Description,Amount,Ref No\n"
    imported(admin_client, f"{header}09/03/2026,RENT,-1000.00,RENT\n", checking)

    # The same reference on another amount, or weeks later, is another transaction.
    later = f"{header}10/03/2026,RENT,-1000.00,RENT\n10/04/2026,RENT,-1100.00,RENT\n"
    preview = previewed(admin_client, later, account_id=str(checking.id))

    assert statuses(preview) == ["new", "new"]
    imported(admin_client, later, checking)
    assert [row.external_id for row in transactions(session)] == ["RENT", None, None]


def test_transactions_entered_by_hand_might_be_the_same(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    add_transaction(session, checking, "-84.12", "Whole Foods", date=dt.date(2026, 9, 1))
    # Imported ones need the same day, since the same bank dates them the same way.
    add_transaction(
        session,
        checking,
        "-96.40",
        "Power",
        date=dt.date(2026, 9, 4),
        source=TransactionSource.FILE,
    )
    add_transaction(
        session,
        checking,
        "-4.50",
        "COFFEE SHOP",
        date=dt.date(2026, 9, 3),
        source=TransactionSource.FILE,
    )

    preview = previewed(admin_client, CHECKING_CSV, account_id=str(checking.id))

    assert statuses(preview) == ["new", "possible_duplicate", "possible_duplicate", "new", "new"]
    match = preview["rows"][1]["match"]
    assert (match["date"], match["payee"], match["source"]) == (
        "2026-09-01",
        "Whole Foods",
        "manual",
    )
    assert preview["summary"]["possible_duplicates"] == 2
    # They can be imported anyway.
    record = imported(admin_client, CHECKING_CSV, checking, chosen=[3])
    assert record["added"] == 1


# ---- Payees and categories -----------------------------------------------------------------


def test_payees_and_categories_are_learned_from_earlier_transactions(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    earlier = dt.date(2026, 8, 1)
    add_transaction(
        session,
        checking,
        "-50.00",
        "Whole Foods",
        date=earlier,
        original_description="wholefds  mkt #10234 austin tx",
        category_id=uuid.UUID(categories["Groceries"]),
    )
    add_transaction(
        session,
        checking,
        "-90.00",
        "City Power & Light",
        date=earlier,
        category_id=uuid.UUID(categories["Utilities"]),
    )
    # Renamed, but never categorized; another of the payee's was.
    add_transaction(
        session,
        checking,
        "1800.00",
        "Northwind",
        date=earlier,
        original_description="NORTHWIND HEALTH PAYROLL PPD",
    )
    add_transaction(
        session,
        checking,
        "1800.00",
        "Northwind",
        date=earlier,
        category_id=uuid.UUID(categories["Paycheck"]),
    )

    preview = previewed(admin_client, CHECKING_CSV, account_id=str(checking.id))

    assert [(row["payee"], row["category_id"]) for row in preview["rows"]] == [
        ("Northwind", categories["Paycheck"]),
        ("Whole Foods", categories["Groceries"]),
        ("BLUE BOTTLE COFFEE", None),
        ("BLUE BOTTLE COFFEE", None),
        ("CITY POWER & LIGHT", categories["Utilities"]),
    ]


def test_the_banks_own_categories_are_matched_to_the_households(
    admin_client: TestClient, card: Account, categories: dict[str, str]
) -> None:
    preview = previewed(admin_client, CARD_CSV, account_id=str(card.id))

    assert [row["category_id"] for row in preview["rows"]] == [
        categories["Travel"],
        categories["Rideshare & taxis"],
        categories["Credit card payments"],
        categories["Groceries"],
    ]


# ---- The balance ---------------------------------------------------------------------------


def test_the_suggested_balance_update_fits_the_account(
    admin_client: TestClient, session: Session
) -> None:
    empty = add_account(session, "New card", type=AccountType.CREDIT_CARD, balance="0.00")
    started = add_account(session, "Old card", type=AccountType.CREDIT_CARD, balance="-50.00")
    kept = add_account(session, "Kept card", type=AccountType.CREDIT_CARD)
    add_transaction(session, kept, "-5.00", date=dt.date(2026, 9, 1))
    behind = add_account(session, "Behind card", type=AccountType.CREDIT_CARD)
    add_transaction(session, behind, "-5.00", date=dt.date(2026, 9, 25))

    def suggested(account: Account) -> str:
        preview = previewed(admin_client, CARD_CSV, account_id=str(account.id))
        return str(preview["balance"]["suggested"])

    # Adding them up, for a new account and for transactions newer than the account's.
    assert suggested(empty) == "move"
    assert suggested(kept) == "move"
    # Keeping it, when it already counts them.
    assert suggested(started) == "keep"
    assert suggested(behind) == "keep"


# ---- Importing -----------------------------------------------------------------------------


def test_importing_adds_the_transactions_and_takes_the_files_balance(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    record = imported(admin_client, CHECKING_CSV, checking, balance="file", file_name="sep.csv")

    assert record == {
        "id": record["id"],
        "account_id": str(checking.id),
        "profile_id": None,
        "file_name": "sep.csv",
        "format": "csv",
        "added": 5,
        "skipped": 0,
        "total": "1685.48",
        "balance_change": "1685.48",
        "first_date": "2026-09-01",
        "last_date": "2026-09-05",
        "created_at": record["created_at"],
        "created_by": "Alex Rivera",
        "sorted": 0,
        # AI isn't set up, so nothing gave a second opinion.
        "ai_review_id": None,
    }
    assert balance_of(session, checking) == Decimal("2685.48")
    first = transactions(session)[0]
    assert (first.source, first.external_id, str(first.import_id), first.payee) == (
        TransactionSource.FILE,
        "T1001",
        record["id"],
        "NORTHWIND HEALTH PAYROLL PPD",
    )
    assert first.original_description == "NORTHWIND HEALTH PAYROLL PPD"
    # It's listed, and its transactions can be found by it.
    assert admin_client.get("/api/imports").json() == [record]
    listed = admin_client.get("/api/transactions", params={"import_id": record["id"]}).json()
    assert listed["total"] == 5
    assert listed["items"][0]["import_id"] == record["id"]


def test_importing_can_add_up_the_transactions_or_leave_the_balance(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    moved = imported(admin_client, CARD_CSV, card, balance="move", chosen=[2, 4])

    assert (moved["added"], moved["skipped"], moved["total"]) == (2, 2, "13.80")
    assert balance_of(session, card) == Decimal("-598.60")
    kept = imported(admin_client, CHECKING_CSV, checking, balance="keep")
    assert kept["balance_change"] == "0.00"
    assert balance_of(session, checking) == Decimal("1000.00")


def test_files_without_a_balance_cant_set_it(
    admin_client: TestClient, session: Session, card: Account
) -> None:
    response = import_response(admin_client, CARD_CSV, card, balance="file")

    assert response.status_code == 422
    assert error(response) == "no_closing_balance"
    assert transactions(session) == []


def test_transactions_already_imported_arent_imported_again(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    imported(admin_client, CHECKING_CSV, checking)

    response = import_response(admin_client, CHECKING_CSV, checking, chosen=[2, 3])

    assert response.status_code == 409
    assert error(response) == "nothing_to_import"
    assert len(transactions(session)) == 5


def test_files_fill_in_a_linked_accounts_history_and_leave_its_balance_to_the_bank(
    admin_client: TestClient, session: Session
) -> None:
    visa = linked_account(session, mask="3333")
    # It's the account the file is for, by its last digits, and the bank keeps its balance.
    preview = previewed(admin_client, CARD_OFX)
    assert (preview["account_id"], preview["bank_history"]) == (str(visa.id), None)
    assert preview["balance"]["suggested"] == "keep"
    # The days the bank's own transactions cover, which go on while it's linked.
    add_transaction(
        session, visa, "-9.99", date=dt.date(2026, 3, 4), source=TransactionSource.PLAID
    )
    add_transaction(
        session, visa, "-4.50", date=dt.date(2026, 9, 1), source=TransactionSource.PLAID
    )
    add_transaction(session, visa, "-1.00", date=dt.date(2025, 1, 2))
    history = previewed(admin_client, CARD_OFX)["bank_history"]
    assert history == {"start": "2026-03-04", "end": None}

    moved = import_response(admin_client, CARD_OFX, visa, balance="move", file_name="card.qfx")

    assert moved.status_code == 422
    assert error(moved) == "bank_balance"
    record = imported(admin_client, CARD_OFX, visa, file_name="card.qfx")
    assert (record["added"], record["balance_change"]) == (1, "0.00")
    assert balance_of(session, visa) == Decimal("-612.40")
    # Undoing it leaves the balance to the bank too.
    assert admin_client.delete(f"/api/imports/{record['id']}").json() == {"count": 1}
    assert balance_of(session, visa) == Decimal("-612.40")


def test_the_banks_history_ends_when_it_stops_keeping_the_account(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    for day in (dt.date(2025, 2, 1), dt.date(2025, 11, 30)):
        add_transaction(session, checking, "-20.00", date=day, source=TransactionSource.PLAID)

    preview = previewed(admin_client, CHECKING_CSV, account_id=str(checking.id))

    assert preview["bank_history"] == {"start": "2025-02-01", "end": "2025-11-30"}


# ---- Saved formats -------------------------------------------------------------------------


def test_a_saved_format_reads_the_banks_next_file(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    record = imported(admin_client, SUMMARIZED, checking, save_profile={"name": "Harbor"})

    [profile] = admin_client.get("/api/imports/profiles").json()
    assert record["profile_id"] == profile["id"]
    assert profile["name"] == "Harbor"
    assert profile["headers"] == ["Date", "Description", "Amount", "Running Bal."]
    assert profile["options"]["csv"]["skip_rows"] == 4
    assert profile["account_id"] == str(checking.id)
    assert profile["last_used_at"] is not None
    # The next file has a longer summary; it's still found, and so is its account.
    longer = SUMMARIZED.replace("\n\n", "\nTotal credits,,500.00\n\n").replace(
        "09/03/2026", "09/28/2026"
    )
    preview = previewed(admin_client, longer)
    assert (preview["profile_id"], preview["account_id"]) == (profile["id"], str(checking.id))
    assert preview["options"]["csv"]["skip_rows"] == 5
    assert statuses(preview) == ["duplicate", "new"]
    # Once that account's closed, the file's account is worked out as for any other.
    checking.closed_at = utcnow()
    session.commit()
    assert previewed(admin_client, longer)["account_id"] == str(card.id)


def test_saved_formats_are_updated_or_their_names_kept_apart(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    first = imported(admin_client, CARD_CSV, card, save_profile={"name": "Travel card"})
    profile_id = first["profile_id"]
    # Saving again updates it.
    imported(
        admin_client,
        CHECKING_CSV,
        checking,
        save_profile={"id": profile_id, "name": "Harbor checking"},
    )
    [profile] = admin_client.get("/api/imports/profiles").json()
    assert (profile["id"], profile["name"]) == (profile_id, "Harbor checking")
    assert profile["headers"][-1] == "Transaction ID"

    response = import_response(
        admin_client, HEADERLESS_CSV, checking, save_profile={"name": "harbor CHECKING"}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["field"] == "name"
    assert error(response) == "name_taken"


def test_files_without_column_names_use_their_saved_format_when_its_chosen(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    record = imported(admin_client, HEADERLESS_CSV, checking, save_profile={"name": "Wells"})
    profile = session.get(ImportProfile, uuid.UUID(record["profile_id"]))
    assert profile is not None
    assert (profile.headers, profile.signature) == ([], None)

    assert previewed(admin_client, HEADERLESS_CSV)["profile_id"] is None
    chosen = previewed(admin_client, HEADERLESS_CSV, profile_id=record["profile_id"])
    assert chosen["profile_id"] == record["profile_id"]
    assert statuses(chosen) == ["duplicate"] * 3


def test_formats_are_only_saved_for_csv_files(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    record = imported(admin_client, OFX, checking, save_profile={"name": "Harbor"})

    assert record["profile_id"] is None
    assert session.scalar(select(func.count()).select_from(ImportProfile)) == 0


def test_saved_formats_can_be_renamed_and_forgotten(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    beta = imported(admin_client, CARD_CSV, card, save_profile={"name": "beta"})["profile_id"]
    alpha_import = imported(admin_client, CHECKING_CSV, checking, save_profile={"name": "Alpha"})
    alpha = alpha_import["profile_id"]
    names = [profile["name"] for profile in admin_client.get("/api/imports/profiles").json()]
    assert names == ["Alpha", "beta"]

    renamed = admin_client.patch(f"/api/imports/profiles/{beta}", json={"name": "Travel card"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Travel card"
    taken = admin_client.patch(f"/api/imports/profiles/{beta}", json={"name": "ALPHA"})
    assert (taken.status_code, error(taken)) == (409, "name_taken")
    gone = admin_client.patch(f"/api/imports/profiles/{uuid.uuid4()}", json={"name": "Gamma"})
    assert (gone.status_code, error(gone)) == (404, "not_found")

    assert admin_client.delete(f"/api/imports/profiles/{alpha}").status_code == 204
    assert admin_client.delete(f"/api/imports/profiles/{alpha}").status_code == 404
    # The import it was used for stays.
    [kept] = [
        item for item in admin_client.get("/api/imports").json() if item["id"] == alpha_import["id"]
    ]
    assert kept["profile_id"] is None


# ---- Undoing -------------------------------------------------------------------------------


def test_undoing_an_import_puts_everything_back(
    admin_client: TestClient, session: Session, checking: Account
) -> None:
    record = imported(admin_client, CHECKING_CSV, checking, balance="file")

    response = admin_client.delete(f"/api/imports/{record['id']}")

    assert response.status_code == 200
    assert response.json() == {"count": 5}
    assert balance_of(session, checking) == Decimal("1000.00")
    assert transactions(session) == []
    assert admin_client.get("/api/imports").json() == []
    again = admin_client.delete(f"/api/imports/{record['id']}")
    assert (again.status_code, error(again)) == (404, "not_found")


def test_undoing_counts_what_changed_since(
    admin_client: TestClient, session: Session, checking: Account, card: Account
) -> None:
    record = imported(admin_client, CHECKING_CSV, checking, balance="file")
    _, groceries, coffee, _, power = transactions(session)
    # One deleted, one changed, and one moved to another account, each moving the balances.
    assert admin_client.delete(f"/api/transactions/{groceries.id}").status_code == 204
    edited = admin_client.patch(f"/api/transactions/{power.id}", json={"amount": "-99.99"})
    assert edited.status_code == 200
    moved = admin_client.patch(f"/api/transactions/{coffee.id}", json={"account_id": str(card.id)})
    assert moved.status_code == 200
    assert balance_of(session, checking) != Decimal("2685.48")

    response = admin_client.delete(f"/api/imports/{record['id']}")

    assert response.json() == {"count": 4}
    assert balance_of(session, checking) == Decimal("1000.00")
    assert balance_of(session, card) == Decimal("-612.40")
    assert transactions(session) == []
    assert session.get(FileImport, uuid.UUID(record["id"])) is None


def test_undoing_an_import_that_added_up_its_transactions(
    admin_client: TestClient, session: Session, card: Account
) -> None:
    record = imported(admin_client, CARD_CSV, card, balance="move")
    assert balance_of(session, card) == Decimal("-633.70")

    admin_client.delete(f"/api/imports/{record['id']}")

    assert balance_of(session, card) == Decimal("-612.40")


def test_imported_transactions_are_sorted_by_automations_and_subscriptions(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    automation = admin_client.post(
        "/api/automations",
        json={
            "name": "Coffee",
            "payees": ["blue bottle coffee"],
            "category_id": categories["Groceries"],
            "apply_to": "future",
        },
    )
    assert automation.status_code == 201, automation.text
    subscription = admin_client.post(
        "/api/subscriptions",
        json={
            "name": "Power",
            "payee": "City Power & Light",
            "amount": "96.40",
            "frequency": "monthly",
            "account_id": str(checking.id),
            "next_due_date": "2026-09-05",
            "category_id": categories["Utilities"],
        },
    ).json()

    imported(admin_client, CHECKING_CSV, checking)

    rows = {row.payee: row for row in transactions(session)}
    assert [row.category_id for row in transactions(session) if "BOTTLE" in row.payee] == [
        uuid.UUID(categories["Groceries"])
    ] * 2
    power = rows["CITY POWER & LIGHT"]
    assert (power.subscription_id, power.category_id) == (
        uuid.UUID(subscription["id"]),
        uuid.UUID(categories["Utilities"]),
    )
    assert (
        admin_client.get(f"/api/subscriptions/{subscription['id']}").json()["next_due_date"]
        == "2026-10-05"
    )
    assert rows["NORTHWIND HEALTH PAYROLL PPD"].subscription_id is None


def test_imported_transactions_are_linked_to_a_bill_by_its_own_payee(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    bill = admin_client.post(
        "/api/bills",
        json={
            "name": "Power",
            "payee": "City Power & Light",
            "amount": "90.00",
            "amount_varies": True,
            "frequency": "monthly",
            "account_id": str(checking.id),
            "next_due_date": "2026-09-05",
            "category_id": categories["Utilities"],
        },
    ).json()

    imported(admin_client, CHECKING_CSV, checking)

    rows = {row.payee: row for row in transactions(session)}
    power = rows["CITY POWER & LIGHT"]
    assert (power.subscription_id, power.category_id) == (
        uuid.UUID(bill["id"]),
        uuid.UUID(categories["Utilities"]),
    )
    assert rows["NORTHWIND HEALTH PAYROLL PPD"].subscription_id is None
    updated = admin_client.get(f"/api/bills/{bill['id']}").json()
    # The bill it was linked to is paid, so it is next due a month on.
    assert (updated["payment_count"], updated["last_payment_on"], updated["next_due_date"]) == (
        1,
        "2026-09-05",
        "2026-10-05",
    )


def test_an_automation_links_a_statement_files_payments_to_a_bill(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    bill = admin_client.post(
        "/api/bills",
        json={
            "name": "Electricity",
            "payee": "Not what the bank calls it",
            "amount": "90.00",
            "frequency": "monthly",
            "account_id": str(checking.id),
            "next_due_date": "2026-09-05",
        },
    ).json()
    created = admin_client.post(
        "/api/automations",
        json={
            "name": "Electricity",
            "payees": ["city power"],
            "match": "contains",
            "subscription_id": bill["id"],
            "category_id": categories["Utilities"],
            "apply_to": "future",
        },
    )
    assert created.status_code == 201, created.text

    imported(admin_client, CHECKING_CSV, checking)

    power = next(row for row in transactions(session) if "CITY POWER" in row.payee)
    assert (power.subscription_id, power.category_id) == (
        uuid.UUID(bill["id"]),
        uuid.UUID(categories["Utilities"]),
    )
    assert admin_client.get(f"/api/bills/{bill['id']}").json()["payment_count"] == 1


def test_a_statement_files_noisy_descriptions_are_sorted_by_text_in_them(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    created = admin_client.post(
        "/api/automations",
        json={
            "name": "Whole Foods",
            "payees": ["wholefds mkt"],
            "match": "starts_with",
            "category_id": categories["Groceries"],
            "apply_to": "future",
        },
    )
    assert created.status_code == 201, created.text
    # Stores and towns differ from line to line, so what they share is all there is to go on.
    file = CHECKING_CSV + "09/09/2026,WHOLEFDS MKT #99999 DALLAS TX,-12.30,2673.18,T1006\n"

    imported(admin_client, file, checking)

    sorted_rows = [row for row in transactions(session) if "WHOLEFDS" in row.payee]
    assert len(sorted_rows) == 2
    assert {row.category_id for row in sorted_rows} == {uuid.UUID(categories["Groceries"])}
    assert [row.category_id for row in transactions(session) if "WHOLEFDS" not in row.payee] == [
        None
    ] * 4


def test_a_files_history_in_a_linked_account_is_sorted_like_the_banks_own(
    admin_client: TestClient, session: Session, categories: dict[str, str]
) -> None:
    linked = linked_account(session, "Rewards Visa", mask="3333", type=AccountType.CREDIT_CARD)
    # The bank, through Plaid, already shared this one, which the household sorted by hand.
    add_transaction(session, linked, "-15.49", "Netflix", original_description="NETFLIX.COM")
    created = admin_client.post(
        "/api/automations",
        json={
            "name": "Streaming",
            "payees": ["netflix"],
            "match": "contains",
            "account_id": str(linked.id),
            "category_id": categories["Utilities"],
            "apply_to": "all",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["applied"] == 1

    imported(admin_client, CARD_OFX, linked)

    # The statement's NETFLIX.COM is the same one, in the same account.
    netflix = [row for row in transactions(session) if "NETFLIX" in row.payee.upper()]
    assert len(netflix) == 2
    assert {row.category_id for row in netflix} == {uuid.UUID(categories["Utilities"])}


# ---- Automations while importing -------------------------------------------------------------


def paycheck_automation(
    client: TestClient, categories: dict[str, str], **changes: Any
) -> dict[str, Any]:
    response = client.post(
        "/api/automations",
        json={
            "name": "Paycheck",
            "payees": ["northwind health payroll"],
            "match": "contains",
            "direction": "in",
            "category_id": categories["Paycheck"],
            "apply_to": "future",
            **changes,
        },
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def test_the_preview_says_what_automations_will_do_to_each_row(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    paycheck_automation(admin_client, categories)
    bill = admin_client.post(
        "/api/bills",
        json={
            "name": "Power",
            "payee": "City Power & Light",
            "amount": "96.40",
            "frequency": "monthly",
            "account_id": str(checking.id),
            "next_due_date": "2026-09-05",
            "category_id": categories["Utilities"],
        },
    ).json()

    preview = previewed(admin_client, CHECKING_CSV, account_id=str(checking.id))

    rows = {row["payee"]: row for row in preview["rows"]}
    assert rows["NORTHWIND HEALTH PAYROLL PPD"]["automation"] == {
        "category_id": categories["Paycheck"],
        "subscription_id": None,
    }
    # The category an automation gives is the one the row will be filed under.
    assert rows["NORTHWIND HEALTH PAYROLL PPD"]["category_id"] == categories["Paycheck"]
    assert rows["CITY POWER & LIGHT"]["automation"] == {
        "category_id": categories["Utilities"],
        "subscription_id": bill["id"],
    }
    assert rows["WHOLEFDS MKT #10234 AUSTIN TX"]["automation"] is None
    assert preview["summary"]["sorted"] == 2
    # Nothing was changed by looking: the bill is still due when it was.
    assert admin_client.get(f"/api/bills/{bill['id']}").json()["next_due_date"] == "2026-09-05"
    assert transactions(session) == []


def test_the_preview_leaves_out_what_will_not_be_imported(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    paycheck_automation(admin_client, categories)
    imported(admin_client, CHECKING_CSV, checking)

    again = previewed(admin_client, CHECKING_CSV, account_id=str(checking.id))

    assert set(statuses(again)) == {"duplicate"}
    assert [row["automation"] for row in again["rows"]] == [None] * 5
    assert again["summary"]["sorted"] == 0


def test_a_file_without_an_account_yet_is_previewed_without_that_accounts_automations(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    paycheck_automation(admin_client, categories, account_id=str(checking.id))
    add_account(session, "Savings")

    preview = previewed(admin_client, CHECKING_CSV)

    assert preview["account_id"] is None
    assert preview["summary"]["sorted"] == 0
    assert (
        previewed(admin_client, CHECKING_CSV, account_id=str(checking.id))["summary"]["sorted"] == 1
    )


def test_importing_says_how_many_it_sorted_with_automations(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    paycheck_automation(admin_client, categories)
    # Already the category it would be given, which isn't sorting it.
    admin_client.post(
        "/api/automations",
        json={
            "name": "Coffee",
            "payees": ["blue bottle coffee"],
            "category_id": categories["Groceries"],
            "apply_to": "future",
        },
    )

    record = imported(admin_client, CHECKING_CSV, checking)

    assert (record["added"], record["sorted"]) == (5, 3)
    assert admin_client.get("/api/imports").json()[0]["sorted"] == 0


def test_a_file_sorts_money_by_the_way_it_went(
    admin_client: TestClient, session: Session, checking: Account, categories: dict[str, str]
) -> None:
    csv = """Date,Description,Amount
09/01/2026,ACME PAYROLL,2500.00
09/02/2026,ACME STORE PURCHASE,-45.00
"""
    admin_client.post(
        "/api/automations",
        json={
            "name": "Paycheck",
            "payees": ["acme"],
            "match": "contains",
            "direction": "in",
            "category_id": categories["Paycheck"],
            "apply_to": "future",
        },
    )

    record = imported(admin_client, csv, checking)

    assert record["sorted"] == 1
    by_payee = {row.payee: row for row in transactions(session)}
    assert by_payee["ACME PAYROLL"].category_id == uuid.UUID(categories["Paycheck"])
    assert by_payee["ACME STORE PURCHASE"].category_id is None
