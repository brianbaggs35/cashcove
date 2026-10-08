"""A stand-in for an AI that uses Cashcove's tools in the chat, for the end-to-end tests.

It answers by rules rather than by thinking, and in the JSON Cashcove asks for (see
app/ai/chat.py). It knows a few things people ask for:

- a subscription or a bill, "Create a new subscription for Netflix": it looks for the payments,
  proposes the subscription from the newest one (with the automation that links the rest, past
  and future), or, with none to go on, asks what it needs and offers the accounts by their codes;
  told the details, it proposes from those;
- "Put my Starbucks payments in Coffee": it looks for them and proposes an automation;
- "Raise my Groceries budget to $600" and "Create a Vacation budget of $200 a month";
- "Add a Pets category to Lifestyle";
- a proposal turned down with a reason, which it takes into account: "yearly" or "$17.99".

It reads the look-up results it was given, so the codes it uses are the ones Cashcove issued, and
it only ever sees what an AI is sent: account codes, never account names.
"""

import calendar
import datetime as dt
import json
import re
from typing import Any

CHAT = "You are the assistant inside Cashcove"
RESULTS = "Results of your look-ups"
PROBLEMS = "These changes couldn't be set up"
# What the app writes when the person turns a proposal down with a reason.
TURNED_DOWN = "I turned that down"

_KIND = re.compile(r"\b(subscription|bill)\b", re.IGNORECASE)
_SET_UP = re.compile(r"\b(?:create|add|set up|track|start|help me)\b", re.IGNORECASE)
_NAME = re.compile(
    r"(?:for|called|named)\s+(?:my |the |a |an )?([A-Z][\w&'.-]*(?:\s[A-Z][\w&'.-]*)*)"
)
_SORT = re.compile(
    r"\b(?:put|sort|categori[sz]e|classify)\b (?:all )?(?:of )?(?:my |the )?(.+?) "
    r"(?:payments|transactions|charges|purchases)\b.*?\b(?:in|as|into|to|under)\b (?:the )?"
    r"(.+?)(?: category)?[.?!]*$",
    re.IGNORECASE,
)
_BUDGET = re.compile(
    r"\b(raise|increase|lower|reduce|change|update|set)\b (?:my |the )?(.+?) budget\b.*?"
    r"\$?([\d,]+(?:\.\d\d)?)",
    re.IGNORECASE,
)
_NEW_BUDGET = re.compile(
    r"\b(?:create|add|new)\b (?:a |an |the )?(?:new )?(.+?) budget\b.*?\$([\d,]+(?:\.\d\d)?)"
    r"\s*(?:a |per |every |each )?(week|two weeks|month|year)?",
    re.IGNORECASE,
)
_CATEGORY = re.compile(
    r"\b(?:add|create|make)\b (?:a |an |the )?(?:new )?(.+?) category\b.*?\b(?:to|in|under)\b "
    r"(?:the )?(.+?)(?: group)?[.?!]*$",
    re.IGNORECASE,
)
_MONEY = re.compile(r"\$([\d,]+(?:\.\d\d)?)")
_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_ACCOUNT = re.compile(r"<ACCOUNT_[A-Za-z]{10}>")
_LEGEND = re.compile(r"^(<ACCOUNT_[A-Za-z]{10}>): ([\w ]+), [A-Z]{3}$", re.MULTILINE)
_TRANSACTION = re.compile(
    r"^(?P<code>T[a-z]{2}\d+) \| (?P<date>\d{4}-\d{2}-\d{2}) \| (?P<payee>.*?) \| "
    r"(?P<category>.*?) \| (?P<amount>[+-][\d,]+\.\d{2}) [A-Z]{3} \| (?P<account>\S+) \| "
    r"(?P<link>.*)$",
    re.MULTILINE,
)
_BUDGET_ROW = re.compile(r"^(?P<code>B[a-z]{2}\d+) \| (?P<name>.*?) \| \w+ \|", re.MULTILINE)
_FREQUENCIES = (
    ("biweekly", r"biweekly|every two weeks|every other week"),
    ("weekly", r"weekly|every week|a week"),
    ("quarterly", r"quarterly|every three months"),
    ("annual", r"yearly|annual|annually|every year|a year"),
    ("monthly", r"monthly|every month|a month|per month"),
)
_PERIODS = {"week": "weekly", "two weeks": "biweekly", "month": "monthly", "year": "yearly"}
_NO_CATEGORY = "(no category)"


def _json(say: str, *calls: tuple[str, dict[str, Any]]) -> str:
    return json.dumps({"say": say, "calls": [{"tool": tool, "args": args} for tool, args in calls]})


def _frequency(text: str) -> str | None:
    for name, pattern in _FREQUENCIES:
        if re.search(rf"\b(?:{pattern})\b", text, re.IGNORECASE):
            return name
    return None


def _after(day: dt.date, frequency: str) -> dt.date:
    """The day a payment made on `day` is next due."""
    if frequency in {"weekly", "biweekly"}:
        return day + dt.timedelta(days=7 if frequency == "weekly" else 14)
    months = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}[frequency]
    year, month = divmod(day.year * 12 + day.month - 1 + months, 12)
    last = calendar.monthrange(year, month + 1)[1]
    return dt.date(year, month + 1, min(day.day, last))


