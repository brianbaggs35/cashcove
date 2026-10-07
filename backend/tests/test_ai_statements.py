"""Reading a PDF statement for its transactions, and keeping what identifies anyone out of it."""

# These test the steps of reading a statement one at a time, which are private to it.
# pyright: reportPrivateUsage=false

import datetime as dt
import io
import json
from decimal import Decimal
from typing import Any

import pytest
from pypdf import PdfReader, PdfWriter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import statements
from app.ai.errors import BLOCKED, EMPTY, UNREACHABLE, UNREADABLE, AIError
from app.ai.privacy import Protected
from app.ai.providers import Connection
from app.ai.service import AIConfig, Gateway
from app.ai.statements import (
    Amount,
    Layout,
    Line,
    StatementProblem,
    _answers,
    _decimal,
    _how_much,
    _money,
    _period,
    _row,
    _signed,
    _when,
    lay_out,
    match_account,
    pdf_text,
    read,
)
from app.config import Settings
from app.models import Account, AccountType, AIProvider, AIPurpose, AIUsage, User
from e2e.ai import KEYS, FakeAI
from tests.ai import SECRETS, household
from tests.finance import add_account
from tests.helpers import add_user
from tests.pdfs import CARD, CHECKING, make_pdf

TODAY = dt.date(2026, 10, 6)
PEOPLE = Protected.of(
    ["Everyday checking", "Harbor Credit Union", "Harbor", "Tartan Bank", "Tartan", "Rewards Visa"],
    people=["Alex Rivera"],
)


def laid_out(lines: list[str], accounts: list[Account] | None = None) -> Layout:
    return lay_out(pdf_text(make_pdf(lines)), PEOPLE, accounts or [], TODAY)


def shown(lines: list[str]) -> list[str]:
    return [line.shown() for line in laid_out(lines).lines]


def line(
    *amounts: Amount, number: int = 1, text: str = "Whole Foods", section: str | None = None
) -> Line:
    return Line(number, "09/03", text, amounts, section, None)


# ---- The PDF ---------------------------------------------------------------------------------


def test_the_text_of_a_pdf_keeps_its_columns() -> None:
    text = pdf_text(make_pdf(CHECKING))

    assert "Date    Description" in text
    assert "09/02   WHOLEFDS MKT #10234 AUSTIN TX" in text
    # A statement of several pages is read in order.
    assert pdf_text(make_pdf(["first page 1.00"], ["second page 2.00"])).splitlines() == [
        "first page 1.00",
        "second page 2.00",
    ]


def encrypted(*, user: str) -> bytes:
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(make_pdf(CHECKING))))
    writer.encrypt(user_password=user, owner_password="owner", algorithm="AES-128")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_a_pdf_that_only_has_an_owners_password_is_read_as_banks_send_them() -> None:
    assert "WHOLEFDS" in pdf_text(encrypted(user=""))


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"GIF89a", statements.NOT_A_PDF),
        (encrypted(user="secret"), statements.LOCKED),
        (b"%PDF-1.4\nnot a pdf at all", statements.UNREADABLE),
        (make_pdf([]), statements.SCANNED),
        (make_pdf(["  "]), statements.SCANNED),
    ],
)
def test_a_pdf_that_cant_be_read_says_why(data: bytes, message: str) -> None:
    with pytest.raises(StatementProblem) as caught:
        pdf_text(data)

    assert caught.value.message == message


@pytest.mark.parametrize("limit", ["MAX_PAGES", "MAX_CHARS", "MAX_STATEMENT_BYTES"])
def test_a_pdf_has_limits(monkeypatch: pytest.MonkeyPatch, limit: str) -> None:
    monkeypatch.setattr(statements, limit, 2 if limit == "MAX_PAGES" else 10)
    data = make_pdf(["one"], ["two"], ["three"])

    with pytest.raises(StatementProblem) as caught:
        pdf_text(data)

    assert caught.value.message == statements.TOO_BIG


# ---- Finding the transactions ----------------------------------------------------------------


