"""Helpers for trying the AI's tools: a request's context, and the answers a model might give."""

import datetime as dt
import json
import re
from collections.abc import Callable
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.privacy import Protected
from app.ai.tools.base import Codes, Context, Prepared, category_names
from app.ai.tools.registry import CHANGE_BY_NAME, LOOK_BY_NAME
from app.ai.vault import Vault
from app.finance.budget import Household
from app.finance.periods import shift_months
from app.models import Account, PaymentFrequency, RecurringKind, Subscription, Transaction, User
from e2e.ai import Asked
from tests.finance import TODAY, add_transaction


def context(session: Session, user: User, today: dt.date = TODAY) -> Context:
    """What a tool has to work with, as in a request made by this admin."""
    return Context(
        db=session,
        user=user,
        protected=Protected.load(session),
        vault=Vault(),
        codes=Codes(),
        rates=None,
        today=today,
        currency=Household.load(session).currency,
        categories=category_names(session),
        new_categories={},
    )


def look(ctx: Context, tool: str, /, **args: Any) -> str:
    """What a look-up answers to these arguments."""
    found = LOOK_BY_NAME[tool]
    return found.run(ctx, found.args.model_validate(args))


def prepare(ctx: Context, tool: str, /, **args: Any) -> Prepared:
    """A change, checked and worded, as it would be kept in a proposal."""
    found = CHANGE_BY_NAME[tool]
    return found.prepare(ctx, found.args.model_validate(args))


def apply(session: Session, tool: str, prepared: Prepared) -> str:
    """Makes a prepared change the way approving it would, without committing."""
    return CHANGE_BY_NAME[tool].apply(session, prepared.step)


def say(words: str, *calls: tuple[str, dict[str, Any]]) -> str:
    """An answer a model gives: its words, and the tools it calls."""
    return json.dumps({"say": words, "calls": [{"tool": t, "args": a} for t, a in calls]})


def codes(text: str, letter: str) -> list[str]:
    """The codes for a kind of row (T, S or B) that a look-up result holds, in order."""
    return re.findall(rf"^({letter}[a-z]{{2}}\d+) \|", text, flags=re.MULTILINE)


def accounts_in(text: str) -> list[str]:
    """The account codes in some text, each once, in order."""
    return list(dict.fromkeys(re.findall(r"<ACCOUNT_[a-z]{10}>", text)))


def from_results(make: Callable[[Asked], str]) -> Callable[[Asked], str]:
    """A scripted answer that is worked out from what was sent, such as a look-up's codes."""
    return make


def payments(
    session: Session, account: Account, payee: str, amount: str, count: int, **fields: Any
) -> list[Transaction]:
    """`count` monthly payments, the newest on the 3rd of the month before TODAY's."""
    return [
        add_transaction(
            session,
            account,
            f"-{Decimal(amount)}",
            payee,
            date=shift_months(TODAY.replace(day=3), -(number + 1)),
            **fields,
        )
        for number in range(count)
    ]


def tracked(session: Session) -> list[Subscription]:
    return list(session.scalars(select(Subscription).order_by(Subscription.name)))


def add_item(session: Session, account_id: object, name: str, **fields: object) -> Subscription:
    item = Subscription(
        name=name,
        kind=fields.pop("kind", RecurringKind.SUBSCRIPTION),
        payee=fields.pop("payee", name),
        amount=Decimal(str(fields.pop("amount", "10.00"))),
        frequency=fields.pop("frequency", PaymentFrequency.MONTHLY),
        account_id=account_id,
        next_due_date=fields.pop("next_due_date", TODAY),
        **fields,
    )
    session.add(item)
    session.commit()
    return item
