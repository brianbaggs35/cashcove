"""What the AI can look up, and that none of it can be used to find out what it mustn't know."""

import datetime as dt
import re
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.ai.tools.base import ToolError
from app.ai.tools.looks import CANDIDATES, SHOWN
from app.ai.tools.registry import LOOK_BY_NAME
from app.finance.budget import add_source, create_budget
from app.models import (
    BudgetKind,
    BudgetPeriod,
    PaymentFrequency,
    RecurringKind,
    Subscription,
    Transaction,
    TransactionSource,
    User,
)
from app.schemas.budget import BudgetCreate, BudgetSourceIn
from tests.ai import SECRETS, household
from tests.assistant import accounts_in, add_item, codes, context, look, payments
from tests.finance import TODAY, add_transaction

ACCOUNT = r"<ACCOUNT_[b-z]{10}>"


def rows(text: str) -> list[str]:
    """The lines of a result that are about one row each."""
    return [line for line in text.splitlines() if re.match(r"^[TSB][a-z]{2}\d+ \|", line)]


# ---- Finding transactions --------------------------------------------------------------------


def test_transactions_are_listed_newest_first_with_a_code_each(
    session: Session, admin: User
) -> None:
    made = household(session)
    made.sorted_badly()
    ctx = context(session, admin)

    found = look(ctx, "find_transactions")

    lines = rows(found)
    assert len(lines) == 5
    assert found.splitlines()[0].startswith("5 transactions match.")
    assert len(set(codes(found, "T"))) == 5
    # Every row says where it is from only as a code, and what it is linked to.
    for line in lines:
        assert re.search(rf"\| {ACCOUNT} \| (not linked|linked to .+)$", line)


def test_a_code_is_the_same_whenever_a_row_is_shown_again_in_a_request(
    session: Session, admin: User
) -> None:
    household(session).sorted_badly()
    ctx = context(session, admin)

    first = codes(look(ctx, "find_transactions"), "T")
    second = codes(look(ctx, "find_transactions"), "T")

    assert first == second


def test_a_row_is_shown_as_the_ai_may_see_it_and_nothing_else(
    session: Session, admin: User
) -> None:
    household(session).sorted_badly()
    ctx = context(session, admin)

    found = look(ctx, "find_transactions")

    assert "Starbucks #" in found
    for secret in SECRETS:
        assert secret.lower() not in found.lower(), secret
    # What the bank wrote beside the payee, and the notes, are never read.
    assert "STARBUCKS ACH" not in found
    assert "ask alex" not in found
    # The accounts that appear in a payee are the same codes as the rows' accounts.
    payment = next(line for line in rows(found) if "card ending in" in line)
    in_payee = re.findall(ACCOUNT, payment.split(" | ")[2])
    assert in_payee
    assert in_payee[0] == accounts_in(payment.split(" | ")[-2])[0]


def test_a_transaction_shows_its_category_and_the_subscription_it_is_linked_to(
    session: Session, admin: User
) -> None:
    made = household(session)
    [payment] = payments(session, made.checking, "Netflix", "15.49", 1, category_id=made.coffee.id)
    session.add(
        Subscription(
            name="Netflix",
            kind=RecurringKind.SUBSCRIPTION,
            payee="Netflix",
            amount=Decimal("15.49"),
            frequency=PaymentFrequency.MONTHLY,
            account_id=made.checking.id,
            next_due_date=TODAY,
        )
    )
    session.commit()
    payment.subscription_id = session.query(Subscription).one().id
    session.commit()

    [line] = rows(look(context(session, admin), "find_transactions", text="netflix"))

    assert " | Coffee | -15.49 USD | " in line
    assert line.endswith("linked to Netflix")


def test_a_row_with_no_category_says_so(session: Session, admin: User) -> None:
    made = household(session)
    add_transaction(session, made.checking, "-9.00", "Corner Market")

    [line] = rows(look(context(session, admin), "find_transactions"))

    assert " | (no category) | " in line