def test_a_checking_statement_gives_the_lines_that_are_transactions_and_hides_the_rest() -> None:
    assert shown(CHECKING) == [
        "1 | 09/02 | WHOLEFDS MKT [account] AUSTIN TX | 84.12 (out) [balance]",
        "2 | 09/05 | ACME CORP PAYROLL PPD | 2,400.00 (in) [balance]",
        "3 | 09/07 | ZELLE PAYMENT TO [person] [hidden] | 50.00 (out) [balance]",
        "4 | 09/12 | NETFLIX.COM | 15.49 (out) [balance]",
        "5 | 09/15 | ATM WITHDRAWAL | 60.00 (out) [balance]",
    ]


def test_what_the_statement_says_of_itself_is_worked_out_here() -> None:
    layout = laid_out(CHECKING)

    assert layout.period == (dt.date(2026, 9, 1), dt.date(2026, 9, 30))
    assert layout.year == 2026


def test_a_card_statement_keeps_its_sections_and_marks_nothing_certain_from_a_minus_sign() -> None:
    layout = laid_out(CARD)

    assert shown(CARD) == [
        "1 | 09/10 | AUTOPAY PAYMENT - THANK YOU | -500.00",
        "2 | 09/20 | DELTA AIR LINES | 486.20",
        "3 | 09/21 | UBER TRIP | 23.10",
    ]
    assert [(item.section, item.columns) for item in layout.lines] == [
        ("Payments and Other Credits", "Date Description Amount"),
        ("Purchases", "Trans Date Post Date Description Amount"),
        ("Purchases", "Trans Date Post Date Description Amount"),
    ]
    assert layout.period is None
    assert layout.year == 2026


def test_the_ai_gets_the_headings_above_its_lines_and_nothing_that_names_anyone() -> None:
    layout = laid_out(CARD)
    layout = Layout(layout.lines, layout.period, layout.year, Account(type=AccountType.CREDIT_CARD))

    data = statements._data(layout, layout.lines)

    assert data == "\n".join(
        [
            "Statement year: 2026",
            "Account kind: credit card",
            "",
            "Lines:",
            "# Date Description Amount",
            "# Payments and Other Credits",
            "1 | 09/10 | AUTOPAY PAYMENT - THANK YOU | -500.00",
            "# Trans Date Post Date Description Amount",
            "# Purchases",
            "2 | 09/20 | DELTA AIR LINES | 486.20",
            "3 | 09/21 | UBER TRIP | 23.10",
        ]
    )
    # The statement's own heading, its owner and its account never get in.
    for secret in ("ALEX", "RIVERA", "Tartan", "3333", "Closing Date"):
        assert secret not in data


def test_the_data_says_the_statements_dates_and_leaves_out_what_it_doesnt_have() -> None:
    layout = Layout([], (dt.date(2026, 9, 1), dt.date(2026, 9, 30)), None, None)

    assert statements._data(layout, []) == ("Statement dates: 2026-09-01 to 2026-09-30\n\nLines:")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("09/03/2026  WHOLE FOODS  84.12", "1 | 09/03/2026 | WHOLE FOODS | 84.12"),
        ("2026-09-03  WHOLE FOODS  $1,084.12", "1 | 2026-09-03 | WHOLE FOODS | $1,084.12"),
        ("Sep 3  WHOLE FOODS  84.12", "1 | Sep 3 | WHOLE FOODS | 84.12"),
        ("3 Sep 2026  WHOLE FOODS  84.12", "1 | 3 Sep 2026 | WHOLE FOODS | 84.12"),
        # Two dates: the transaction's and when it posted.
        ("09/03  09/04  WHOLE FOODS  84.12", "1 | 09/03 | WHOLE FOODS | 84.12"),
        ("09/03  WHOLE FOODS  (84.12)", "1 | 09/03 | WHOLE FOODS | (84.12)"),
        ("09/03  WHOLE FOODS  84.12-", "1 | 09/03 | WHOLE FOODS | 84.12-"),
        ("09/03  PAYROLL  2,400.00 CR", "1 | 09/03 | PAYROLL | 2,400.00 CR (in)"),
        ("09/03  WHOLE FOODS  84.12 DR", "1 | 09/03 | WHOLE FOODS | 84.12 DR (out)"),
        ("09/03  PAYROLL  2,400.00 cr", "1 | 09/03 | PAYROLL | 2,400.00 cr (in)"),
        ("09/03    84.12", "1 | 09/03 | (no description) | 84.12"),
        # Something that names a person or an account is hidden, and bars can't break the format.
        (
            "09/03  CHECK TO ALEX RIVERA | HARBOR CREDIT UNION  50.00",
            "1 | 09/03 | CHECK TO [person] / [account] | 50.00",
        ),
    ],
)
def test_dates_and_amounts_are_found_however_they_are_written(raw: str, expected: str) -> None:
    assert shown([raw]) == [expected]


