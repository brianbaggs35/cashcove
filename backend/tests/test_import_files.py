import codecs
import datetime as dt
from decimal import Decimal

import pytest

from app.imports.files import EXCEL, FileProblem, decode, sniff
from app.imports.ofx import INVESTMENTS, NO_TRANSACTIONS, read_ofx
from app.imports.qif import read_qif
from app.models import AccountType, FileFormat
from app.schemas.imports import ImportOptions
from tests.imports import CARD_OFX, CHECKING_CSV, OFX, QIF


def problem(data: bytes) -> str:
    with pytest.raises(FileProblem) as raised:
        decode(data)
    return raised.value.message


def test_text_decodes_from_the_encodings_banks_save_in() -> None:
    assert decode(codecs.BOM_UTF8 + "Café,1.00".encode()) == "Café,1.00"
    assert decode("Café,1.00".encode("utf-16")) == "Café,1.00"
    assert decode("Café,1.00".encode()) == "Café,1.00"
    # Older exports use Windows' Western European encoding.
    assert decode("Café,1.00".encode("cp1252")) == "Café,1.00"


def test_workbooks_pdfs_and_other_files_get_a_way_forward() -> None:
    assert problem(b"PK\x03\x04rest of a workbook") == EXCEL
    assert problem(b"\xd0\xcf\x11\xe0old workbook") == EXCEL
    assert problem(b"%PDF-1.7").startswith("PDF statements can't be imported.")
    assert problem(b"GIF89a\x00\x01").startswith("This doesn't look like a statement file.")
    assert problem(b" \r\n ") == "The file is empty."


def test_the_format_comes_from_the_files_contents() -> None:
    assert sniff(OFX) == FileFormat.OFX
    assert sniff(CARD_OFX) == FileFormat.OFX
    assert sniff("\n<OFX><BANKMSGSRSV1>") == FileFormat.OFX
    assert sniff(QIF) == FileFormat.QIF
    assert sniff("!Type:CCard\n") == FileFormat.QIF
    assert sniff("!Option:AutoSwitch\n") == FileFormat.QIF
    assert sniff("!Clear:AutoSwitch\n") == FileFormat.QIF
    assert sniff(CHECKING_CSV) == FileFormat.CSV


# ---- OFX, QFX and QBO ----------------------------------------------------------------------


def test_ofx_statements_read_with_their_account() -> None:
    statements, options = read_ofx(OFX, None)

    assert options == ImportOptions()
    [statement] = statements
    assert statement.institution == "Harbor Credit Union"
    assert statement.type == AccountType.CHECKING
    assert statement.mask == "4410"
    assert statement.currency == "USD"
    assert statement.closing == Decimal("2310.55")
    assert statement.closing_date == dt.date(2026, 9, 26)
    groceries, check, pay = statement.rows
    assert (groceries.line, groceries.date, groceries.amount) == (
        1,
        dt.date(2026, 9, 25),
        Decimal("-42.50"),
    )
    assert (groceries.description, groceries.memo, groceries.external_id) == (
        "WHOLEFDS MKT & CO",
        "AUSTIN TX",
        "A1",
    )
    # A decimal comma, and the check's number in the notes.
    assert (check.amount, check.memo, check.external_id) == (Decimal("-100.00"), "Check 1043", "A2")
    # Newer files put the name in a payee group.
    assert (pay.description, pay.memo, pay.amount) == ("ACME CORP", None, Decimal("2400.00"))


def test_ofx_2_is_xml_and_cards_are_credit_cards() -> None:
    [statement], _ = read_ofx(CARD_OFX, None)

    assert statement.type == AccountType.CREDIT_CARD
    assert statement.mask == "3333"
    assert statement.currency == "USD"
    assert statement.institution is None
    assert statement.closing == Decimal("-612.40")
    [row] = statement.rows
    assert (row.description, row.memo, row.amount) == ("NETFLIX.COM", None, Decimal("-15.49"))


def test_amounts_can_be_flipped_for_files_that_have_them_the_other_way() -> None:
    [statement], _ = read_ofx(OFX, ImportOptions(flip=True))

    assert [row.amount for row in statement.rows] == [
        Decimal("42.50"),
        Decimal("100.00"),
        Decimal("-2400.00"),
    ]


