"""PDF statements for the tests, laid out the way banks lay out theirs: a fixed-width font, so
the spaces in a line keep its columns where they are."""

# The statements' lines are as wide as a page of columns is.
# ruff: noqa: E501

CHECKING = [
    "Harbor Credit Union                                       Statement Period 09/01/2026 - 09/30/2026",
    "ALEX RIVERA                                               Account Number: 000123-4410",
    "123 Main Street, Springfield IL 62701                     Customer Service 1-800-555-0100",
    "",
    "Account Activity",
    "Date    Description                                       Withdrawals      Deposits        Balance",
    "09/01   Beginning balance                                                                  2,875.00",
    "09/02   WHOLEFDS MKT #10234 AUSTIN TX                          84.12                      2,790.88",
    "09/05   ACME CORP PAYROLL PPD                                                 2,400.00     5,190.88",
    "09/07   ZELLE PAYMENT TO JOHN SMITH 4155551234                 50.00                      5,140.88",
    "09/12   NETFLIX.COM                                            15.49                      5,125.39",
    "09/15   ATM WITHDRAWAL                                         60.00                      5,065.39",
    "09/30   Ending balance                                                                     5,065.39",
]

CARD = [
    "Tartan Bank Rewards Visa                      Closing Date 09/26/2026",
    "ALEX RIVERA                                   Account ending in 3333",
    "",
    "Payments and Other Credits",
    "Date     Description                                           Amount",
    "09/10    AUTOPAY PAYMENT - THANK YOU                          -500.00",
    "",
    "Purchases",
    "Trans Date  Post Date  Description                              Amount",
    "09/20    09/21    DELTA AIR LINES                                486.20",
    "09/21    09/22    UBER TRIP                                       23.10",
]


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(*pages: list[str], font_size: int = 8) -> bytes:
    """A PDF with a page for each list of lines, drawn from the top left in Courier."""
    objects: list[bytes] = []
    # Object 1 is the catalog, 2 the page tree, 3 the font; each page is two more, its page and
    # its content.
    kids = " ".join(f"{4 + 2 * number} 0 R" for number in range(len(pages)))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    for number, lines in enumerate(pages):
        content = b"BT\n/F1 %d Tf\n%d TL\n36 760 Td\n" % (font_size, font_size + 3)
        content += b"".join(f"({_escape(line)}) Tj T*\n".encode("latin-1") for line in lines)
        content += b"ET"
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Contents {5 + 2 * number} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
            ).encode()
        )
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content))
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (index, body)
    start = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        start,
    )
    return bytes(out)
