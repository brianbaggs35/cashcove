"""Reading OFX files, and the QFX and QBO files Quicken and QuickBooks download, which are OFX
too.

OFX 1 is SGML, where values don't need closing tags (``<TRNAMT>-42.50``); OFX 2 is XML. Both
are read the same way, by their tags, without an XML parser, so nothing in a file can make
Cashcove fetch or expand anything.
"""

import html
import re
from collections.abc import Iterator
from dataclasses import dataclass, field

from app.imports.files import FileProblem, FileRow, Statement, payee_and_notes, settle
from app.imports.values import clean_text, parse_amount, parse_date
from app.models import AccountType
from app.schemas.imports import DecimalMark, ImportOptions, PayeeField

# A tag and the text after it, up to the next tag.
_TAG = re.compile(r"<(/?)([A-Za-z0-9.]+)>([^<]*)")
_ACCOUNT_TYPES = {
    "CHECKING": AccountType.CHECKING,
    "SAVINGS": AccountType.SAVINGS,
    "MONEYMRKT": AccountType.SAVINGS,
    "CD": AccountType.SAVINGS,
    "CREDITLINE": AccountType.LOAN,
}
_STATEMENTS = frozenset({"STMTRS", "CCSTMTRS"})
NO_TRANSACTIONS = "Cashcove couldn't find any transactions in this file."
INVESTMENTS = (
    "This file only has investment activity, which Cashcove can't import. Download a bank or "
    "card account's transactions instead."
)


@dataclass
class _Node:
    tag: str
    text: str = ""
    children: list["_Node"] = field(default_factory=list["_Node"])

    def all(self, tags: frozenset[str]) -> Iterator["_Node"]:
        """Everything inside it with one of these tags, in the order the file has them."""
        for child in self.children:
            if child.tag in tags:
                yield child
            yield from child.all(tags)

    def first(self, tag: str) -> "_Node | None":
        return next(self.all(frozenset({tag})), None)

    def value(self, tag: str) -> str:
        node = self.first(tag)
        return node.text if node else ""


def _tree(text: str) -> _Node:
    """The file's elements. A tag with a value right after it is a value; one without is a
    group of elements, which ends at its closing tag."""
    root = _Node("")
    stack = [root]
    for closing, name, content in _TAG.findall(text):
        tag = name.upper()
        if closing:
            # Closes the group and anything left open inside it. Closing tags of values, and
            # ones that don't match any open group, are ignored.
            depth = next(
                (depth for depth in range(len(stack) - 1, 0, -1) if stack[depth].tag == tag),
                None,
            )
            if depth is not None:
                del stack[depth:]
            continue
        node = _Node(tag, clean_text(html.unescape(content)))
        stack[-1].children.append(node)
        if not node.text:
            stack.append(node)
    return root


def _mask(account_id: str) -> str | None:
    characters = "".join(character for character in account_id if character.isalnum())
    return characters[-4:] if len(characters) >= 2 else None


def _row(line: int, node: _Node, options: ImportOptions) -> FileRow:
    number = node.value("CHECKNUM")
    name, notes = payee_and_notes(
        node.value("NAME"),
        node.value("MEMO"),
        f"Check {number}" if number else "",
        memo_first=options.payee_field == "memo",
    )
    row = FileRow(
        line=line,
        description=name[:255],
        memo=notes[:1000] or None,
        external_id=node.value("FITID")[:255] or None,
    )
    posted = node.value("DTPOSTED") or node.value("DTUSER")
    row.date = parse_date(posted[:8], "ymd") if posted[:8].isdigit() else None
    text = node.value("TRNAMT")
    # Some banks write a decimal comma.
    mark: DecimalMark = "," if "," in text and "." not in text else "."
    settle(row, posted, text, parse_amount(text, mark), flip=options.flip)
    return row


def _statement(node: _Node, institution: str | None, options: ImportOptions) -> Statement:
    card = node.tag == "CCSTMTRS"
    account = node.first("CCACCTFROM" if card else "BANKACCTFROM") or _Node("")
    balance = node.first("LEDGERBAL") or _Node("")
    closing = parse_amount(balance.value("BALAMT"))
    as_of = balance.value("DTASOF")[:8]
    return Statement(
        rows=[
            _row(line, transaction, options)
            for line, transaction in enumerate(node.all(frozenset({"STMTTRN"})), start=1)
        ],
        institution=institution,
        type=AccountType.CREDIT_CARD if card else _ACCOUNT_TYPES.get(account.value("ACCTTYPE")),
        mask=_mask(account.value("ACCTID")),
        currency=node.value("CURDEF")[:3].upper() or None,
        closing=closing,
        closing_date=parse_date(as_of, "ymd") if closing is not None and as_of else None,
    )


def payee_field(root: _Node) -> PayeeField:
    """Where the payees are. Some banks give every transaction one of a few names, like "POS
    PURCHASE", and put the merchant in the memo."""
    transactions = list(root.all(frozenset({"STMTTRN"})))
    names = {transaction.value("NAME").casefold() for transaction in transactions}
    memos = {transaction.value("MEMO").casefold() for transaction in transactions} - {""}
    few = len(transactions) >= 5 and len(names) <= max(2, len(transactions) // 5)
    return "memo" if few and len(memos) > 2 * len(names) else "name"


def read_ofx(text: str, options: ImportOptions | None) -> tuple[list[Statement], ImportOptions]:
    """Each account's statement in the file, and how it was read."""
    root = _tree(text)
    options = options or ImportOptions(payee_field=payee_field(root))
    institution = root.value("ORG")[:80] or None
    statements = [_statement(node, institution, options) for node in root.all(_STATEMENTS)]
    if not statements:
        raise FileProblem(INVESTMENTS if root.first("INVSTMTRS") else NO_TRANSACTIONS)
    return statements, options