@pytest.mark.parametrize(
    "raw",
    [
        "WHOLE FOODS  84.12",
        "09/03  WHOLE FOODS",
        "Statement for 09/03",
        "84.12  09/03",
        "Beginning balance  09/01  1,000.00",
        "09/30  Ending balance  1,200.00",
        "09/30  Total fees charged in 2026  0.00",
        "Sep 1  Opening Balance  1,000.00",
    ],
)
def test_a_line_without_a_date_and_an_amount_or_with_only_totals_is_not_a_transaction(
    raw: str,
) -> None:
    assert shown([raw]) == []


def test_a_line_with_only_a_balance_is_not_a_transaction() -> None:
    lines = ["Date  Description  Balance", "09/03  CARRIED FORWARD  1,000.00"]

    assert shown(lines) == []


def test_a_merchant_with_a_word_like_total_is_still_a_transaction() -> None:
    assert shown(["09/03  Total Wine & More  23.00"]) == ["1 | 09/03 | Total Wine & More | 23.00"]


def test_words_like_atm_withdrawal_are_a_transaction_not_a_heading() -> None:
    assert shown(["09/03  ATM WITHDRAWAL  40.00"]) == ["1 | 09/03 | ATM WITHDRAWAL | 40.00"]


def test_one_heading_word_isnt_a_header_and_a_header_needs_no_digits() -> None:
    lines = [
        "Payments and credits",
        "09/03  AUTOPAY  500.00",
        "Date Description Amount 2026",
        "09/04  OTHER  10.00",
    ]

    layout = laid_out(lines)

    assert [(item.section, item.columns) for item in layout.lines] == [
        ("Payments and credits", None),
        ("Payments and credits", None),
    ]


def test_a_column_further_than_a_heading_isnt_in_that_column() -> None:
    lines = [
        "Date  Description  Withdrawals  Deposits",
        "09/03  FAR AWAY                                                      20.00",
    ]

    assert shown(lines) == ["1 | 09/03 | FAR AWAY | 20.00"]


def test_a_header_without_columns_that_say_a_direction_tags_nothing() -> None:
    lines = ["Date  Description  Amount", "09/03  WHOLE FOODS  84.12"]

    assert shown(lines) == ["1 | 09/03 | WHOLE FOODS | 84.12"]


def test_money_says_which_way_it_went_only_when_the_statement_does() -> None:
    assert _money("84.12") == (Decimal("84.12"), "")
    assert _money("-84.12") == (Decimal("84.12"), "")
    assert _money("($1,084.12)") == (Decimal("1084.12"), "")
    assert _money("84.12 CR") == (Decimal("84.12"), "in")
    assert _money("84.12DR") == (Decimal("84.12"), "out")


def test_a_statement_with_too_many_transactions_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(statements, "MAX_LINES", 2)

    with pytest.raises(StatementProblem) as caught:
        laid_out(CHECKING)

    assert caught.value.message == statements.TOO_MANY


