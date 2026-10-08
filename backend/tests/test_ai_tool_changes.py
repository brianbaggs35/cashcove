"""The changes the AI can propose: how each is checked, how it is worded for people, and what it
does when it is approved."""

import datetime as dt
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.tools.base import Context, ToolError
from app.ai.vault import Entity, Subject
from app.auth.deps import ApiError
from app.finance.automations import RuleBook
from app.finance.budget import create_budget
from app.models import (
    Account,
    Automation,
    AutomationDirection,
    AutomationMatch,
    AutomationScope,
    Budget,
    BudgetPeriod,
    Category,
    CategoryGroup,
    CategoryKind,
    PaymentFrequency,
    RecurringKind,
    Subscription,
    Transaction,
    User,
)
from app.schemas.budget import BudgetCreate
from tests.ai import Household, household
from tests.assistant import add_item, apply, codes, context, look, payments, prepare, tracked
from tests.finance import TODAY, add_account, add_category, add_transaction


def ready(session: Session, admin: User) -> tuple[Household, Context]:
    made = household(session)
    return made, context(session, admin)


def found(ctx: Context, **args: object) -> list[str]:
    """The codes of the transactions a look-up finds."""
    return codes(look(ctx, "find_transactions", **args), "T")


def reload(session: Session, row: object) -> None:
    session.commit()
    session.refresh(row)


# ---- Giving transactions a category ----------------------------------------------------------