def test_a_search_looks_in_payees_whatever_the_case(session: Session, admin: User) -> None:
    household(session).sorted_badly()
    ctx = context(session, admin)

    assert len(rows(look(ctx, "find_transactions", text="NETFLIX"))) == 1
    assert len(rows(look(ctx, "find_transactions", text=" whole  "))) == 1
    assert look(ctx, "find_transactions", text="nothing like it") == "No transactions match."


def test_what_was_hidden_cant_be_found_by_looking_for_it(session: Session, admin: User) -> None:
    made = household(session)
    made.sorted_badly()
    add_transaction(
        session, made.checking, "-9.00", "Costco ref 99887766", original_description="ACCT 12345"
    )
    ctx = context(session, admin)

    # A text that taking out account information would change can't be used...
    for hidden in ("99887766", "tartan", "Everyday checking", "4410", "alex@example.com"):
        with pytest.raises(ToolError, match=r"can.t be used|can.t have"):
            look(ctx, "find_transactions", text=hidden)
    # ...and a piece of a hidden name that can be asked for finds nothing, as a made-up one does,
    # though the payee that has it is there: "Everyda" is in "Everyday checking".
    assert look(ctx, "find_transactions", text="Everyda") == "No transactions match."
    assert look(ctx, "find_transactions", text="Zzzzzzz") == "No transactions match."
    # What isn't shown can't be asked for either: the raw description and the notes.
    assert look(ctx, "find_transactions", text="ACCT") == "No transactions match."
    assert look(ctx, "find_transactions", text="Costco") != "No transactions match."


def test_a_text_the_ai_writes_cant_hold_a_code_or_a_mark_for_something_hidden(
    session: Session, admin: User
) -> None:
    household(session)
    ctx = context(session, admin)

    for text in ("<ACCOUNT_bcdfghjkmn>", "[account]", "a|b", "x" * 61, "   "):
        with pytest.raises(ToolError):
            look(ctx, "find_transactions", text=text)


def test_transactions_can_be_found_by_category_or_by_having_none(
    session: Session, admin: User
) -> None:
    household(session).sorted_badly()
    ctx = context(session, admin)

    assert len(rows(look(ctx, "find_transactions", category="Groceries"))) == 1
    assert len(rows(look(ctx, "find_transactions", category="groceries"))) == 1
    # Venmo and Starbucks have none.
    assert len(rows(look(ctx, "find_transactions", category="none"))) == 2
    assert len(rows(look(ctx, "find_transactions", category="Uncategorized"))) == 2
    with pytest.raises(ToolError, match="no category called 'Hobbies'"):
        look(ctx, "find_transactions", category="Hobbies")


def test_transactions_can_be_found_by_direction_dates_and_size(
    session: Session, admin: User
) -> None:
    made = household(session)
    made.sorted_badly()
    pay = add_transaction(session, made.checking, "2400.00", "Acme payroll", date=TODAY)
    ctx = context(session, admin)

    assert [
        line.split(" | ")[2] for line in rows(look(ctx, "find_transactions", direction="in"))
    ] == ["Acme payroll"]
    assert len(rows(look(ctx, "find_transactions", direction="out"))) == 5
    assert len(rows(look(ctx, "find_transactions", **{"from": str(TODAY), "to": str(TODAY)}))) == 1
    assert not rows(look(ctx, "find_transactions", **{"from": "2030-01-01"}))
    assert not rows(look(ctx, "find_transactions", to="2000-01-01"))
    # Money going out or coming in, either way.
    assert len(rows(look(ctx, "find_transactions", min="$100"))) == 2
    assert len(rows(look(ctx, "find_transactions", max="20"))) == 2
    assert len(rows(look(ctx, "find_transactions", min=40, max="85"))) == 2
    assert pay.id