def test_a_year_that_hasnt_come_isnt_the_statements() -> None:
    assert laid_out(["09/03/2031  FUTURE  1.00"]).year is None
    assert laid_out(["09/03/2026  NOW  1.00", "also 2026 and 2025"]).year == 2026


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Statement 09/01/2026 - 09/30/2026", (dt.date(2026, 9, 1), dt.date(2026, 9, 30))),
        ("from 09/01/26 to 09/30/26", (dt.date(2026, 9, 1), dt.date(2026, 9, 30))),
        ("2026-09-01 through 2026-09-30", (dt.date(2026, 9, 1), dt.date(2026, 9, 30))),
        ("no dates here", None),
        ("13/45/2026 - 09/30/2026", None),
        ("09/30/2026 - 09/01/2026", None),
        ("01/01/2025 - 01/01/2027", None),
    ],
)
def test_the_statements_dates(text: str, expected: tuple[dt.date, dt.date] | None) -> None:
    assert _period(text) == expected


# ---- Which account ---------------------------------------------------------------------------


def test_the_account_is_the_one_with_the_last_digits_the_statement_shows(session: Session) -> None:
    home = household(session)

    assert match_account(pdf_text(make_pdf(CHECKING)), [home.checking, home.card]) is home.checking
    assert match_account(pdf_text(make_pdf(CARD)), [home.checking, home.card]) is home.card


def test_the_digits_have_to_stand_alone_to_count(session: Session) -> None:
    home = household(session)

    assert match_account("Total 4410.00 and 1,4410 and 44100", [home.checking]) is None
    assert match_account("ending in 4410", [home.checking]) is home.checking


def test_the_banks_name_settles_it_when_several_accounts_share_the_digits(
    session: Session,
) -> None:
    first = add_account(session, "One", institution="Harbor Credit Union", mask="1111")
    second = add_account(session, "Two", institution="Tartan Bank", mask="1111")

    assert match_account("Tartan Bank account 1111", [first, second]) is second
    assert match_account("account 1111", [first, second]) is None


def test_the_banks_name_alone_picks_an_account_only_if_one_is_at_that_bank(
    session: Session,
) -> None:
    only = add_account(session, "One", institution="Tartan Bank", mask=None)
    other = add_account(session, "Two", institution="Harbor Credit Union", mask=None)
    third = add_account(session, "Three", institution="Harbor Credit Union", mask=None)

    assert match_account("Tartan Bank statement", [only, other, third]) is only
    assert match_account("Harbor Credit Union statement", [only, other, third]) is None
    assert match_account("Another bank", [only, other, third]) is None


def test_a_short_bank_name_or_mask_is_ignored(session: Session) -> None:
    short = add_account(session, "Short", institution="TD", mask="12")

    assert match_account("TD 12 withdrawals", [short]) is None


# ---- Checking what the AI answered -----------------------------------------------------------


def money(text: str, tag: str = "") -> Amount:
    return Amount(text, Decimal(text.replace(",", "")), tag)  # type: ignore[arg-type]


def test_a_decimal_is_a_finite_number_or_nothing() -> None:
    assert _decimal("-84.12") == Decimal("-84.12")
    assert _decimal(" $1,084.12 ") == Decimal("1084.12")
    assert _decimal("lots") is None
    assert _decimal("NaN") is None
    assert _decimal("Infinity") is None
    assert _decimal("") is None


def test_a_date_is_checked_against_the_statements_dates() -> None:
    layout = Layout([], (dt.date(2026, 9, 1), dt.date(2026, 9, 30)), 2026, None)

    assert _when("2026-09-03", layout) == (dt.date(2026, 9, 3), [])
    assert _when(" 2026-10-20 ", layout) == (dt.date(2026, 10, 20), [])
    assert _when("2026-12-01", layout) == (
        dt.date(2026, 12, 1),
        ["The date is outside the statement's dates."],
    )
    assert _when("09/03", layout) == (None, ["The AI didn't give a date for this one."])
    assert _when("2026-09-03", Layout([], None, None, None)) == (dt.date(2026, 9, 3), [])


