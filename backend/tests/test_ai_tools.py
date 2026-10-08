"""The rules every tool follows: its codes, the text the AI writes, and how the AI is told about
them."""

import uuid

import pytest
from sqlalchemy.orm import Session

from app.ai.tools.base import Change, Codes, Look, Row, ToolError, category_names, echo, explain
from app.ai.tools.registry import CHANGE_BY_NAME, LOOK_BY_NAME, describe_tools
from app.auth.deps import ApiError
from app.models import User
from tests.ai import household
from tests.assistant import context

# ---- Row codes -------------------------------------------------------------------------------


def test_a_row_has_the_same_code_whenever_it_is_shown_and_two_rows_never_do() -> None:
    codes = Codes()
    first, second = uuid.uuid4(), uuid.uuid4()
    transaction_code = codes.issue(Row.TRANSACTION, first)

    assert codes.issue(Row.TRANSACTION, first) == transaction_code
    assert codes.issue(Row.TRANSACTION, first) != codes.issue(Row.TRANSACTION, second)
    # The same row can be two kinds of thing without the codes clashing.
    assert codes.issue(Row.RECURRING, first)[0] == "S"
    assert codes.issue(Row.BUDGET, first)[0] == "B"


def test_a_code_is_a_letter_a_tag_and_a_number() -> None:
    code = Codes().issue(Row.TRANSACTION, uuid.uuid4())

    assert len(code) == 4
    assert code[0] == "T"
    assert code[1:3].isalpha()
    assert code.endswith("1")


def test_a_code_is_read_however_the_ai_writes_it() -> None:
    codes = Codes()
    row = uuid.uuid4()
    code = codes.issue(Row.TRANSACTION, row)

    for written in (code, code.upper(), f" {code} ", f"<{code}>", f'"{code}"', f"[{code}]"):
        assert codes.resolve(Row.TRANSACTION, written) == row


def test_a_code_from_another_request_or_kind_or_nowhere_is_no_code() -> None:
    row = uuid.uuid4()
    earlier, now = Codes(), Codes()
    old = earlier.issue(Row.TRANSACTION, row)
    now.issue(Row.TRANSACTION, uuid.uuid4())
    asked = Codes()
    code = asked.issue(Row.TRANSACTION, row)

    # One a model remembers from earlier in the conversation, which has another tag...
    if old[1:3] != now.issue(Row.TRANSACTION, uuid.uuid4())[1:3]:
        with pytest.raises(ToolError, match="not a code from a look-up in this reply"):
            now.resolve(Row.TRANSACTION, old)
    # ...one of the wrong kind, and one it made up.
    with pytest.raises(ToolError, match="not a code"):
        asked.resolve(Row.RECURRING, code)
    with pytest.raises(ToolError, match="not a code"):
        asked.resolve(Row.TRANSACTION, "Taa9")


def test_what_the_ai_wrote_is_quoted_back_to_it_shortened() -> None:
    assert echo("Hobbies") == "'Hobbies'"
    assert echo("  many   spaces ") == "'many spaces'"
    assert echo("x" * 100) == f"'{'x' * 40}…'"


def test_what_an_api_error_says_is_what_the_ai_is_told() -> None:
    assert explain(ApiError(409, "duplicate_rule", "A subscription already tracks this.")) == (
        "A subscription already tracks this."
    )


def test_an_error_with_no_message_is_told_as_it_is() -> None:
    from fastapi import HTTPException

    assert explain(HTTPException(404, detail="gone")) == "gone"
    assert explain(HTTPException(404, detail={"code": "x"})) == "{'code': 'x'}"


# ---- Text the AI writes ----------------------------------------------------------------------


def test_text_the_ai_writes_is_tidied_and_checked(session: Session, admin: User) -> None:
    household(session)
    ctx = context(session, admin)

    assert ctx.written("  Pet   supplies ", "The name", longest=20) == "Pet supplies"
    assert ctx.written("two\nlines", "The name", longest=20) == "two lines"
    with pytest.raises(ToolError, match="The name has to be 1 to 5 characters"):
        ctx.written("too long", "The name", longest=5)
    with pytest.raises(ToolError, match="has to be 3 to 9"):
        ctx.written("ab", "The text", longest=9, shortest=3)


@pytest.mark.parametrize(
    "text",
    [
        "<ACCOUNT_bcdfghjkmn>",
        "[account]",
        "Costco #12",
        "a | b",
        "bad\x07bell",
        "Tartan Bank",
        "Everyday checking",
        "ending in 4410",
        "alex@example.com",
        "99887766554433",
    ],
)
def test_text_that_holds_a_code_a_mark_for_something_hidden_or_account_details_is_refused(
    session: Session, admin: User, text: str
) -> None:
    household(session)
    ctx = context(session, admin)

    with pytest.raises(ToolError, match="can't have a code"):
        ctx.written(text, "The name", longest=60)


def test_text_to_look_for_has_to_survive_taking_out_what_an_ai_mustnt_know(
    session: Session, admin: User
) -> None:
    household(session)
    ctx = context(session, admin)

    assert ctx.searched("Netflix", "The text", longest=20) == "Netflix"
    # 4 digits or more in a payee are taken out, so they can't be looked for.
    with pytest.raises(ToolError, match="can't be used"):
        ctx.searched("Store 12345", "The text", longest=20)


# ---- Categories ------------------------------------------------------------------------------


def test_a_category_is_found_however_it_is_spelled(session: Session, admin: User) -> None:
    household(session)
    ctx = context(session, admin)

    assert ctx.category("  gifts &   DONATIONS ") == "Gifts & donations"
    assert ctx.optional_category("Coffee") == "Coffee"
    for none in (None, "", "none", "None", "no category", "Uncategorized", "uncategorised"):
        assert ctx.optional_category(none) is None
    with pytest.raises(ToolError, match="no category called 'Hobbies'"):
        ctx.category("Hobbies")


def test_a_category_added_in_the_same_proposal_can_be_used_by_the_next_change(
    session: Session, admin: User
) -> None:
    household(session)
    ctx = context(session, admin)
    ctx.new_categories["pets"] = "Pets"

    assert ctx.category("pets") == "Pets"
    assert "pets" not in category_names(session)


# ---- How the AI is told ----------------------------------------------------------------------


def test_every_tool_has_its_own_name_and_is_described_to_the_ai() -> None:
    assert not set(LOOK_BY_NAME) & set(CHANGE_BY_NAME)
    told = describe_tools()

    tools: list[Look | Change] = [*LOOK_BY_NAME.values(), *CHANGE_BY_NAME.values()]
    for tool in tools:
        assert tool.signature.split(" ")[0] == tool.name
        assert f"- {tool.signature}: {tool.about}" in told
    assert told.index("Look-ups") < told.index("Changes are proposals")
    assert "nothing happens until they approve" in told


def test_a_tools_arguments_are_read_leniently() -> None:
    args = CHANGE_BY_NAME["create_budget"].args

    parsed = args.model_validate(
        {"name": "Fun", "period": "monthly", "amount": "$1,200.50", "colour": "red"}
    )

    assert str(parsed.model_dump()["amount"]) == "1200.50"