def ofx_file(*transactions: str, account: str = "<ACCTID>12<ACCTTYPE>MONEYMRKT") -> str:
    return (
        f"<OFX><STMTRS><BANKACCTFROM>{account}</BANKACCTFROM><BANKTRANLIST>"
        + "".join(f"<STMTTRN>{transaction}</STMTTRN>" for transaction in transactions)
        + "</BANKTRANLIST></STMTRS></OFX>"
    )


def test_banks_that_name_every_transaction_alike_have_their_payees_in_the_memo() -> None:
    text = ofx_file(
        *(
            f"<DTPOSTED>2026092{day}<TRNAMT>-{day}.00<NAME>POS PURCHASE<MEMO>SHOP {day}"
            for day in range(1, 6)
        )
    )

    [statement], options = read_ofx(text, None)

    assert options.payee_field == "memo"
    assert [(row.description, row.memo) for row in statement.rows][:2] == [
        ("SHOP 1", "POS PURCHASE"),
        ("SHOP 2", "POS PURCHASE"),
    ]
    assert statement.type == AccountType.SAVINGS
    assert statement.mask == "12"
    assert statement.closing is None
    # People can choose the names instead.
    [statement], _ = read_ofx(text, ImportOptions())
    assert statement.rows[0].description == "POS PURCHASE"


def test_ofx_transactions_that_cant_be_read_say_why() -> None:
    text = ofx_file(
        "<TRNAMT>-1.00<NAME>NO DATE",
        "<DTPOSTED>yesterday<TRNAMT>-1.00<NAME>BAD DATE",
        "<DTUSER>20260920<NAME>NO AMOUNT",
        "<DTPOSTED>20260920<TRNAMT>lots<NAME>BAD AMOUNT",
        "<DTPOSTED>20260920<TRNAMT>0.00<NAME>ZERO",
        "<DTPOSTED>20260920<TRNAMT>-3.00<MEMO>ONLY A MEMO",
        account="<ACCTID>9",
    )

    [statement], _ = read_ofx(text, None)

    assert [row.problem for row in statement.rows] == [
        "It has no date.",
        "“yesterday” isn't a date.",
        "It has no amount.",
        "“lots” isn't an amount.",
        "Its amount is zero.",
        None,
    ]
    assert (statement.rows[-1].description, statement.rows[-1].memo) == ("ONLY A MEMO", None)
    assert statement.type is None
    assert statement.mask is None


def test_ofx_files_with_several_accounts_have_a_statement_for_each() -> None:
    card = "<CCSTMTRS><CCACCTFROM><ACCTID>9999</CCACCTFROM><BANKTRANLIST></BANKTRANLIST>"
    text = OFX.replace("</STMTRS>", f"</STMTRS>{card}<LEDGERBAL><BALAMT>1.00</CCSTMTRS>")

    statements, _ = read_ofx(text, None)

    assert [(statement.type, statement.mask) for statement in statements] == [
        (AccountType.CHECKING, "4410"),
        (AccountType.CREDIT_CARD, "9999"),
    ]
    # A balance without its date.
    assert (statements[1].closing, statements[1].closing_date) == (Decimal("1.00"), None)


def test_ofx_files_without_bank_transactions_cant_be_imported() -> None:
    with pytest.raises(FileProblem) as raised:
        read_ofx("<OFX><INVSTMTMSGSRSV1><INVSTMTRS></INVSTMTRS></INVSTMTMSGSRSV1></OFX>", None)
    assert raised.value.message == INVESTMENTS
    with pytest.raises(FileProblem) as raised:
        read_ofx("<OFX></SIGNONMSGSRSV1></OFX>", None)
    assert raised.value.message == NO_TRANSACTIONS


# ---- QIF -------------------------------------------------------------------------------------


def test_qif_files_read_with_their_account() -> None:
    [statement], options = read_qif(QIF, None, "en-US")

    assert options == ImportOptions(date_order="mdy", decimal_mark=".")
    assert statement.name == "Everyday Checking"
    assert statement.type == AccountType.CHECKING
    groceries, rent = statement.rows
    assert (groceries.line, groceries.date, groceries.amount) == (
        1,
        dt.date(2026, 9, 25),
        Decimal("-42.50"),
    )
    assert (groceries.description, groceries.memo, groceries.category) == (
        "WHOLEFDS MKT",
        "Austin",
        "Food:Groceries",
    )
    # Transfers name an account rather than a category.
    assert (rent.date, rent.amount, rent.memo, rent.category) == (
        dt.date(2026, 9, 20),
        Decimal("-1100.00"),
        "Check 1043",
        None,
    )