def test_the_amount_is_one_of_the_lines_and_never_the_balance() -> None:
    both = line(money("84.12"), money("2,790.88", "balance"))

    assert _how_much(both, Decimal("-84.12")) == (Decimal("84.12"), [])
    # A number the line doesn't have is replaced by the one it does, with a word about it.
    assert _how_much(both, Decimal("-2790.88")) == (
        Decimal("84.12"),
        ["The AI's amount wasn't on the line, so the line's was used."],
    )
    assert _how_much(both, Decimal("-9.99"))[0] == Decimal("84.12")
    # Nothing given at all is no reason to say the AI was wrong.
    assert _how_much(both, None) == (Decimal("84.12"), [])
    two = line(money("84.12"), money("5.00"))
    assert _how_much(two, Decimal("5.00")) == (Decimal("5.00"), [])
    assert _how_much(two, Decimal("-9.99")) == (
        None,
        ["It's not clear which number on the line is the amount."],
    )


def test_the_sign_is_the_statements_where_it_says_and_the_ais_otherwise() -> None:
    out = line(money("84.12", "out"))
    came_in = line(money("84.12", "in"))
    unsaid = line(money("84.12"))

    # The statement's columns win over what the AI said.
    assert _signed(out, Decimal("84.12"), Decimal("84.12")) == (Decimal("-84.12"), [])
    assert _signed(came_in, Decimal("84.12"), Decimal("-84.12")) == (Decimal("84.12"), [])
    assert _signed(unsaid, Decimal("84.12"), Decimal("-84.12")) == (Decimal("-84.12"), [])
    assert _signed(unsaid, Decimal("84.12"), Decimal("84.12")) == (Decimal("84.12"), [])
    assert _signed(unsaid, Decimal("84.12"), None) == (
        Decimal("-84.12"),
        ["Check which way the money went."],
    )


def test_a_row_is_the_line_checked_against_what_the_ai_said() -> None:
    layout = Layout([], (dt.date(2026, 9, 1), dt.date(2026, 9, 30)), 2026, None)
    answer = statements._Answer(
        line=1, date="2026-09-03", payee="  Whole   Foods ", amount="-84.12"
    )

    row = _row(line(money("84.12")), answer, layout)

    assert (row.line, row.date, row.payee, row.amount, row.note) == (
        1,
        dt.date(2026, 9, 3),
        "Whole Foods",
        Decimal("-84.12"),
        None,
    )


def test_a_row_that_needs_checking_says_so_in_one_note() -> None:
    layout = Layout([], (dt.date(2026, 9, 1), dt.date(2026, 9, 30)), 2026, None)
    answer = statements._Answer(line=2, date="soon", payee="", amount="")

    row = _row(line(money("1.00"), money("2.00"), number=2, text="SOME SHOP"), answer, layout)

    assert (row.date, row.payee, row.amount) == (None, "SOME SHOP", None)
    assert row.note == (
        "The AI didn't give a date for this one. "
        "It's not clear which number on the line is the amount."
    )


def test_a_row_with_no_payee_and_no_description_is_unknown() -> None:
    layout = Layout([], None, None, None)

    row = _row(line(money("5.00"), text=""), statements._Answer(line=1), layout)

    assert row.payee == "Unknown payee"


def test_the_answers_are_the_rows_that_have_a_line_number() -> None:
    reply = (
        'Here you go: {"transactions": '
        '[{"line": 1, "payee": "A"}, {"payee": "no line"}, 7, {"line": "x"}]}'
    )

    assert [answer.line for answer in _answers(reply)] == [1]
    assert [answer.line for answer in _answers('[{"line": 3}]')] == [3]
    assert _answers('{"transactions": "none"}') == []
    assert _answers('{"other": 1}') == []


def test_an_answer_that_isnt_json_is_unreadable() -> None:
    with pytest.raises(AIError) as caught:
        _answers("I could not read it.")

    assert caught.value.code == UNREADABLE


# ---- Reading a whole statement ---------------------------------------------------------------


