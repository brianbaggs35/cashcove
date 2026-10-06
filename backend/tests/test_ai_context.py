"""What the AI is given to answer questions from the household's records."""

import datetime as dt
import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai import context
from app.ai.deps import ai_sessions, ai_transport
from app.models import (
    Budget,
    BudgetAmount,
    BudgetKind,
    BudgetLink,
    BudgetPeriod,
    PaymentFrequency,
    RecurringKind,
    Subscription,
)
from e2e.ai import FakeAI
from tests.ai import Household, configure, household
from tests.finance import TODAY, add_account, add_transaction
from tests.rates import FakeRates


def system_of(fake: FakeAI) -> str:
    system: str = json.loads(fake.requests[-1].body)["instructions"]
    return system


def ask(client: TestClient, text: str = "How is it going?") -> None:
    response = client.post(
        "/api/ai/chat",
        json={"messages": [{"role": "user", "content": text}], "today": TODAY.isoformat()},
    )
    assert response.status_code == 200, response.text


def test_the_real_dependencies_use_the_internet_and_the_apps_own_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert ai_transport() is None
    assert callable(ai_sessions())


def test_months_with_no_activity_are_still_listed_and_old_history_is_left_to_the_totals(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    made = household(session)
    # More than six months back, which the category table leaves out, and income, which isn't
    # spending so isn't in the table of what it went on.
    made.transaction("Old Grocer", "-50.00", made.groceries, date=dt.date(2026, 1, 5))
    made.transaction("Acme", "2400.00", made.paycheck, date=dt.date(2026, 9, 1))
    made.transaction("Recent Grocer", "-20.00", made.groceries, date=dt.date(2026, 9, 10))
    configure(admin_client)

    ask(admin_client)

    system = system_of(fake_ai)
    months = system.split("## Income and spending by month\n")[1].split("\n\n")[0].splitlines()
    assert months[0] == "Month | Income | Spent | Left over"
    assert [line.split(" | ")[0] for line in months[1:]] == [
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
    ]
    assert "2026-01 | 0.00 | 50.00 | -50.00" in months
    assert "2026-09 | 2,400.00 | 20.00 | 2,380.00" in months
    categories = system.split("latest 6 months\n")[1].split("\n\n")[0]
    assert categories == "Groceries: 2026-09 20.00"
    payees = system.split("last 90 days\n")[1].split("\n\n")[0]
    assert payees == "Recent Grocer: 20.00 over 1 transactions"


def test_a_currency_with_no_rate_is_left_out_and_said_so(
    admin_client: TestClient, session: Session, fake_ai: FakeAI, rates: FakeRates
) -> None:
    made = household(session)
    made.transaction("Corner Shop", "-30.00", made.groceries, date=TODAY)
    add_transaction(session, add_account(session, "Euro account", currency="EUR"), "-100.00")
    configure(admin_client)

    ask(admin_client)

    system = system_of(fake_ai)
    assert "Left out of the totals, with no exchange rate" in system
    assert system.endswith("EUR")
    assert "2026-09 | 0.00 | 30.00 | -30.00" in system


def test_a_currency_with_a_rate_is_converted_into_the_households(
    admin_client: TestClient, session: Session, fake_ai: FakeAI, rates: FakeRates
) -> None:
    made = household(session)
    add_transaction(
        session,
        add_account(session, "Euro account", currency="EUR"),
        "-100.00",
        "Paris Cafe",
        date=dt.date(2026, 9, 10),
    )
    made.transaction("Corner Shop", "-30.00", made.groceries, date=TODAY)
    rates.rate("EUR", "1.10")
    configure(admin_client)

    ask(admin_client)

    system = system_of(fake_ai)
    assert "Left out of the totals" not in system
    assert "2026-09 | 0.00 | 140.00 | -140.00" in system
    # A transaction is shown in the currency it happened in.
    assert "Paris Cafe | Uncategorized | -100.00 EUR" in system


@pytest.mark.parametrize(
    ("question", "words"),
    [
        ("How much did I spend at Starbucks last month?", ["starbucks"]),
        ("What about Netflix, Spotify and Hulu?", ["netflix", "spotify", "hulu"]),
        ("my budget for the household", []),
        ("Amazon amazon AMAZON Prime", ["amazon", "prime"]),
        ("a b cd 12 34", []),
        (
            "one two three four five six seven eight",
            ["one", "two", "three", "four", "five"],
        ),
        ("What did [hidden] cost at Ben & Jerry's?", ["ben", "jerry's"]),
    ],
)
def test_the_words_that_could_be_a_payee_are_picked_out_of_a_question(
    question: str, words: list[str]
) -> None:
    assert context.keywords(question) == words


def test_transactions_whose_payee_matches_the_question_are_listed_even_when_old(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    made: Household = household(session)
    made.transaction("Netflix", "-15.49", made.subscriptions, date=dt.date(2025, 12, 1))
    made.transaction("Corner Shop", "-3.00", made.groceries, date=TODAY)
    configure(admin_client)

    ask(admin_client, "When did I last pay Netflix?")

    system = system_of(fake_ai)
    matches = system.split("## Transactions whose payee matches the question")[1]
    assert "2025-12-01 | Netflix | Subscriptions | -15.49 USD" in matches
    assert "Corner Shop" not in matches
    # Too old for the latest transactions.
    assert (
        "Netflix" not in system.split("## Latest transactions")[1].split("## Transactions whose")[0]
    )


def test_a_question_with_no_payee_in_it_has_no_matches_section(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)

    ask(admin_client, "How am I doing?")

    assert "Transactions whose payee matches" not in system_of(fake_ai)


def test_a_question_that_matches_nothing_says_so(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    household(session)
    configure(admin_client)

    ask(admin_client, "Anything from Zanzibar?")

    assert "No transaction's payee matches the question." in system_of(fake_ai)


def test_budgets_and_recurring_payments_are_described_without_their_accounts(
    admin_client: TestClient, session: Session, fake_ai: FakeAI
) -> None:
    made = household(session)
    budget = Budget(name="Household", period=BudgetPeriod.MONTHLY, starts_on=dt.date(2026, 1, 1))
    budget.amounts = [BudgetAmount(starts_on=dt.date(2026, 1, 1), amount=Decimal("2000.00"))]
    session.add(budget)
    session.add_all(
        [
            Subscription(
                name="Netflix",
                payee="Netflix",
                amount=Decimal("15.49"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=made.checking.id,
                next_due_date=dt.date(2026, 10, 1),
            ),
            Subscription(
                name="Electric",
                payee="City Power",
                amount=Decimal("90.00"),
                amount_varies=True,
                frequency=PaymentFrequency.MONTHLY,
                account_id=made.checking.id,
                next_due_date=dt.date(2026, 9, 25),
                kind=RecurringKind.BILL,
            ),
            Subscription(
                name="Old gym",
                payee="Gym",
                amount=Decimal("30.00"),
                frequency=PaymentFrequency.MONTHLY,
                account_id=made.checking.id,
                next_due_date=dt.date(2026, 10, 2),
                active=False,
            ),
        ]
    )
    session.commit()
    made.transaction("Corner Shop", "-100.00", made.groceries, date=TODAY)
    session.add(
        BudgetLink(budget_id=budget.id, kind=BudgetKind.SPENDING, account_id=made.checking.id)
    )
    session.commit()
    configure(admin_client)

    ask(admin_client)

    system = system_of(fake_ai)
    assert "Household (monthly): 2,000.00 each period; this one, 2026-09-01 to 2026-09-30" in system
    assert "100.00 spent" in system
    assert "bill Electric: about 90.00 monthly, next due 2026-09-25" in system
    assert "subscription Netflix: 15.49 monthly, next due 2026-10-01" in system
    # One that's paused isn't an upcoming payment.
    assert "Old gym" not in system
    # The account the payments come from isn't named.
    assert "Everyday checking" not in system