def _money(text: str) -> str | None:
    found = _MONEY.search(text)
    return found.group(1).replace(",", "") if found else None


def _said(turns: list[dict[str, str]]) -> list[str]:
    """What the person said, in order, leaving out what Cashcove added to the conversation."""
    return [
        turn["content"]
        for turn in turns
        if turn["role"] == "user" and not turn["content"].startswith((RESULTS, PROBLEMS))
    ]


def _accounts(system: str) -> dict[str, str]:
    """The accounts it was told about: each code and the kind of account it is."""
    return dict(_LEGEND.findall(system))


def _subscription(
    system: str, said: list[str], results: str | None, kind: str, name: str
) -> str | None:
    latest = said[-1]
    frequency, amount = _frequency(latest), _money(latest)
    known = list(_accounts(system))
    # Never a guess: with several accounts, which one is for the person to say.
    accounts = _ACCOUNT.findall(latest) or (known if len(known) == 1 else [])
    due = _DATE.search(latest)
    if amount and frequency and due and accounts:
        # Told everything it needs.
        return _json(
            f"I'll set up {name} as {frequency} at {amount}, next due {due.group(1)}.",
            (
                "create_recurring",
                {
                    "kind": kind,
                    "name": name,
                    "amount": amount,
                    "frequency": frequency,
                    "next_due": due.group(1),
                    "account": accounts[0],
                    "link_all": True,
                    "match_text": name.lower(),
                },
            ),
        )
    if results is None:
        return _json(
            f"Let me look for payments to {name}.",
            ("find_transactions", {"text": name.lower(), "direction": "out"}),
        )
    rows = list(_TRANSACTION.finditer(results))
    if not rows:
        legend = _accounts(system)
        options = " or ".join(f"{code} ({what})" for code, what in legend.items())
        question = f"Which account is it paid from: {options}?" if options else "Which account?"
        return _json(
            f"I couldn't find any payments to {name}. How much is {name}, how often is it "
            f"paid, when is the next payment, and {question[0].lower()}{question[1:]}"
        )
    newest = rows[0]
    howmuch = amount or newest["amount"].lstrip("+-").replace(",", "")
    how_often = frequency or "monthly"
    due_on = _after(dt.date.fromisoformat(newest["date"]), how_often)
    category = None if newest["category"] == _NO_CATEGORY else newest["category"]
    return _json(
        f"I found {len(rows)} payments to {name}, the latest on {newest['date']}. I'll set it up "
        f"as {how_often} at {howmuch}, next due {due_on}, and link every {name} payment, past "
        "and future, to it.",
        (
            "create_recurring",
            {
                "kind": kind,
                "name": name,
                "amount": howmuch,
                "frequency": how_often,
                "next_due": due_on.isoformat(),
                "category": category,
                "from_transaction": newest["code"],
                "link_all": True,
                "match_text": name.lower(),
            },
        ),
    )


def _sort(results: str | None, text: str, category: str) -> str:
    if results is None:
        return _json(
            f"Let me look for payments to {text}.", ("find_transactions", {"text": text.lower()})
        )
    count = len(list(_TRANSACTION.finditer(results)))
    if not count:
        return _json(f"I couldn't find any payments to {text}.")
    return _json(
        f"I found {count} payments to {text}. I'll put them all in {category}, and every one that "
        "comes later.",
        (
            "create_automation",
            {"text": text.lower(), "match": "contains", "category": category, "apply_to": "all"},
        ),
    )


def _change_budget(results: str | None, name: str, amount: str) -> str:
    if results is None:
        return _json("Let me look at your budgets.", ("list_budgets", {}))
    for row in _BUDGET_ROW.finditer(results):
        if row["name"].lower() == name.lower():
            return _json(
                f"I'll change {row['name']} to {amount} from this period.",
                ("change_budget", {"budget": row["code"], "amount": amount}),
            )
    return _json(f"I couldn't find a budget called {name}.")


def reply(system: str, turns: list[dict[str, str]]) -> str | None:
    """What the AI would answer in the chat, as JSON, to a request it knows; otherwise none."""
    said = _said(turns)
    if not system.startswith(CHAT) or not said:
        return None
    results = turns[-1]["content"] if turns[-1]["content"].startswith(RESULTS) else None
    asked = " ".join(said)
    first = said[0]
    category = _CATEGORY.search(first)
    if category:
        return _json(
            f"I'll add {category[1]} to {category[2]}.",
            ("create_category", {"name": category[1], "group": category[2]}),
        )
    fresh = _NEW_BUDGET.search(first)
    if fresh and not _BUDGET.search(first):
        period = _PERIODS.get((fresh[3] or "month").lower(), "monthly")
        return _json(
            f"I'll add a {period} budget called {fresh[1]} for {fresh[2]}.",
            (
                "create_budget",
                {"name": fresh[1], "period": period, "amount": fresh[2].replace(",", "")},
            ),
        )
    budget = _BUDGET.search(first)
    if budget:
        return _change_budget(results, budget[2], budget[3].replace(",", ""))
    sort = _SORT.search(first)
    if sort:
        return _sort(results, sort[1], sort[2])
    kind, name = _KIND.search(asked), _NAME.search(first)
    if kind and name and _SET_UP.search(first):
        return _subscription(system, said, results, kind[1].lower(), name[1])
    return None