def test_qif_dates_and_decimal_marks_are_worked_out_from_the_file() -> None:
    text = "!Type:Oth L\nD01/02/2026\nT-1.234,50\nPLENDER\n^\nD03/04/2026\nT-10,00\nPLENDER\n^\n"

    [statement], options = read_qif(text, None, "en-GB")

    assert (options.date_order, options.decimal_mark) == ("dmy", ",")
    assert statement.type == AccountType.LOAN
    assert statement.name is None
    assert [row.date for row in statement.rows] == [dt.date(2026, 2, 1), dt.date(2026, 4, 3)]
    assert statement.rows[0].amount == Decimal("-1234.50")
    # Dates that only read one way are read that way, wherever the household is.
    _, options = read_qif("!Type:Cash\nD13/02/2026\nT5.00\n^\n", None, "en-US")
    assert options.date_order == "dmy"


def test_qif_files_with_several_accounts_have_a_statement_for_each() -> None:
    text = (
        "!Option:AutoSwitch\n!Account\nNChecking\nTBank\n^\nNVisa\nTCCard\n^\n!Clear:AutoSwitch\n"
        "!Account\nNChecking\nTBank\n^\n!Type:Bank\nD9/1/2026\nT100.00\nPPAY\n^\n"
        "!Account\nNVisa\nTCCard\n^\n!Type:CCard\nD9/2/2026\nT-5.00\nPCAFE\nSDining\n$-5.00\n"
        "SDining\n$-1.00\n^\n"
        "!Type:Memorized\nD9/2/2026\nT-5.00\nPCAFE\n^\n"
        "!Type:Oth A\n^\n"
    )

    statements, _ = read_qif(text, None, "en-US")

    assert [(statement.name, statement.type) for statement in statements] == [
        ("Checking", AccountType.CHECKING),
        ("Visa", AccountType.CREDIT_CARD),
    ]
    # Each transaction is counted through the file.
    assert [row.line for statement in statements for row in statement.rows] == [1, 2]


def test_qif_transactions_that_cant_be_read_say_why() -> None:
    text = (
        "!Type:Bank\n\nT-1.00\nPNO DATE\n^\nDsoon\nT-1.00\nPBAD DATE\n^\nD9/1/2026\nPNO AMOUNT\n^\n"
        "D9/1/2026\nTlots\nPBAD AMOUNT\n^\nD9/1/2026\nT0.00\nPZERO\n^\n"
        "D9/1/2026\nT-3.00\nMONLY A MEMO\nNATM\nLFood/Vacation\n^\n"
    )

    [statement], _ = read_qif(text, None, "en-US")

    assert [row.problem for row in statement.rows] == [
        "It has no date.",
        "“soon” isn't a date.",
        "It has no amount.",
        "“lots” isn't an amount.",
        "Its amount is zero.",
        None,
    ]
    last = statement.rows[-1]
    # Check numbers are only numbers, and categories lose their class.
    assert (last.description, last.memo, last.category) == ("ONLY A MEMO", None, "Food")


def test_qif_payees_can_come_from_the_memo_and_amounts_be_flipped() -> None:
    options = ImportOptions(payee_field="memo", flip=True)

    [statement], _ = read_qif(QIF, options, "en-US")

    assert [(row.description, row.memo, row.amount) for row in statement.rows] == [
        ("Austin", "WHOLEFDS MKT", Decimal("42.50")),
        ("Parkside Apartments", "Check 1043", Decimal("1100.00")),
    ]


def test_qif_files_without_bank_transactions_cant_be_imported() -> None:
    with pytest.raises(FileProblem) as raised:
        read_qif("!Type:Invst\nD9/1/2026\nNBuy\n^\n", None, "en-US")
    assert raised.value.message == INVESTMENTS
    with pytest.raises(FileProblem) as raised:
        read_qif("!Type:Bank\n^\n!Type:Cat\nNFood\n^\n", None, "en-US")
    assert raised.value.message == NO_TRANSACTIONS
