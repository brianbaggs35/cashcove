"""The AI's second opinion on how transactions are sorted, and what becomes of it."""

import datetime as dt
import json
import uuid
from contextlib import nullcontext
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai import errors, reviews
from app.ai.errors import AIError
from app.ai.providers import Connection
from app.ai.reviews import _parse  # pyright: ignore[reportPrivateUsage]
from app.ai.service import AIConfig
from app.models import (
    AIProvider,
    AIRecommendation,
    AIReview,
    AISettings,
    AIUsage,
    Automation,
    AutomationScope,
    Confidence,
    ReviewSource,
    ReviewStatus,
    Transaction,
    User,
)
from app.models.base import utcnow
from e2e.ai import FakeAI
from tests.ai import PROVIDERS, SECRETS, Household, configure, household
from tests.finance import TODAY
from tests.helpers import error, sign_in
from tests.imports import previewed, upload

TODAY_TEXT = TODAY.isoformat()


def begin(client: TestClient, **fields: Any) -> dict[str, Any]:
    """Starts a review, which is answered as soon as it's recorded."""
    response = client.post("/api/ai/reviews", json={"today": TODAY_TEXT, **fields})
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def start(client: TestClient, **fields: Any) -> dict[str, Any]:
    """Starts a review and reads it again once it has run, which it does after the answer."""
    started = begin(client, **fields)
    response = client.get(f"/api/ai/reviews/{started['id']}")
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def suggestions(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/ai/recommendations", params=params)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def payees(page: dict[str, Any]) -> dict[str, str]:
    return {item["payee"]: item["suggested_category_id"] for item in page["items"]}


@pytest.fixture
def made(session: Session) -> Household:
    return household(session)


# ---- A review --------------------------------------------------------------------------------


def test_starting_a_review_answers_at_once_and_the_review_carries_on_after(
    admin_client: TestClient, made: Household
) -> None:
    made.sorted_badly()
    configure(admin_client)

    started = begin(admin_client)

    assert (started["status"], started["total"], started["reviewed"], started["open"]) == (
        "pending",
        5,
        0,
        0,
    )
    assert started["started_at"] is None
    assert started["finished_at"] is None
    assert admin_client.get(f"/api/ai/reviews/{started['id']}").json()["status"] == "done"


def test_a_review_suggests_better_categories_for_what_was_sorted_wrongly(
    admin_client: TestClient, made: Household
) -> None:
    made.sorted_badly()
    configure(admin_client, "openai")

    review = start(admin_client)

    # It runs after the request answers, and has finished by the time it can be read again.
    assert (review["source"], review["status"], review["total"], review["reviewed"]) == (
        "manual",
        "done",
        5,
        5,
    )
    assert (review["provider"], review["model"]) == ("openai", "gpt-6-luna")
    assert (review["open"], review["applied"], review["dismissed"]) == (3, 0, 0)
    assert review["error"] is None
    assert review["started_at"]
    assert review["finished_at"]
    page = suggestions(admin_client)
    assert page["total"] == 3
    assert page["counts"] == {"open": 3, "applied": 0, "dismissed": 0}
    assert payees(page) == {
        "Venmo": str(made.gifts.id),
        "Netflix": str(made.subscriptions.id),
        "Starbucks 12345": str(made.coffee.id),
    }
    venmo = next(item for item in page["items"] if item["payee"] == "Venmo")
    assert venmo["current_category_id"] is None
    assert venmo["confidence"] == "high"
    assert venmo["amount"] == "-40.00"
    assert venmo["currency"] == "USD"
    assert venmo["date"] == "2026-09-18"
    assert venmo["status"] == "open"
    netflix = next(item for item in page["items"] if item["payee"] == "Netflix")
    assert netflix["current_category_id"] == str(made.coffee.id)


@pytest.mark.parametrize("provider", list(PROVIDERS))
def test_every_provider_gives_a_second_opinion(
    admin_client: TestClient, made: Household, fake_ai: FakeAI, provider: str
) -> None:
    made.sorted_badly()
    configure(admin_client, provider)

    review = start(admin_client)

    assert review["status"] == "done"
    assert review["open"] == 3
    assert len(fake_ai.requests) == 1


@pytest.mark.parametrize("provider", list(PROVIDERS))
def test_no_account_information_reaches_any_provider_in_a_review(
    admin_client: TestClient, made: Household, fake_ai: FakeAI, provider: str
) -> None:
    made.sorted_badly()
    configure(admin_client, provider)

    start(admin_client)

    (seen,) = fake_ai.requests
    for secret in SECRETS:
        assert secret.lower() not in seen.body.lower(), (provider, secret)


def test_a_review_sends_the_categories_and_each_transactions_scrubbed_payee_and_category(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    made.sorted_badly()
    configure(admin_client, "openai")

    start(admin_client)

    sent = json.loads(fake_ai.requests[0].body)
    system = sent["instructions"]
    assert "second opinion on how a household's transactions" in system
    assert "Food & drink (expense): Coffee; Groceries" in system
    assert "Transfers (transfer): Credit card payments" in system
    assert "Income (income): Paycheck" in system
    lines = [line for line in system.splitlines() if line.startswith("t") and " | " in line]
    # The uncategorized ones first, then the rest, the newest of each first.
    assert lines == [
        "t1 | 2026-09-18 | Starbucks # | -4.50 USD | currently: (none)",
        "t2 | 2026-09-18 | Venmo | -40.00 USD | currently: (none)",
        "t3 | 2026-09-18 | Payment to [account] card ending in [account] from [account] "
        "| -300.00 USD | currently: Credit card payments",
        "t4 | 2026-09-18 | Whole Foods | -84.12 USD | currently: Groceries",
        "t5 | 2026-09-18 | Netflix | -15.49 USD | currently: Coffee",
    ]
    # The model can't be asked to do more than suggest.
    assert "tools" not in sent
    assert sent["store"] is False


def test_the_uncategorized_ones_come_first(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    made.sorted_badly()
    configure(admin_client)

    start(admin_client)

    lines = [
        line
        for line in json.loads(fake_ai.requests[0].body)["instructions"].splitlines()
        if line.startswith("t") and " | " in line
    ]
    assert [line.split(" | ")[2] for line in lines[:2]] == ["Starbucks #", "Venmo"]


def test_a_category_someone_chose_is_never_reviewed(
    admin_client: TestClient, made: Household, fake_ai: FakeAI, session: Session
) -> None:
    items = made.sorted_badly()
    items["venmo"].category_chosen = True
    session.commit()
    configure(admin_client)

    review = start(admin_client)

    assert review["total"] == 4
    assert "Venmo" not in payees(suggestions(admin_client))
    assert "Venmo" not in fake_ai.requests[0].body


def test_the_uncategorized_scope_looks_only_at_those(
    admin_client: TestClient, made: Household
) -> None:
    made.sorted_badly()
    configure(admin_client)

    review = start(admin_client, scope="uncategorized")

    assert review["total"] == 2
    assert set(payees(suggestions(admin_client))) == {"Venmo", "Starbucks 12345"}


@pytest.mark.parametrize(("days", "total"), [(30, 5), (60, 6)])
def test_the_recent_scope_counts_back_the_days_asked_for(
    admin_client: TestClient, made: Household, days: int, total: int
) -> None:
    made.sorted_badly()
    made.transaction("Old Venmo", "-5.00", date=TODAY - dt.timedelta(days=40))
    configure(admin_client)

    assert start(admin_client, days=days)["total"] == total


def test_a_review_looks_at_no_more_than_the_limit(
    admin_client: TestClient, made: Household
) -> None:
    made.sorted_badly()
    configure(admin_client)

    assert start(admin_client, limit=5)["total"] == 5
    assert start(admin_client, limit=5, scope="uncategorized")["total"] == 0


def test_a_review_with_nothing_to_look_at_is_finished_and_asks_nothing(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    configure(admin_client)

    review = start(admin_client)

    assert (review["status"], review["total"], review["reviewed"]) == ("done", 0, 0)
    assert review["finished_at"]
    assert fake_ai.requests == []


def test_a_long_list_goes_in_batches_and_the_review_counts_them(
    admin_client: TestClient, made: Household, fake_ai: FakeAI, session: Session
) -> None:
    for number in range(45):
        made.transaction(f"Venmo {number}", "-1.00", date=TODAY)
    configure(admin_client)

    review = start(admin_client, limit=200)

    assert (review["total"], review["reviewed"], review["open"]) == (45, 45, 45)
    assert len(fake_ai.requests) == 2
    sizes = [
        sum(
            1
            for line in json.loads(seen.body)["instructions"].splitlines()
            if " | currently:" in line
        )
        for seen in fake_ai.requests
    ]
    assert sizes == [40, 5]


def test_a_transaction_with_a_suggestion_waiting_isnt_reviewed_again(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    made.sorted_badly()
    configure(admin_client)
    start(admin_client)
    fake_ai.reset()

    second = start(admin_client)

    assert second["total"] == 2
    assert second["open"] == 0
    assert "Venmo" not in fake_ai.requests[0].body
    assert suggestions(admin_client)["total"] == 3


def test_a_suggestion_turned_down_isnt_made_again(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    made.sorted_badly()
    configure(admin_client)
    start(admin_client)
    ids = [item["id"] for item in suggestions(admin_client)["items"]]
    assert (
        admin_client.post("/api/ai/recommendations/dismiss", json={"ids": ids}).status_code == 200
    )

    again = start(admin_client)

    # They're asked about again, since nothing is waiting, and the same answers are dropped.
    assert again["total"] == 5
    assert again["open"] == 0
    assert suggestions(admin_client)["total"] == 0
    assert suggestions(admin_client, status="dismissed")["total"] == 3


def test_a_review_is_counted_in_the_usage_with_its_tokens_and_cost(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    made.sorted_badly()
    configure(admin_client, "anthropic")

    review = start(admin_client)

    (usage,) = session.scalars(select(AIUsage)).all()
    assert (usage.provider, usage.model, usage.purpose) == (
        "anthropic",
        "claude-sonnet-5-5",
        "review",
    )
    assert str(usage.review_id) == review["id"]
    assert usage.input_tokens > 0
    assert usage.output_tokens > 0
    assert usage.cost_micros is not None
    assert usage.cost_micros > 0


def test_the_review_can_be_read_again_and_listed(admin_client: TestClient, made: Household) -> None:
    made.sorted_badly()
    configure(admin_client)
    first = start(admin_client)
    second = start(admin_client)

    assert admin_client.get(f"/api/ai/reviews/{first['id']}").json() == first
    listed = admin_client.get("/api/ai/reviews").json()
    assert [item["id"] for item in listed] == [second["id"], first["id"]]
    assert listed[0]["created_by"] == "Alex Rivera"


def test_a_review_that_doesnt_exist_isnt_found(admin_client: TestClient) -> None:
    response = admin_client.get(f"/api/ai/reviews/{uuid.uuid4()}")

    assert response.status_code == 404
    assert error(response) == "not_found"


def test_a_review_cant_start_until_ai_is_set_up(admin_client: TestClient) -> None:
    response = admin_client.post("/api/ai/reviews", json={})

    assert response.status_code == 409
    assert error(response) == errors.NOT_CONFIGURED


@pytest.mark.parametrize(
    "body",
    [
        {"scope": "everything"},
        {"days": 0},
        {"days": 366},
        {"limit": 4},
        {"limit": 201},
        {"model": "gpt-6-astra"},
        {"today": "2200-01-01"},
    ],
)
def test_a_review_that_makes_no_sense_is_refused(
    admin_client: TestClient, made: Household, body: dict[str, Any]
) -> None:
    configure(admin_client)

    assert admin_client.post("/api/ai/reviews", json=body).status_code == 422


# ---- When it goes wrong ----------------------------------------------------------------------


def only_review(session: Session) -> AIReview:
    session.expire_all()
    return session.scalars(select(AIReview)).one()


def test_an_answer_that_cant_be_read_fails_the_review_and_suggests_nothing(
    admin_client: TestClient, made: Household, fake_ai: FakeAI, session: Session
) -> None:
    made.sorted_badly()
    configure(admin_client)
    fake_ai.say = "I would rather talk about the weather."

    review = start(admin_client)

    assert review["status"] == "failed"
    assert review["error"] == "The AI's answer couldn't be read, so nothing was suggested."
    assert review["reviewed"] == 0
    assert suggestions(admin_client)["total"] == 0
    # What it cost is still counted.
    assert session.scalar(select(func.count()).select_from(AIUsage)) == 1


def test_a_key_the_provider_turns_down_fails_the_review_without_repeating_it(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    made.sorted_badly()
    configure(admin_client, "openai", api_key="revoked-key-not-valid")

    review = start(admin_client)

    assert review["status"] == "failed"
    assert "didn't accept the key" in review["error"]
    assert "revoked" not in review["error"]
    assert not fake_ai.requests[0].authorized


def test_a_request_that_would_send_account_information_fails_the_review_and_sends_nothing(
    admin_client: TestClient,
    made: Household,
    fake_ai: FakeAI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    made.sorted_badly()
    configure(admin_client)
    monkeypatch.setattr("app.ai.reviews._line", leaky)

    review = start(admin_client)

    assert review["status"] == "failed"
    assert "sent nothing" in review["error"]
    assert "an account or bank name" in review["error"]
    assert fake_ai.requests == []


def leaky(*_args: object, **_kwargs: object) -> str:
    return "t1 | 2026-09-18 | paid Tartan Bank | -1.00 USD | currently: (none)"


def test_ai_turned_off_before_the_review_runs_stops_it(
    admin_client: TestClient, made: Household, session: Session, settings: Any
) -> None:
    items = made.sorted_badly()
    configure(admin_client)
    admin_client.delete("/api/ai/settings")
    user = session.scalars(select(User)).one()
    review = reviews.create(
        session,
        AIConfig(Connection(AIProvider.OPENAI, None, "x" * 20), "gpt-6-luna"),
        source=ReviewSource.MANUAL,
        user=user,
        ids=[item.id for item in items.values()],
    )

    ids = [item.id for item in items.values()]
    reviews.run(lambda: nullcontext(session), settings, None, review.id, ids)

    after = only_review(session)
    assert after.status == ReviewStatus.FAILED
    assert after.error == "AI isn't set up anymore, so the review stopped."


def test_something_unexpected_fails_the_review_rather_than_leaving_it_running(
    admin_client: TestClient,
    made: Household,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    made.sorted_badly()
    configure(admin_client)

    def broken(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("the database went away")

    monkeypatch.setattr("app.ai.reviews._review", broken)

    review = start(admin_client)

    assert review["status"] == "failed"
    assert review["error"] == "Something went wrong while reviewing. Nothing was changed."
    assert "An AI review failed" in caplog.text
    # What was reviewed isn't in the log.
    assert "Venmo" not in caplog.text


def test_an_import_that_added_nothing_for_the_ai_to_look_at_isnt_reviewed(
    admin_client: TestClient, made: Household, session: Session, settings: Any, admin: User
) -> None:
    configure(admin_client)

    assert reviews.for_import(session, settings, admin, uuid.uuid4()) is None
    assert session.scalars(select(AIReview)).all() == []


def test_transactions_that_were_chosen_or_removed_before_the_review_gets_to_them_are_skipped(
    admin_client: TestClient,
    made: Household,
    fake_ai: FakeAI,
    session: Session,
    settings: Any,
    admin: User,
) -> None:
    chosen = made.transaction("Venmo", "-40.00", date=TODAY)
    configure(admin_client)
    review = reviews.create(
        session,
        AIConfig(Connection(AIProvider.OPENAI, None, "x" * 20), "gpt-6-luna"),
        source=ReviewSource.MANUAL,
        user=admin,
        ids=[chosen.id, uuid.uuid4()],
    )
    chosen.category_chosen = True
    session.commit()

    reviews.run(lambda: nullcontext(session), settings, None, review.id, [chosen.id, uuid.uuid4()])

    after = only_review(session)
    assert (after.status, after.reviewed) == (ReviewStatus.DONE, 2)
    assert fake_ai.requests == []


def test_a_review_that_has_run_or_is_gone_isnt_run_again(
    admin_client: TestClient, made: Household, fake_ai: FakeAI, session: Session, settings: Any
) -> None:
    made.sorted_badly()
    configure(admin_client)
    review = start(admin_client)
    fake_ai.reset()

    reviews.run(
        lambda: nullcontext(session), settings, None, uuid.UUID(review["id"]), [uuid.uuid4()]
    )
    reviews.run(lambda: nullcontext(session), settings, None, uuid.uuid4(), [uuid.uuid4()])

    assert fake_ai.requests == []


def test_a_review_left_running_by_a_restart_is_marked_as_failed(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    configure(admin_client)
    stuck = AIReview(
        source=ReviewSource.MANUAL,
        status=ReviewStatus.RUNNING,
        provider=AIProvider.OPENAI,
        model="gpt-6-luna",
        total=10,
        created_at=utcnow() - dt.timedelta(hours=1),
    )
    fresh = AIReview(
        source=ReviewSource.MANUAL,
        status=ReviewStatus.RUNNING,
        provider=AIProvider.OPENAI,
        model="gpt-6-luna",
        total=10,
    )
    session.add_all([stuck, fresh])
    session.commit()

    listed = {item["id"]: item for item in admin_client.get("/api/ai/reviews").json()}

    assert listed[str(stuck.id)]["status"] == "failed"
    assert listed[str(stuck.id)]["error"] == "Cashcove restarted before this finished."
    assert listed[str(fresh.id)]["status"] == "running"


# ---- Reading an answer -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"suggestions": []}', []),
        ('{"suggestions":[{"id":"t1","category":"Coffee","confidence":"high"}]}', 1),
        ('```json\n{"suggestions":[{"id":"t1","category":"Coffee"}]}\n```', 1),
        ('Sure! {"suggestions":[{"id":"t1","category":"Coffee"}]} Hope that helps.', 1),
        ('[{"id":"t1","category":"Coffee"},{"id":"t2","category":"Groceries"}]', 2),
        ('{"suggestions":[{"id":"t1","category":null}]}', 1),
        ('{"suggestions":[{"id":"t1"}], "extra": true}', 1),
        ('{"other": 1}', 0),
    ],
)
def test_the_suggestions_in_an_answer_are_found_however_its_dressed(
    text: str, expected: int | list[Any]
) -> None:
    assert len(_parse(text)) == (expected if isinstance(expected, int) else len(expected))


@pytest.mark.parametrize(
    "text",
    [
        "",
        "no json here",
        "{broken",
        '{"suggestions": "none"}',
        '{"suggestions":[{"category":"x"}]}',
        "[1, 2]",
    ],
)
def test_an_answer_that_isnt_suggestions_cant_be_read(text: str) -> None:
    with pytest.raises(AIError) as caught:
        _parse(text)

    assert caught.value.code == errors.UNREADABLE


@pytest.mark.parametrize(
    ("said", "expected"),
    [
        ("high", "high"),
        ("HIGH", "high"),
        ("Medium", "medium"),
        ("low", "low"),
        ("certain", "low"),
        (5, "low"),
        (None, "low"),
    ],
)
def test_a_confidence_worded_some_other_way_counts_as_the_least(said: Any, expected: str) -> None:
    (item,) = _parse(json.dumps({"suggestions": [{"id": "t1", "confidence": said}]}))

    assert item.confidence == Confidence(expected)


def test_fields_that_arent_text_count_as_nothing() -> None:
    (item,) = _parse(
        json.dumps(
            {"suggestions": [{"id": "t1", "category": 5, "reason": ["x"], "confidence": "high"}]}
        )
    )

    assert (item.category, item.reason) == ("", "")


def test_suggestions_that_dont_hold_up_are_dropped(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    made.sorted_badly()
    configure(admin_client)
    # t1 is Starbucks, t2 Venmo, t3 the card payment, t4 Whole Foods and t5 Netflix.
    fake_ai.say = json.dumps(
        {
            "suggestions": [
                # Good, whatever the case and spacing of the category, and how it's worded.
                {
                    "id": "t2",
                    "category": "gifts   & DONATIONS",
                    "confidence": "HIGH",
                    "reason": "  A\npayment\napp. ",
                },
                # A transaction that isn't there, and a category that isn't.
                {"id": "t99", "category": "Coffee"},
                {"id": "t3", "category": "Piracy"},
                {"id": "t3", "category": None},
                # What it already has.
                {"id": "t4", "category": "Groceries"},
                # A second suggestion for the same transaction.
                {"id": "t2", "category": "Coffee"},
                # No reason or confidence given, and the id written another way.
                {"id": " T1 ", "category": "Coffee"},
            ]
        }
    )

    start(admin_client)

    page = suggestions(admin_client)
    assert payees(page) == {
        "Venmo": str(made.gifts.id),
        "Starbucks 12345": str(made.coffee.id),
    }
    by_payee = {item["payee"]: item for item in page["items"]}
    assert by_payee["Venmo"]["reason"] == "A payment app."
    assert by_payee["Venmo"]["confidence"] == "high"
    assert by_payee["Starbucks 12345"]["reason"] == "No reason was given."
    assert by_payee["Starbucks 12345"]["confidence"] == "low"


# ---- Applying and turning down -------------------------------------------------------------


def waiting(client: TestClient) -> dict[str, str]:
    return {item["payee"]: item["id"] for item in suggestions(client)["items"]}


def reviewed(client: TestClient, made: Household) -> dict[str, str]:
    made.sorted_badly()
    configure(client)
    start(client)
    return waiting(client)


def test_applying_gives_the_transaction_the_category_as_if_someone_chose_it(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    ids = reviewed(admin_client, made)

    response = admin_client.post("/api/ai/recommendations/apply", json={"ids": [ids["Venmo"]]})

    assert response.json() == {"changed": 1, "skipped": 0}
    session.expire_all()
    venmo = session.scalars(select(Transaction).where(Transaction.payee == "Venmo")).one()
    assert venmo.category_id == made.gifts.id
    # So automations keep it from now on.
    assert venmo.category_chosen is True
    assert suggestions(admin_client)["counts"] == {"open": 2, "applied": 1, "dismissed": 0}
    applied = suggestions(admin_client, status="applied")
    assert [item["payee"] for item in applied["items"]] == ["Venmo"]
    row = session.scalars(
        select(AIRecommendation).where(AIRecommendation.id == uuid.UUID(ids["Venmo"]))
    ).one()
    assert row.decided_at is not None
    assert row.decided_by_id is not None


def test_applying_several_at_once(admin_client: TestClient, made: Household) -> None:
    ids = reviewed(admin_client, made)

    response = admin_client.post("/api/ai/recommendations/apply", json={"ids": list(ids.values())})

    assert response.json() == {"changed": 3, "skipped": 0}
    assert suggestions(admin_client)["counts"] == {"open": 0, "applied": 3, "dismissed": 0}


def test_a_suggestion_cant_be_applied_twice(admin_client: TestClient, made: Household) -> None:
    ids = reviewed(admin_client, made)
    body = {"ids": [ids["Venmo"]]}
    admin_client.post("/api/ai/recommendations/apply", json=body)

    again = admin_client.post("/api/ai/recommendations/apply", json=body)

    assert again.json() == {"changed": 0, "skipped": 0}


def test_a_transaction_whose_category_has_changed_since_is_left_alone_and_the_suggestion_dismissed(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    ids = reviewed(admin_client, made)
    venmo = session.scalars(select(Transaction).where(Transaction.payee == "Venmo")).one()
    venmo.category_id = made.groceries.id
    session.commit()

    response = admin_client.post("/api/ai/recommendations/apply", json={"ids": [ids["Venmo"]]})

    assert response.json() == {"changed": 0, "skipped": 1}
    session.expire_all()
    assert venmo.category_id == made.groceries.id
    assert suggestions(admin_client)["counts"] == {"open": 2, "applied": 0, "dismissed": 1}


def test_a_transaction_someone_chose_the_category_of_since_is_left_alone(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    ids = reviewed(admin_client, made)
    venmo = session.scalars(select(Transaction).where(Transaction.payee == "Venmo")).one()
    venmo.category_chosen = True
    session.commit()

    response = admin_client.post("/api/ai/recommendations/apply", json={"ids": [ids["Venmo"]]})

    assert response.json() == {"changed": 0, "skipped": 1}
    session.expire_all()
    assert venmo.category_id is None


def test_turning_a_suggestion_down_changes_nothing_else(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    ids = reviewed(admin_client, made)

    response = admin_client.post(
        "/api/ai/recommendations/dismiss", json={"ids": [ids["Venmo"], str(uuid.uuid4())]}
    )

    assert response.json() == {"changed": 1, "skipped": 1}
    assert suggestions(admin_client)["counts"] == {"open": 2, "applied": 0, "dismissed": 1}
    venmo = session.scalars(select(Transaction).where(Transaction.payee == "Venmo")).one()
    assert venmo.category_id is None
    assert venmo.category_chosen is False


def test_a_suggestion_already_decided_cant_be_dismissed(
    admin_client: TestClient, made: Household
) -> None:
    ids = reviewed(admin_client, made)
    admin_client.post("/api/ai/recommendations/apply", json={"ids": [ids["Venmo"]]})

    response = admin_client.post("/api/ai/recommendations/dismiss", json={"ids": [ids["Venmo"]]})

    assert response.json() == {"changed": 0, "skipped": 1}
    assert suggestions(admin_client)["counts"]["applied"] == 1


@pytest.mark.parametrize("path", ["apply", "dismiss"])
@pytest.mark.parametrize(
    "body",
    [
        {"ids": []},
        {"ids": ["not-an-id"]},
        {"ids": [str(uuid.uuid4())] * 201},
        {"ids": [str(uuid.uuid4())], "category_id": "x"},
        {},
    ],
)
def test_deciding_needs_a_list_of_suggestions_and_nothing_else(
    admin_client: TestClient, path: str, body: dict[str, Any]
) -> None:
    assert admin_client.post(f"/api/ai/recommendations/{path}", json=body).status_code == 422


def test_deleting_a_transaction_or_category_takes_its_suggestion_with_it(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    reviewed(admin_client, made)
    session.delete(session.scalars(select(Transaction).where(Transaction.payee == "Venmo")).one())
    session.delete(made.coffee)
    session.commit()

    # Venmo's went with its transaction and Starbucks' with its category. Netflix's stays,
    # no longer saying what it had.
    (left,) = suggestions(admin_client)["items"]
    assert left["payee"] == "Netflix"
    assert left["current_category_id"] is None


# ---- Reading the suggestions -------------------------------------------------------------------


def test_suggestions_come_a_page_at_a_time_with_the_newest_first(
    admin_client: TestClient, made: Household
) -> None:
    reviewed(admin_client, made)

    first = suggestions(admin_client, page_size=2)
    second = suggestions(admin_client, page_size=2, page=2)

    assert (first["total"], first["page"], first["page_size"]) == (3, 1, 2)
    assert len(first["items"]) == 2
    assert len(second["items"]) == 1
    assert not {item["id"] for item in first["items"]} & {item["id"] for item in second["items"]}


def test_suggestions_can_be_listed_for_one_review(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    made.sorted_badly()
    configure(admin_client)
    first = start(admin_client, scope="uncategorized")
    second = start(admin_client)

    assert suggestions(admin_client, review_id=first["id"])["total"] == 2
    assert suggestions(admin_client, review_id=second["id"])["total"] == 1
    assert suggestions(admin_client)["total"] == 3
    assert suggestions(admin_client, review_id=str(uuid.uuid4()))["total"] == 0


@pytest.mark.parametrize(
    "query",
    [{"status": "maybe"}, {"page": 0}, {"page_size": 201}, {"review_id": "x"}, {"color": "red"}],
)
def test_a_listing_that_makes_no_sense_is_refused(
    admin_client: TestClient, query: dict[str, Any]
) -> None:
    assert admin_client.get("/api/ai/recommendations", params=query).status_code == 422


def test_the_dashboard_says_how_many_suggestions_are_waiting(
    admin_client: TestClient, made: Household
) -> None:
    assert (
        admin_client.get("/api/dashboard", params={"today": TODAY_TEXT}).json()[
            "ai_recommendations"
        ]
        == 0
    )
    ids = reviewed(admin_client, made)
    admin_client.post("/api/ai/recommendations/apply", json={"ids": [ids["Venmo"]]})

    dashboard = admin_client.get("/api/dashboard", params={"today": TODAY_TEXT}).json()

    assert dashboard["ai_recommendations"] == 2


def test_viewers_cant_see_the_suggestions_or_decide(
    admin_client: TestClient, made: Household, viewer: User
) -> None:
    ids = reviewed(admin_client, made)
    sign_in(admin_client, viewer.email)

    assert error(admin_client.get("/api/ai/recommendations")) == "admin_only"
    response = admin_client.post("/api/ai/recommendations/apply", json={"ids": [ids["Venmo"]]})
    assert error(response) == "admin_only"


def test_viewers_are_not_told_what_is_waiting_on_the_ai_tab(
    admin_client: TestClient, made: Household, viewer: User
) -> None:
    reviewed(admin_client, made)
    params = {"today": TODAY_TEXT}
    assert admin_client.get("/api/dashboard", params=params).json()["ai_recommendations"] == 3

    sign_in(admin_client, viewer.email)

    assert admin_client.get("/api/dashboard", params=params).json()["ai_recommendations"] == 0


# ---- Importing a file ---------------------------------------------------------------------------

STATEMENT = """Date,Description,Amount,Balance,Transaction ID
09/01/2026,VENMO PAYMENT,-40.00,960.00,V1
09/02/2026,STARBUCKS STORE 5521,-4.50,955.50,V2
09/03/2026,WHOLE FOODS,-84.12,871.38,V3
"""


def import_statement(client: TestClient, made: Household, text: str = STATEMENT) -> dict[str, Any]:
    preview = previewed(client, text, account_id=str(made.checking.id))
    lines = [row["line"] for row in preview["rows"] if row["status"] == "new"]
    body = upload(
        text,
        options=preview["options"],
        profile_id=preview["profile_id"],
        account_id=str(made.checking.id),
        lines=lines,
        balance="keep",
    )
    response = client.post("/api/imports", json=body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def test_an_import_gets_a_second_opinion_on_what_automations_left(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    configure(admin_client, "anthropic")

    record = import_statement(admin_client, made)

    assert record["added"] == 3
    review = admin_client.get(f"/api/ai/reviews/{record['ai_review_id']}").json()
    assert (review["source"], review["status"], review["total"], review["reviewed"]) == (
        "import",
        "done",
        3,
        3,
    )
    assert review["import_id"] == record["id"]
    assert review["file_name"] == "statement.csv"
    page = suggestions(admin_client, review_id=record["ai_review_id"])
    assert sorted(item["payee"] for item in page["items"]) == [
        "STARBUCKS STORE 5521",
        "VENMO PAYMENT",
    ]
    assert review["open"] == 2
    # Only what the file added was looked at, and none of it gave anything away.
    (seen,) = fake_ai.requests
    for secret in SECRETS:
        assert secret.lower() not in seen.body.lower(), secret


def test_an_import_isnt_reviewed_when_that_is_turned_off(
    admin_client: TestClient, made: Household, fake_ai: FakeAI
) -> None:
    configure(admin_client, review_imports=False)

    record = import_statement(admin_client, made)

    assert record["ai_review_id"] is None
    assert fake_ai.requests == []
    assert admin_client.get("/api/ai/reviews").json() == []


def test_an_import_isnt_reviewed_before_ai_is_set_up(
    admin_client: TestClient, made: Household
) -> None:
    assert import_statement(admin_client, made)["ai_review_id"] is None


def test_an_import_isnt_reviewed_when_the_key_cant_be_read(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    configure(admin_client)
    session.scalars(select(AISettings)).one().api_key = "v1.sealed-with-another-secret"
    session.commit()

    assert import_statement(admin_client, made)["ai_review_id"] is None


def test_an_import_with_nothing_for_the_ai_to_look_at_isnt_reviewed(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    configure(admin_client)
    # Whoever imports has chosen no category for these, but a category someone chose is kept.
    record = import_statement(admin_client, made)
    for transaction in session.scalars(
        select(Transaction).where(Transaction.import_id == uuid.UUID(record["id"]))
    ):
        transaction.category_chosen = True
    session.commit()

    assert reviews.import_ids(session, uuid.UUID(record["id"])) == []


def test_undoing_an_import_takes_its_suggestions_with_it(
    admin_client: TestClient, made: Household
) -> None:
    configure(admin_client)
    record = import_statement(admin_client, made)
    assert suggestions(admin_client)["total"] == 2

    assert admin_client.delete(f"/api/imports/{record['id']}").status_code == 200

    assert suggestions(admin_client)["total"] == 0
    review = admin_client.get(f"/api/ai/reviews/{record['ai_review_id']}").json()
    assert review["import_id"] is None
    assert review["file_name"] is None


def test_the_automations_come_first_and_the_ai_only_second_guesses_them(
    admin_client: TestClient, made: Household, session: Session
) -> None:
    session.add(
        Automation(
            name="Venmo",
            payees=["VENMO PAYMENT"],
            category_id=made.gifts.id,
            apply_to=AutomationScope.ALL,
        )
    )
    session.commit()
    configure(admin_client)

    record = import_statement(admin_client, made)

    venmo = session.scalars(
        select(Transaction).where(
            Transaction.import_id == uuid.UUID(record["id"]), Transaction.payee == "VENMO PAYMENT"
        )
    ).one()
    # The automation sorted it, the AI agrees, and so there is nothing to suggest.
    assert venmo.category_id == made.gifts.id
    assert sorted(item["payee"] for item in suggestions(admin_client)["items"]) == [
        "STARBUCKS STORE 5521"
    ]
