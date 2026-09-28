"""Statement files for the import tests, laid out the way real banks lay out theirs."""

import base64
from typing import Any

from fastapi.testclient import TestClient

# A checking account's CSV export, with a running balance, oldest first.
CHECKING_CSV = """Date,Description,Amount,Balance,Transaction ID
09/01/2026,NORTHWIND HEALTH PAYROLL PPD,1875.00,2875.00,T1001
09/02/2026,WHOLEFDS MKT #10234 AUSTIN TX,-84.12,2790.88,T1002
09/03/2026,BLUE BOTTLE COFFEE,-4.50,2786.38,T1003
09/03/2026,BLUE BOTTLE COFFEE,-4.50,2781.88,T1004
09/05/2026,CITY POWER & LIGHT,-96.40,2685.48,T1005
"""

# A card's export, with charges as positive amounts and the bank's own categories.
CARD_CSV = """Date,Description,Amount,Category
09/20/2026,DELTA AIR LINES,486.20,Travel-Airline
09/21/2026,UBER TRIP,23.10,Transportation-Taxis & Rideshare
09/22/2026,AUTOPAY PAYMENT - THANK YOU,-500.00,Payment/Credit
09/23/2026,CORNER MARKET,12.00,Merchandise & Supplies-Groceries
"""

# Separate columns for money out and money in.
SPLIT_CSV = """Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-09-25,2026-09-26,1234,SHELL OIL 57444,Gas/Automotive,41.26,
2026-09-20,2026-09-20,1234,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,250.00
"""

# No column names, as Wells Fargo exports.
HEADERLESS_CSV = """"09/26/2026","-42.50","*","","WHOLEFDS MKT 10234 AUSTIN TX"
"09/25/2026","1875.00","*","","NORTHWIND HEALTH PAYROLL PPD"
"09/24/2026","-6.75","*","1043","CHECK # 1043"
"""

OFX = """OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260926120000<LANGUAGE>ENG<FI><ORG>Harbor Credit Union<FID>1234</FI></SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>121000358<ACCTID>000123-4410<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901<DTEND>20260926
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260925120000.000[-5:EST]<TRNAMT>-42.50<FITID>A1
<NAME>WHOLEFDS MKT &amp; CO<MEMO>AUSTIN TX</STMTTRN>
<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20260920<TRNAMT>-100,00<FITID>A2<CHECKNUM>1043
<NAME>CHECK 1043<MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260915<TRNAMT>2400.00<FITID>A3
<PAYEE><NAME>ACME CORP<ADDR1>1 Main St</PAYEE></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>2310.55<DTASOF>20260926</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

# OFX 2, which is XML, for a credit card.
CARD_OFX = """<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>usd</CURDEF>
<CCACCTFROM><ACCTID>4111111111113333</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260924</DTPOSTED><TRNAMT>-15.49</TRNAMT>
<FITID>C1</FITID><NAME>NETFLIX.COM</NAME><MEMO></MEMO></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-612.40</BALAMT><DTASOF>20260926</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>
"""

QIF = """!Account
NEveryday Checking
TBank
^
!Type:Bank
D09/25'26
T-42.50
PWHOLEFDS MKT
MAustin
LFood:Groceries
^
D9/20/2026
U-1,100.00
N1043
PParkside Apartments
L[Savings]
^
!Type:Cat
NGroceries
^
"""


def encoded(text: str | bytes) -> str:
    """A file's contents as the web app sends them."""
    data = text.encode() if isinstance(text, str) else text
    return base64.b64encode(data).decode()


def upload(text: str | bytes, file_name: str = "statement.csv", **fields: Any) -> dict[str, Any]:
    return {"file_name": file_name, "content": encoded(text), **fields}


def previewed(client: TestClient, text: str | bytes, **fields: Any) -> dict[str, Any]:
    response = client.post("/api/imports/preview", json=upload(text, **fields))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result