def test_transactions_can_be_found_by_whether_a_subscription_has_them(
    session: Session, admin: User
) -> None:
    made = household(session)
    made.sorted_badly()
    ctx = context(session, admin)
    item = Subscription(
        name="Vee",
        kind=RecurringKind.SUBSCRIPTION,
        payee="Venmo",
        amount=Decimal("40.00"),
        frequency=PaymentFrequency.MONTHLY,
        account_id=made.checking.id,
        next_due_date=TODAY,
    )
    session.add(item)
    session.commit()
    made.sorted_badly()  # more rows
    session.query(type(made.sorted_badly()["venmo"])).filter_by(payee="Venmo").update(
        {"subscription_id": item.id}
    )
    session.commit()

    assert all(
        "linked to Vee" in line for line in rows(look(ctx, "find_transactions", linked=True))
    )
    assert all(
        line.endswith("not linked") for line in rows(look(ctx, "find_transactions", linked=False))
    )


def test_only_a_page_of_the_newest_is_shown_and_it_says_so(session: Session, admin: User) -> None:
    made = household(session)
    payments(session, made.checking, "Gym", "30.00", 30)
    ctx = context(session, admin)

    found = look(ctx, "find_transactions", text="gym")

    assert len(rows(found)) == SHOWN
    assert found.startswith(f"30 transactions match, the newest {SHOWN} are shown.")
    assert len(rows(look(ctx, "find_transactions", text="gym", limit=3))) == 3
    assert len(rows(look(ctx, "find_transactions", text="gym", limit=500))) == SHOWN
    assert len(rows(look(ctx, "find_transactions", text="gym", limit=0))) == 1


def test_only_the_newest_are_checked_and_it_says_so(session: Session, admin: User) -> None:
    made = household(session)
    session.add_all(
        Transaction(
            account_id=made.checking.id,
            date=TODAY - dt.timedelta(days=number),
            amount=Decimal("-1.00"),
            payee=f"Bulk {number}",
            source=TransactionSource.MANUAL,
        )
        for number in range(CANDIDATES + 5)
    )
    session.commit()

    found = look(context(session, admin), "find_transactions", text="Bulk")

    assert f"(only the newest {CANDIDATES} were checked" in found


def test_a_person_in_a_payee_is_a_code_that_can_be_told_apart(
    session: Session, admin: User
) -> None:
    made = household(session)
    add_transaction(session, made.checking, "-50.00", "ZELLE PAYMENT TO JOHN SMITH")
    add_transaction(session, made.checking, "-20.00", "ZELLE PAYMENT TO JOHN SMITH")

    found = look(context(session, admin), "find_transactions", text="zelle")

    assert len(set(re.findall(r"<PERSON_[b-z]{10}>", found))) == 1
    assert "JOHN" not in found


def test_an_arguments_that_make_no_sense_are_refused_for_the_ai_to_correct() -> None:
    args = LOOK_BY_NAME["find_transactions"].args
    for bad in (
        {"direction": "sideways"},
        {"from": "someday"},
        {"min": "lots"},
        {"linked": "maybe"},
    ):
        with pytest.raises(ValidationError):
            args.model_validate(bad)
    # Anything else it adds is ignored.
    assert args.model_validate({"text": "x", "colour": "red"}).model_dump()["text"] == "x"


# ---- Subscriptions and bills -----------------------------------------------------------------


def test_there_is_nothing_to_list_until_something_is_tracked(session: Session, admin: User) -> None:
    household(session)

    assert look(context(session, admin), "list_recurring") == "No subscriptions or bills match."