def configured(fake: FakeAI) -> AIConfig:
    return AIConfig(Connection(AIProvider.OPENAI, api_key=KEYS["openai"]), "gpt-6-luna")


def run(session: Session, settings: Settings, fake: FakeAI, data: bytes) -> statements.Reading:
    user = session.scalars(select(User)).first() or add_user(
        session, settings, email="alex@example.com", name="Alex Rivera"
    )
    return read(session, settings, configured(fake), fake.transport, user, data)


def test_a_checking_statement_is_read_into_its_transactions(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    home = household(session)

    reading = run(session, settings, fake_ai, make_pdf(CHECKING))

    assert [(row.line, row.date, row.payee, row.amount, row.note) for row in reading.rows] == [
        (1, dt.date(2026, 9, 2), "Wholefds Mkt Austin Tx", Decimal("-84.12"), None),
        (2, dt.date(2026, 9, 5), "Acme Corp Payroll Ppd", Decimal("2400.00"), None),
        (3, dt.date(2026, 9, 7), "Zelle Payment To", Decimal("-50.00"), None),
        (4, dt.date(2026, 9, 12), "Netflix.Com", Decimal("-15.49"), None),
        (5, dt.date(2026, 9, 15), "Atm Withdrawal", Decimal("-60.00"), None),
    ]
    assert reading.account is not None
    assert reading.account.id == home.checking.id
    assert reading.skipped == 0


def test_a_card_statement_is_read_with_its_sign_from_what_it_says(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    household(session)

    reading = run(session, settings, fake_ai, make_pdf(CARD))

    assert [(row.payee, row.amount) for row in reading.rows] == [
        ("Autopay Payment - Thank You", Decimal("500.00")),
        ("Delta Air Lines", Decimal("-486.20")),
        ("Uber Trip", Decimal("-23.10")),
    ]
    assert reading.account is not None
    assert reading.account.name == "Rewards Visa"


def test_nothing_that_identifies_anyone_is_ever_sent_to_the_ai(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    household(session)

    run(session, settings, fake_ai, make_pdf(CHECKING))
    run(session, settings, fake_ai, make_pdf(CARD))

    sent = "\n".join(request.body for request in fake_ai.requests)
    assert fake_ai.requests
    assert "WHOLEFDS" in sent
    for secret in (
        *SECRETS,
        "ALEX",
        "RIVERA",
        "Alex Rivera",
        "123 Main Street",
        "Springfield",
        "62701",
        "000123-4410",
        "Account Number",
        "Harbor Credit Union",
        "1-800-555-0100",
        "4155551234",
        "JOHN SMITH",
        "Rewards Visa",
        # The balances, which are never sent either.
        "2,875.00",
        "2,790.88",
        "5,190.88",
        "5,065.39",
    ):
        assert secret not in sent, secret


def test_what_it_costs_is_counted_as_reading_a_statement(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    household(session)

    run(session, settings, fake_ai, make_pdf(CHECKING))

    usage = session.scalars(select(AIUsage)).all()
    assert [(item.purpose, item.model) for item in usage] == [(AIPurpose.STATEMENT, "gpt-6-luna")]
    assert usage[0].input_tokens > 0


def test_a_long_statement_goes_to_the_ai_a_batch_at_a_time(
    session: Session, settings: Settings, fake_ai: FakeAI, monkeypatch: pytest.MonkeyPatch
) -> None:
    household(session)
    monkeypatch.setattr(statements, "BATCH", 2)

    reading = run(session, settings, fake_ai, make_pdf(CHECKING))

    assert [row.line for row in reading.rows] == [1, 2, 3, 4, 5]
    assert len(fake_ai.requests) == 3
    assert len(session.scalars(select(AIUsage)).all()) == 3


class Clock:
    """A clock that says what a test says it is, one reading at a time."""

    def __init__(self, *readings: float) -> None:
        self._readings = iter(readings)

    def __call__(self) -> float:
        return next(self._readings)


def test_each_batch_is_given_the_time_that_is_left_to_read_the_statement(
    session: Session, settings: Settings, fake_ai: FakeAI, monkeypatch: pytest.MonkeyPatch
) -> None:
    household(session)
    monkeypatch.setattr(statements, "BATCH", 3)
    # The reading starts at 1, and a batch is asked for at 2 and at 120.
    monkeypatch.setattr(statements, "monotonic", Clock(1.0, 2.0, 120.0))
    waits: list[float | None] = []
    ask = Gateway.ask

    def asking(self: Gateway, *args: Any, timeout: float | None = None, **kwargs: Any) -> str:
        waits.append(timeout)
        return ask(self, *args, timeout=timeout, **kwargs)

    monkeypatch.setattr(Gateway, "ask", asking)

    reading = run(session, settings, fake_ai, make_pdf(CHECKING))

    assert [row.line for row in reading.rows] == [1, 2, 3, 4, 5]
    assert waits == [statements.READING_BUDGET - 1.0, statements.READING_BUDGET - 119.0]


def test_a_statement_the_ai_is_too_slow_to_read_says_so_before_the_server_gives_up(
    session: Session, settings: Settings, fake_ai: FakeAI, monkeypatch: pytest.MonkeyPatch
) -> None:
    household(session)
    monkeypatch.setattr(statements, "BATCH", 2)
    # Too little of the time is left for a second batch.
    left = statements.MIN_ASK - 0.5
    monkeypatch.setattr(statements, "monotonic", Clock(0.0, 0.0, statements.READING_BUDGET - left))
    data = make_pdf(CHECKING)

    with pytest.raises(AIError) as caught:
        run(session, settings, fake_ai, data)

    assert (caught.value.code, caught.value.message) == (UNREACHABLE, statements.TOO_SLOW)
    # Only the first batch was asked for, and nothing it said is kept.
    assert len(fake_ai.requests) == 1


def test_a_line_the_ai_doesnt_return_is_counted_as_skipped(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    fake_ai.say = json.dumps(
        {
            "transactions": [
                {"line": 2, "date": "2026-09-05", "payee": "Acme", "amount": "2400.00"},
                # Twice, or for a line there isn't, counts once or not at all.
                {"line": 2, "date": "2026-09-05", "payee": "Acme again", "amount": "1.00"},
                {"line": 99, "date": "2026-09-05", "payee": "Nothing", "amount": "1.00"},
            ]
        }
    )

    reading = run(session, settings, fake_ai, make_pdf(CHECKING))

    assert [(row.line, row.payee) for row in reading.rows] == [(2, "Acme")]
    assert reading.skipped == 4


def test_an_answer_with_no_transactions_is_an_error(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    fake_ai.say = '{"transactions": []}'
    data = make_pdf(CHECKING)

    with pytest.raises(AIError) as caught:
        run(session, settings, fake_ai, data)

    assert (caught.value.code, caught.value.message) == (EMPTY, statements.NOTHING_READ)


def test_an_answer_that_isnt_json_is_an_error(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    fake_ai.say = "Sorry, I can't."
    data = make_pdf(CHECKING)

    with pytest.raises(AIError) as caught:
        run(session, settings, fake_ai, data)

    assert caught.value.code == UNREADABLE


def test_a_pdf_with_no_transactions_says_so_without_asking_the_ai(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    data = make_pdf(["Just a letter from the bank.", "Thank you."])

    with pytest.raises(StatementProblem) as caught:
        run(session, settings, fake_ai, data)

    assert caught.value.message == statements.NOTHING_FOUND
    assert fake_ai.requests == []


def test_an_amount_too_like_an_account_number_stops_the_request(
    session: Session, settings: Settings, fake_ai: FakeAI
) -> None:
    data = make_pdf(["09/03  A SHOP  12345678.90"])

    with pytest.raises(AIError) as caught:
        run(session, settings, fake_ai, data)

    assert caught.value.code == BLOCKED
    assert fake_ai.requests == []