def test_transactions_are_given_a_category_the_way_someone_choosing_it_would(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    rows = made.sorted_badly()
    chosen = found(ctx, category="none")

    prepared = prepare(ctx, "categorize_transactions", transactions=chosen, category="coffee")

    # In Cashcove's words, with the real payees for the person who decides.
    assert prepared.title == "Put 2 transactions in Coffee"
    assert prepared.summary == "2 transactions will be put in Coffee."
    assert "2026-09-18 · Venmo · -40.00 USD" in prepared.details
    assert any("Starbucks 12345" in line for line in prepared.details)
    assert prepared.details[-1] == "Automations leave a category you choose as it is from then on."
    # Nothing has changed yet.
    session.refresh(rows["venmo"])
    assert rows["venmo"].category_id is None

    assert apply(session, "categorize_transactions", prepared) == "Put 2 transactions in Coffee."
    reload(session, rows["venmo"])
    reload(session, rows["starbucks"])
    for row in (rows["venmo"], rows["starbucks"]):
        assert row.category_id == made.coffee.id
        assert row.category_chosen is True


def test_a_category_can_be_taken_off_which_hands_it_back_to_automations(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    rows = made.sorted_badly()
    code = found(ctx, text="whole")

    prepared = prepare(ctx, "categorize_transactions", transactions=code, category="none")

    assert prepared.title == "Take the category off 1 transaction"
    assert prepared.summary == "1 transaction will have no category."
    assert (
        apply(session, "categorize_transactions", prepared)
        == "Took the category off 1 transaction."
    )
    reload(session, rows["whole_foods"])
    assert rows["whole_foods"].category_id is None
    assert rows["whole_foods"].category_chosen is False


def test_only_the_first_few_transactions_are_listed_for_people_to_check(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    payments(session, made.checking, "Gym", "30.00", 12)

    prepared = prepare(
        ctx, "categorize_transactions", transactions=found(ctx, text="gym"), category="Coffee"
    )

    assert prepared.title == "Put 12 transactions in Coffee"
    assert prepared.details[:8] == [
        f"{TODAY.replace(day=3).replace(month=8)} · Gym · -30.00 USD",
        *prepared.details[1:8],
    ]
    assert prepared.details[8] == "and 4 more"


def test_the_same_transaction_twice_is_one(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    made.sorted_badly()
    [code] = found(ctx, text="venmo")

    prepared = prepare(ctx, "categorize_transactions", transactions=[code, code], category="Coffee")

    assert prepared.title == "Put 1 transaction in Coffee"
    assert len(prepared.step["transaction_ids"]) == 1


def test_a_category_change_that_cant_be_made_is_refused_for_the_ai_to_put_right(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    made.sorted_badly()
    [code] = found(ctx, text="venmo")

    with pytest.raises(ToolError, match="no category called 'Hobbies'"):
        prepare(ctx, "categorize_transactions", transactions=[code], category="Hobbies")
    with pytest.raises(ToolError, match="not a code from a look-up"):
        prepare(ctx, "categorize_transactions", transactions=["Taa1"], category="Coffee")
    with pytest.raises(ValidationError):
        prepare(ctx, "categorize_transactions", transactions=[], category="Coffee")
    with pytest.raises(ValidationError):
        prepare(ctx, "categorize_transactions", transactions=[code])


def test_a_category_that_has_gone_since_it_was_proposed_stops_the_change(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    made.sorted_badly()
    [code] = found(ctx, text="venmo")
    prepared = prepare(ctx, "categorize_transactions", transactions=[code], category="Coffee")
    session.delete(made.coffee)
    session.commit()

    with pytest.raises(ToolError, match="The category Coffee doesn't exist"):
        apply(session, "categorize_transactions", prepared)


# ---- Adding a category -----------------------------------------------------------------------


def test_a_category_is_added_to_a_group_the_household_has(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)

    prepared = prepare(ctx, "create_category", name=" Pet  food ", group="food & DRINK", emoji="🐶")

    assert prepared.title == "Add the category Pet food"
    assert prepared.summary == "🐶 Pet food will be added to the group Food & drink."
    assert prepared.details == []
    assert prepared.step["new_group_kind"] is None
    assert session.scalar(select(Category).where(Category.name == "Pet food")) is None

    assert (
        apply(session, "create_category", prepared)
        == "Added the category Pet food to Food & drink."
    )
    session.commit()
    added = session.scalars(select(Category).where(Category.name == "Pet food")).one()
    assert (added.emoji, added.group_id) == ("🐶", made.groceries.group_id)


def test_a_category_can_start_a_group_when_the_ai_says_what_kind(
    session: Session, admin: User
) -> None:
    _, ctx = ready(session, admin)

    prepared = prepare(ctx, "create_category", name="Pets", group="Animals", group_kind="expense")

    assert prepared.summary == "🏷️ Pets will be added to a new expense group called Animals."
    apply(session, "create_category", prepared)
    session.commit()
    group = session.scalars(select(CategoryGroup).where(CategoryGroup.name == "Animals")).one()
    assert group.kind == CategoryKind.EXPENSE
    assert [category.name for category in group.categories] == ["Pets"]


def test_a_category_with_a_group_that_isnt_there_says_which_there_are(
    session: Session, admin: User
) -> None:
    _, ctx = ready(session, admin)

    with pytest.raises(
        ToolError, match=r"There is no group called Animals\. Choose one of: .*Income"
    ):
        prepare(ctx, "create_category", name="Pets", group="Animals")


def test_an_emoji_that_isnt_one_is_replaced_by_the_default(session: Session, admin: User) -> None:
    _, ctx = ready(session, admin)

    for emoji in (None, "", "two words", "x" * 20):
        ctx.new_categories.clear()
        prepared = prepare(ctx, "create_category", name="Pets", group="Lifestyle", emoji=emoji)
        assert prepared.step["emoji"] == "🏷️"


def test_a_category_name_that_is_taken_or_not_allowed_is_refused(
    session: Session, admin: User
) -> None:
    _, ctx = ready(session, admin)

    with pytest.raises(ToolError, match="There is already a category called Coffee"):
        prepare(ctx, "create_category", name="coffee", group="Lifestyle")
    with pytest.raises(ToolError, match="can't have a code"):
        prepare(ctx, "create_category", name="Pets [x]", group="Lifestyle")
    with pytest.raises(ToolError, match="The group's name has to be"):
        prepare(ctx, "create_category", name="Pets", group="x" * 61)
    prepare(ctx, "create_category", name="Pets", group="Lifestyle")
    # Adding the same one twice in a proposal is refused too.
    with pytest.raises(ToolError, match="There is already a category called Pets"):
        prepare(ctx, "create_category", name="pets", group="Lifestyle")


def test_a_category_added_earlier_in_the_proposal_can_be_used_by_the_changes_after_it(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    made.sorted_badly()
    [code] = found(ctx, text="venmo")

    added = prepare(ctx, "create_category", name="Pets", group="Lifestyle")
    sorted_in = prepare(ctx, "categorize_transactions", transactions=[code], category="pets")

    assert sorted_in.title == "Put 1 transaction in Pets"
    # Approving runs them in order, so the second finds the first's work.
    apply(session, "create_category", added)
    apply(session, "categorize_transactions", sorted_in)
    session.commit()
    pets = session.scalars(select(Category).where(Category.name == "Pets")).one()
    venmo = session.scalars(select(Transaction).where(Transaction.payee == "Venmo")).one()
    assert venmo.category_id == pets.id


def test_a_category_added_in_the_meantime_stops_the_change(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    prepared = prepare(ctx, "create_category", name="Pets", group="Lifestyle")
    add_category(session, "pets", made.gifts.group)

    with pytest.raises(ApiError, match="There's already a category called pets"):
        apply(session, "create_category", prepared)


def test_a_group_that_has_gone_since_it_was_proposed_stops_the_change(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    prepared = prepare(ctx, "create_category", name="Pets", group="Lifestyle")
    session.delete(made.gifts.group)
    session.commit()

    with pytest.raises(ToolError, match="The group Lifestyle doesn't exist"):
        apply(session, "create_category", prepared)


# ---- Grouping identical transactions with an automation --------------------------------------


def test_an_automation_groups_every_transaction_with_the_same_payee_now_and_later(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    payments(session, made.checking, "NETFLIX.COM 866-579-7172", "15.49", 3)
    payments(session, made.card, "Netflix", "15.49", 1)

    prepared = prepare(
        ctx, "create_automation", text="netflix", category="Subscriptions", direction="out"
    )

    assert prepared.title == "Sort payments that match “netflix”"
    assert prepared.summary == (
        "Every transaction whose payee has “netflix” gets the category Subscriptions: "
        "the ones already there and every one that comes later."
    )
    assert prepared.details == ["4 transactions match now."]
    assert session.scalars(select(Automation)).first() is None

    assert apply(session, "create_automation", prepared) == (
        "Added the automation Netflix, which sorted 4 transactions."
    )
    session.commit()
    automation = session.scalars(select(Automation)).one()
    assert (automation.payees, automation.match) == (["netflix"], AutomationMatch.CONTAINS)
    assert automation.direction == AutomationDirection.OUT
    sorted_now = session.scalars(
        select(Transaction).where(Transaction.category_id == made.subscriptions.id)
    ).all()
    assert len(sorted_now) == 4
    # And the ones that come later.
    later = add_transaction(session, made.checking, "-15.49", "NETFLIX.COM 866-579-7172")
    RuleBook.load(session).sort(later)
    assert later.category_id == made.subscriptions.id


def test_an_automation_can_be_for_the_future_only(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    payments(session, made.checking, "Netflix", "15.49", 2)

    prepared = prepare(
        ctx, "create_automation", text="netflix", category="Subscriptions", apply_to="future"
    )

    assert prepared.summary.endswith("the ones that come from now on.")
    assert apply(session, "create_automation", prepared).endswith("which sorted 0 transactions.")
    session.commit()
    assert not session.scalars(
        select(Transaction).where(Transaction.category_id == made.subscriptions.id)
    ).all()
    assert session.scalars(select(Automation)).one().apply_to == AutomationScope.FUTURE


def test_an_automation_can_link_payments_to_a_subscription_or_a_bill(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    payments(session, made.checking, "Netflix", "15.49", 2)
    item = Subscription(
        name="Netflix",
        kind=RecurringKind.SUBSCRIPTION,
        payee="Something else",
        amount=Decimal("15.49"),
        frequency=PaymentFrequency.MONTHLY,
        account_id=made.checking.id,
        next_due_date=TODAY,
    )
    session.add(item)
    session.commit()
    [code] = codes(look(ctx, "list_recurring"), "S")

    prepared = prepare(ctx, "create_automation", text="netflix", link_to=code, name="Netflix rule")

    assert prepared.summary.startswith(
        "Every transaction whose payee has “netflix” gets a link to Netflix"
    )
    assert prepared.details == ["2 transactions match now."]
    apply(session, "create_automation", prepared)
    session.commit()
    linked = session.scalars(
        select(Transaction).where(Transaction.subscription_id == item.id)
    ).all()
    assert len(linked) == 2
    assert session.scalars(select(Automation)).one().name == "Netflix rule"


def test_people_are_told_when_an_older_automation_already_sorts_some_of_it(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    payments(session, made.checking, "Netflix", "15.49", 2)
    existing = prepare(ctx, "create_automation", text="flix", category="Coffee")
    apply(session, "create_automation", existing)
    session.commit()

    prepared = prepare(ctx, "create_automation", text="netflix", category="Subscriptions")

    assert prepared.details == [
        "2 transactions match now.",
        "Flix already sorts 2 of these, and goes first.",
    ]


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({"text": "netflix"}, "Say which category it should give, or which subscription"),
        ({"text": "ab", "category": "Coffee"}, "has to be 3 to 60 characters"),
        ({"text": "Store 12345", "category": "Coffee"}, "can't be used"),
        ({"text": "tartan", "category": "Coffee"}, "can't have a code"),
        ({"text": "netflix", "category": "Hobbies"}, "no category called 'Hobbies'"),
        ({"text": "netflix", "link_to": "Saa9"}, "not a code from a look-up"),
        ({"text": "netflix", "category": "Coffee", "name": "x" * 121}, "has to be 1 to 120"),
    ],
)
def test_an_automation_that_makes_no_sense_is_refused_for_the_ai_to_put_right(
    session: Session, admin: User, args: dict[str, object], message: str
) -> None:
    _, ctx = ready(session, admin)

    with pytest.raises(ToolError, match=message):
        prepare(ctx, "create_automation", **args)


def test_money_coming_in_has_no_subscription_to_link(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    session.add(
        Subscription(
            name="Netflix",
            payee="Netflix",
            amount=Decimal("15.49"),
            frequency=PaymentFrequency.MONTHLY,
            account_id=made.checking.id,
            next_due_date=TODAY,
        )
    )
    session.commit()
    [code] = codes(look(ctx, "list_recurring"), "S")

    with pytest.raises(ToolError, match="which is money going out"):
        prepare(ctx, "create_automation", text="netflix", link_to=code, direction="in")


def test_a_subscription_that_has_gone_stops_the_automation(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    item = Subscription(
        name="Netflix",
        payee="Netflix",
        amount=Decimal("15.49"),
        frequency=PaymentFrequency.MONTHLY,
        account_id=made.checking.id,
        next_due_date=TODAY,
    )
    session.add(item)
    session.commit()
    [code] = codes(look(ctx, "list_recurring"), "S")
    prepared = prepare(ctx, "create_automation", text="netflix", link_to=code)
    session.delete(item)
    session.commit()

    with pytest.raises(ApiError, match="That subscription or bill doesn't exist anymore"):
        apply(session, "create_automation", prepared)


# ---- Adding a subscription or a bill ---------------------------------------------------------


def account_code(ctx: Context, account: Account) -> str:
    """The code the AI is told for an account."""
    return ctx.vault.code_for(Entity(Subject.ACCOUNT, account.name, account.id))


def netflix(session: Session, made: Household) -> None:
    """Three payments to Netflix from checking, newest first, and one from the card."""
    payments(session, made.card, "Netflix", "15.49", 1)
    payments(session, made.checking, "NETFLIX.COM 866-579-7172", "15.49", 3)


def test_a_subscription_is_set_up_from_a_payment_and_links_every_one_like_it(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    netflix(session, made)
    [newest, *_] = found(ctx, text="netflix")

    prepared = prepare(
        ctx,
        "create_recurring",
        name="Netflix",
        amount="15.49",
        frequency="monthly",
        next_due="2026-10-03",
        category="Subscriptions",
        from_transaction=newest,
        match_text="netflix",
    )

    assert prepared.title == "Add the subscription Netflix"
    assert prepared.summary == "Netflix: 15.49 USD monthly, next due 2026-10-03."
    assert prepared.details == [
        "Category: Subscriptions.",
        "Paid from Everyday checking.",
        "Tracks payments to “NETFLIX.COM 866-579-7172” from that account: 3 already there.",
        "Also an automation that finds every payment whose payee has “netflix”, in any "
        "account, and links it here: 4 payments now, and every one that comes later.",
    ]
    assert not tracked(session)

    result = apply(session, "create_recurring", prepared)
    session.commit()

    assert result == (
        "Added the subscription Netflix. 4 payments linked to it, and the ones to come will be."
    )
    [item] = tracked(session)
    assert (item.payee, item.account_id) == ("NETFLIX.COM 866-579-7172", made.checking.id)
    payments_linked = session.scalars(
        select(Transaction).where(Transaction.subscription_id == item.id)
    ).all()
    # All four, past ones from both accounts, and they take its category.
    assert len(payments_linked) == 4
    assert {payment.category_id for payment in payments_linked} == {made.subscriptions.id}
    automation = session.scalars(select(Automation)).one()
    assert automation.payees == ["netflix"]
    assert automation.match == AutomationMatch.CONTAINS
    assert automation.direction == AutomationDirection.OUT
    assert (automation.subscription_id, automation.category_id) == (item.id, made.subscriptions.id)
    assert automation.apply_to == AutomationScope.ALL
    assert automation.name == "Netflix payments"
    # The ones that come later, however the bank writes the payee.
    later = add_transaction(session, made.card, "-15.49", "NETFLIX.COM 866-579-7172 CA")
    RuleBook.load(session).sort(later)
    assert later.subscription_id == item.id
    assert later.category_id == made.subscriptions.id


def test_a_subscription_can_be_set_up_from_what_the_person_said(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)

    prepared = prepare(
        ctx,
        "create_recurring",
        name="Hulu",
        amount=7.99,
        frequency="monthly",
        next_due="2026-11-03",
        account=account_code(ctx, made.card),
        link_all=False,
        notes="Ad plan",
    )

    assert prepared.details == [
        "Category: none.",
        "Paid from Rewards Visa.",
        "Tracks payments to “Hulu” from that account: 0 already there.",
    ]
    apply(session, "create_recurring", prepared)
    session.commit()
    [item] = tracked(session)
    assert (item.name, item.account_id, item.notes) == ("Hulu", made.card.id, "Ad plan")
    assert not session.scalars(select(Automation)).all()


def test_a_bill_whose_amount_changes_is_said_to_be_about_that_much(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)

    prepared = prepare(
        ctx,
        "create_recurring",
        kind="bill",
        name="Power",
        amount="$85.00",
        amount_varies=True,
        frequency="quarterly",
        next_due="2026-10-15",
        account=account_code(ctx, made.checking),
        payee="City Power",
        match_text="city power",
        match="starts_with",
    )

    assert prepared.title == "Add the bill Power"
    assert prepared.summary == "Power: about 85.00 USD quarterly, next due 2026-10-15."
    assert "payee starts with “city power”" in prepared.details[-1]
    apply(session, "create_recurring", prepared)
    session.commit()
    [item] = tracked(session)
    assert item.kind == RecurringKind.BILL
    assert item.amount_varies
    assert item.frequency == PaymentFrequency.QUARTERLY


def test_with_one_open_account_it_is_not_asked_which(session: Session, admin: User) -> None:
    add_account(session, "Only account")
    ctx = context(session, admin)

    prepared = prepare(
        ctx,
        "create_recurring",
        name="Hulu",
        amount="7.99",
        frequency="monthly",
        next_due="2026-11-03",
        link_all=False,
    )

    assert prepared.details[1] == "Paid from Only account."


def test_with_several_accounts_which_one_is_not_guessed(session: Session, admin: User) -> None:
    _, ctx = ready(session, admin)

    with pytest.raises(ToolError, match=r"Which account is it paid from\? Ask the person"):
        prepare(
            ctx,
            "create_recurring",
            name="Hulu",
            amount="7.99",
            frequency="monthly",
            next_due="2026-11-03",
        )


def test_an_account_is_only_ever_one_of_the_codes_the_ai_was_given(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    bank = ctx.vault.code_for(Entity(Subject.BANK, "Tartan Bank"))
    base = {"name": "Hulu", "amount": "7.99", "frequency": "monthly", "next_due": "2026-11-03"}

    for account in ("Everyday checking", bank, "<ACCOUNT_bcdfghjkmn>", str(made.card.id)):
        with pytest.raises(ToolError, match="isn't one of the account codes listed"):
            prepare(ctx, "create_recurring", **base, account=account)


def test_a_payment_to_take_the_account_from_has_to_be_one(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    made.sorted_badly()
    add_transaction(session, made.checking, "2400.00", "Acme payroll")
    [paycheck] = found(ctx, direction="in")
    base = {"name": "Acme", "amount": "7.99", "frequency": "monthly", "next_due": "2026-11-03"}

    with pytest.raises(ToolError, match="has to be a payment, which is money going out"):
        prepare(ctx, "create_recurring", **base, from_transaction=paycheck)
    with pytest.raises(ToolError, match="not a code from a look-up"):
        prepare(ctx, "create_recurring", **base, from_transaction="Taa1")


def test_a_payee_already_tracked_from_an_account_is_said_so(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    add_item(session, made.checking.id, "Netflix", payee="Netflix")
    account = account_code(ctx, made.checking)

    with pytest.raises(
        ToolError, match="A subscription already tracks this payee from this account"
    ):
        prepare(
            ctx,
            "create_recurring",
            name="Netflix again",
            payee="netflix",
            amount="7.99",
            frequency="monthly",
            next_due="2026-11-03",
            account=account,
        )


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({"next_due": "2020-01-01"}, "too far from today"),
        ({"next_due": "2040-01-01"}, "too far from today"),
        ({"amount": "0"}, "more than 0"),
        ({"amount": "-5"}, "more than 0"),
        ({"amount": "1e30"}, "more than 0"),
        ({"name": "Hulu <x>"}, "can't have a code"),
        ({"name": ""}, "has to be 1 to 120"),
        ({"payee": "Hulu 123456"}, "can't be used"),
        ({"match_text": "ab"}, "has to be 3 to 60"),
        ({"match_text": "Tartan"}, "can't have a code"),
        ({"notes": "call me at 415-555-1234"}, "can't have a code"),
        ({"category": "Hobbies"}, "no category called 'Hobbies'"),
    ],
)
def test_a_subscription_that_makes_no_sense_is_refused_for_the_ai_to_put_right(
    session: Session, admin: User, args: dict[str, object], message: str
) -> None:
    made, ctx = ready(session, admin)
    given: dict[str, object] = {
        "name": "Hulu",
        "amount": "7.99",
        "frequency": "monthly",
        "next_due": "2026-11-03",
        "account": account_code(ctx, made.checking),
    }

    with pytest.raises(ToolError, match=message):
        prepare(ctx, "create_recurring", **{**given, **args})


@pytest.mark.parametrize(
    "args",
    [{"frequency": "daily"}, {"amount": "lots"}, {"amount": "NaN"}, {"kind": "loan"}, {}],
)
def test_a_subscription_with_a_value_of_the_wrong_kind_is_a_validation_error(
    session: Session, admin: User, args: dict[str, object]
) -> None:
    made, ctx = ready(session, admin)
    given: dict[str, object] = {
        "name": "Hulu",
        "amount": "7.99",
        "frequency": "monthly",
        "next_due": "2026-11-03",
        "account": account_code(ctx, made.checking),
    }
    given.update(args)
    if not args:
        del given["amount"]

    with pytest.raises(ValidationError):
        prepare(ctx, "create_recurring", **given)


def test_what_changed_while_a_subscription_waited_stops_it(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    base = {
        "name": "Hulu",
        "amount": "7.99",
        "frequency": "monthly",
        "next_due": "2026-11-03",
        "account": account_code(ctx, made.checking),
        "link_all": False,
    }
    prepared = prepare(ctx, "create_recurring", **base, category="Subscriptions")

    # Someone else tracks the payee in the meantime...
    add_item(session, made.checking.id, "Hulu")
    with pytest.raises(ApiError, match="already tracks this payee"):
        apply(session, "create_recurring", prepared)
    # ...or the account is closed, or the category goes.
    session.query(Subscription).delete()
    made.checking.closed_at = dt.datetime(2026, 9, 19, tzinfo=dt.UTC)
    session.commit()
    with pytest.raises(ApiError, match="Choose an open account"):
        apply(session, "create_recurring", prepared)
    made.checking.closed_at = None
    session.delete(made.subscriptions)
    session.commit()
    with pytest.raises(ToolError, match="The category Subscriptions doesn't exist"):
        apply(session, "create_recurring", prepared)


# ---- Changing a subscription or a bill -------------------------------------------------------


def test_a_subscription_can_be_changed_and_it_says_what_will_be(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    item = add_item(session, made.checking.id, "Netflix", amount="15.49")
    payment = add_transaction(
        session, made.checking, "-15.49", "Netflix", subscription_id=item.id, date=TODAY
    )
    [code] = codes(look(ctx, "list_recurring"), "S")

    prepared = prepare(
        ctx,
        "update_recurring",
        item=code,
        name="Netflix Premium",
        amount="22.99",
        frequency="annual",
        next_due="2027-01-03",
        category="Subscriptions",
        active=False,
    )

    assert prepared.title == "Change the subscription Netflix"
    assert prepared.summary == "These will change:"
    assert prepared.details == [
        "Name: Netflix → Netflix Premium.",
        "Amount: 15.49 USD → 22.99 USD.",
        "How often: monthly → annual.",
        "Next due: 2026-09-20 → 2027-01-03.",
        "Category: Subscriptions; its linked payments get it too.",
        "Tracking is paused.",
    ]
    assert apply(session, "update_recurring", prepared) == "Changed the subscription Netflix."
    session.commit()
    session.refresh(item)
    session.refresh(payment)
    assert (item.name, item.amount, item.frequency, item.active) == (
        "Netflix Premium",
        Decimal("22.99"),
        PaymentFrequency.ANNUAL,
        False,
    )
    assert item.next_due_date == dt.date(2027, 1, 3)
    assert payment.category_id == made.subscriptions.id


def test_a_subscriptions_category_can_be_taken_off_and_tracking_started_again(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    item = add_item(
        session, made.checking.id, "Netflix", category_id=made.subscriptions.id, active=False
    )
    [code] = codes(look(ctx, "list_recurring"), "S")

    prepared = prepare(ctx, "update_recurring", item=code, category="none", active=True)

    assert prepared.details == [
        "Category: none; its linked payments get it too.",
        "Payments will be tracked again.",
    ]
    apply(session, "update_recurring", prepared)
    session.commit()
    session.refresh(item)
    assert item.category_id is None
    assert item.active


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({}, "Say what to change"),
        ({"next_due": "2040-01-01"}, "too far from today"),
        ({"amount": "0"}, "more than 0"),
        ({"name": "Bad #name"}, "can't have a code"),
        ({"category": "Hobbies"}, "no category called 'Hobbies'"),
        ({"item": "Saa1", "amount": "5"}, "not a code from a look-up"),
    ],
)
def test_a_change_to_a_subscription_that_makes_no_sense_is_refused(
    session: Session, admin: User, args: dict[str, object], message: str
) -> None:
    made, ctx = ready(session, admin)
    add_item(session, made.checking.id, "Netflix")
    [code] = codes(look(ctx, "list_recurring"), "S")

    with pytest.raises(ToolError, match=message):
        prepare(ctx, "update_recurring", **{"item": code, **args})


def test_a_subscription_that_has_gone_cant_be_changed(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    item = add_item(session, made.checking.id, "Netflix")
    [code] = codes(look(ctx, "list_recurring"), "S")
    prepared = prepare(ctx, "update_recurring", item=code, amount="5")
    session.delete(item)
    session.commit()

    with pytest.raises(ToolError, match="doesn't exist"):
        apply(session, "update_recurring", prepared)


# ---- Budgets ---------------------------------------------------------------------------------


def test_a_budget_is_added(session: Session, admin: User) -> None:
    _, ctx = ready(session, admin)

    prepared = prepare(ctx, "create_budget", name="Vacation", period="monthly", amount="$200")

    assert prepared.title == "Add the budget Vacation"
    assert prepared.summary == "200.00 USD monthly."
    assert prepared.details == ["It counts nothing yet: add what counts toward it afterwards."]
    assert apply(session, "create_budget", prepared) == "Added the budget Vacation."
    session.commit()
    budget = session.scalars(select(Budget)).one()
    assert (budget.name, budget.period) == ("Vacation", BudgetPeriod.MONTHLY)
    assert budget.amounts[0].amount == Decimal("200.00")


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({"amount": "0"}, "more than 0"),
        ({"name": "Vacation | trips"}, "can't have a code"),
    ],
)
def test_a_budget_that_makes_no_sense_is_refused(
    session: Session, admin: User, args: dict[str, object], message: str
) -> None:
    _, ctx = ready(session, admin)

    with pytest.raises(ToolError, match=message):
        prepare(ctx, "create_budget", **{"name": "V", "period": "monthly", "amount": "5", **args})
    with pytest.raises(ValidationError):
        prepare(ctx, "create_budget", name="V", period="daily", amount="5")


def budget_code(ctx: Context, name: str) -> str:
    listed = look(ctx, "list_budgets")
    line = next(line for line in listed.splitlines() if f"| {name} |" in line)
    return line.split(" | ")[0]


def make_budget(session: Session, name: str = "Groceries", amount: str = "500") -> Budget:
    budget = create_budget(
        session,
        BudgetCreate(name=name, period=BudgetPeriod.MONTHLY, amount=Decimal(amount), today=TODAY),
    )
    session.commit()
    return budget


def test_a_budgets_amount_is_changed_from_the_period_the_person_is_in(
    session: Session, admin: User
) -> None:
    _, ctx = ready(session, admin)
    budget = make_budget(session)

    prepared = prepare(
        ctx, "change_budget", budget=budget_code(ctx, "Groceries"), amount="600", name="Food"
    )

    assert prepared.title == "Change the budget Groceries"
    assert prepared.details == [
        "Amount: 500.00 USD → 600.00 USD, from the period you are in now. Periods that are "
        "over keep what they had.",
        "Name: Groceries → Food.",
    ]
    assert apply(session, "change_budget", prepared) == "Changed the budget Groceries."
    session.commit()
    session.refresh(budget)
    assert budget.name == "Food"
    assert [(row.starts_on, row.amount) for row in budget.amounts][-1] == (
        dt.date(2026, 9, 1),
        Decimal("600.00"),
    )


def test_changing_how_often_a_budget_repeats_says_its_amounts_start_over(
    session: Session, admin: User
) -> None:
    _, ctx = ready(session, admin)
    make_budget(session)

    prepared = prepare(ctx, "change_budget", budget=budget_code(ctx, "Groceries"), period="yearly")

    assert prepared.details == ["How often: monthly → yearly. Its amounts start over."]
    apply(session, "change_budget", prepared)
    session.commit()
    assert session.scalars(select(Budget)).one().period == BudgetPeriod.YEARLY


def test_a_budget_change_that_changes_nothing_says_nothing_will_change(
    session: Session, admin: User
) -> None:
    _, ctx = ready(session, admin)
    make_budget(session)

    prepared = prepare(ctx, "change_budget", budget=budget_code(ctx, "Groceries"), period="monthly")

    assert prepared.details == []


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({}, "Say what to change"),
        ({"amount": "0"}, "more than 0"),
        ({"name": "A [b]"}, "can't have a code"),
        ({"budget": "Baa1", "amount": "5"}, "not a code from a look-up"),
    ],
)
def test_a_budget_change_that_makes_no_sense_is_refused(
    session: Session, admin: User, args: dict[str, object], message: str
) -> None:
    _, ctx = ready(session, admin)
    make_budget(session)
    values = {"budget": budget_code(ctx, "Groceries"), **args}

    with pytest.raises(ToolError, match=message):
        prepare(ctx, "change_budget", **values)


def test_a_budget_that_has_gone_cant_be_changed(session: Session, admin: User) -> None:
    _, ctx = ready(session, admin)
    budget = make_budget(session)
    prepared = prepare(ctx, "change_budget", budget=budget_code(ctx, "Groceries"), amount="600")
    session.delete(budget)
    session.commit()

    with pytest.raises(ApiError, match="doesn't exist"):
        apply(session, "change_budget", prepared)


def test_a_category_or_the_payments_of_a_subscription_can_count_toward_a_budget(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    budget = make_budget(session)
    item = add_item(session, made.checking.id, "Netflix")
    code = budget_code(ctx, "Groceries")
    [item_code] = codes(look(ctx, "list_recurring"), "S")

    by_category = prepare(ctx, "add_budget_source", budget=code, category="groceries")
    by_item = prepare(ctx, "add_budget_source", budget=code, recurring=item_code)

    assert by_category.title == "Count the category Groceries toward Groceries"
    assert by_category.summary == (
        "The category Groceries will count toward the budget Groceries as spending."
    )
    assert by_item.title == "Count the payments of Netflix toward Groceries"
    apply(session, "add_budget_source", by_category)
    assert apply(session, "add_budget_source", by_item) == "Counted it toward the budget Groceries."
    session.commit()
    assert {link.category_id or link.subscription_id for link in budget.links} == {
        made.groceries.id,
        item.id,
    }


def test_income_can_count_toward_a_budget(session: Session, admin: User) -> None:
    made, ctx = ready(session, admin)
    make_budget(session)

    prepared = prepare(
        ctx,
        "add_budget_source",
        budget=budget_code(ctx, "Groceries"),
        category="Paycheck",
        kind="income",
    )

    assert prepared.summary.endswith("as income.")
    assert prepared.step["kind"] == "income"
    assert made.paycheck


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({}, "either a category or a recurring"),
        ({"category": "Coffee", "recurring": "Saa1"}, "either a category or a recurring"),
        ({"category": "Hobbies"}, "no category called 'Hobbies'"),
        ({"recurring": "Saa1"}, "not a code from a look-up"),
        ({"budget": "Baa1", "category": "Coffee"}, "not a code from a look-up"),
    ],
)
def test_something_that_cant_count_toward_a_budget_is_refused(
    session: Session, admin: User, args: dict[str, object], message: str
) -> None:
    _, ctx = ready(session, admin)
    make_budget(session)
    values = {"budget": budget_code(ctx, "Groceries"), **args}

    with pytest.raises(ToolError, match=message):
        prepare(ctx, "add_budget_source", **values)


def test_the_payments_of_a_subscription_count_as_spending_only(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    make_budget(session)
    add_item(session, made.checking.id, "Netflix")
    [item_code] = codes(look(ctx, "list_recurring"), "S")
    budget = budget_code(ctx, "Groceries")

    with pytest.raises(ToolError, match="count as spending"):
        prepare(
            ctx,
            "add_budget_source",
            budget=budget,
            recurring=item_code,
            kind="income",
        )


def test_something_that_counts_already_cant_be_added_again(session: Session, admin: User) -> None:
    _, ctx = ready(session, admin)
    make_budget(session)
    prepared = prepare(
        ctx, "add_budget_source", budget=budget_code(ctx, "Groceries"), category="Coffee"
    )
    apply(session, "add_budget_source", prepared)
    session.commit()

    with pytest.raises(ApiError, match="That already counts toward this budget"):
        apply(session, "add_budget_source", prepared)


def test_a_change_that_leaves_the_category_alone_leaves_it_alone(
    session: Session, admin: User
) -> None:
    made, ctx = ready(session, admin)
    item = add_item(session, made.checking.id, "Netflix", category_id=made.coffee.id)
    [code] = codes(look(ctx, "list_recurring"), "S")

    prepared = prepare(ctx, "update_recurring", item=code, amount="20")

    assert prepared.details == ["Amount: 10.00 USD → 20.00 USD."]
    apply(session, "update_recurring", prepared)
    session.commit()
    session.refresh(item)
    assert (item.amount, item.category_id) == (Decimal("20.00"), made.coffee.id)