def test_subscriptions_and_bills_are_listed_with_what_they_cost_and_when(
    session: Session, admin: User
) -> None:
    made = household(session)
    add_item(
        session,
        made.checking.id,
        "Netflix",
        amount="15.49",
        category_id=made.subscriptions.id,
        payee="NETFLIX.COM",
    )
    add_item(
        session,
        made.card.id,
        "Power",
        kind=RecurringKind.BILL,
        amount="80.00",
        amount_varies=True,
        frequency=PaymentFrequency.QUARTERLY,
        active=False,
    )
    payments(session, made.checking, "Netflix", "15.49", 2)
    ctx = context(session, admin)

    listed = look(ctx, "list_recurring")

    lines = rows(listed)
    assert len(lines) == 2
    assert len(set(codes(listed, "S"))) == 2
    netflix = next(line for line in lines if "| Netflix |" in line)
    assert " | subscription | Netflix | 15.49 USD monthly | next 2026-09-20 | " in netflix
    assert " | Subscriptions | active | " in netflix
    assert re.search(rf"payee NETFLIX\.COM \| {ACCOUNT}$", netflix)
    power = next(line for line in lines if "| Power |" in line)
    assert " | bill | Power | about 80.00 USD quarterly | " in power
    assert " | (no category) | paused | 0 payments | " in power
    # The two accounts are told apart.
    assert len(accounts_in(listed)) == 2
    for secret in SECRETS:
        assert secret.lower() not in listed.lower()


def test_subscriptions_and_bills_can_be_listed_apart_or_found_by_name(
    session: Session, admin: User
) -> None:
    made = household(session)
    add_item(session, made.checking.id, "Netflix")
    add_item(session, made.checking.id, "Power company", kind=RecurringKind.BILL)
    ctx = context(session, admin)

    assert len(rows(look(ctx, "list_recurring", kind="bill"))) == 1
    assert len(rows(look(ctx, "list_recurring", kind="subscription"))) == 1
    assert len(rows(look(ctx, "list_recurring", text="power"))) == 1
    assert look(ctx, "list_recurring", text="nothing") == "No subscriptions or bills match."
    with pytest.raises(ToolError):
        look(ctx, "list_recurring", text="9988")


# ---- Budgets ---------------------------------------------------------------------------------


def test_there_are_no_budgets_to_list_until_one_is_made(session: Session, admin: User) -> None:
    household(session)

    assert look(context(session, admin), "list_budgets") == "There are no budgets."


def test_budgets_are_listed_with_how_the_period_is_going_and_what_counts(
    session: Session, admin: User
) -> None:
    made = household(session)
    item = add_item(session, made.checking.id, "Netflix")
    budget = create_budget(
        session,
        BudgetCreate(
            name="Groceries", period=BudgetPeriod.MONTHLY, amount=Decimal("500"), today=TODAY
        ),
    )
    create_budget(
        session,
        BudgetCreate(
            name="Cushion", period=BudgetPeriod.YEARLY, amount=Decimal("100"), today=TODAY
        ),
    )
    add_source(
        session, budget, BudgetSourceIn(kind=BudgetKind.SPENDING, category_id=made.groceries.id)
    )
    add_source(session, budget, BudgetSourceIn(kind=BudgetKind.SPENDING, subscription_id=item.id))
    add_source(session, budget, BudgetSourceIn(kind=BudgetKind.SPENDING, account_id=made.card.id))
    add_transaction(session, made.checking, "-84.12", "Whole Foods", category_id=made.groceries.id)
    session.commit()
    ctx = context(session, admin)

    listed = look(ctx, "list_budgets")

    assert len(set(codes(listed, "B"))) == 2
    groceries = next(line for line in rows(listed) if "| Groceries |" in line)
    assert (
        " | monthly | 500.00 USD each period | this period 2026-09-01 to 2026-09-30: " in groceries
    )
    assert "spent 84.12 USD, income 0.00 USD" in groceries
    assert "category Groceries (spending)" in groceries
    assert "subscription Netflix (spending)" in groceries
    # An account that counts is only a code.
    assert re.search(rf"account {ACCOUNT} \(spending\)", groceries)
    assert "Rewards Visa" not in listed
    cushion = next(line for line in rows(listed) if "| Cushion |" in line)
    assert cushion.endswith("counts nothing but single transactions")
    for secret in SECRETS:
        assert secret.lower() not in listed.lower()
