"""A pretend TallyPrime for testing the connector without the office PC (test tool only, nothing here talks to a real Tally).
  python mock_tally.py --port 19001 --accept dd-MMM-yyyy --masters <folder with ledgers.xml, stockitems.xml> --company "ZZ TEST"
It answers like Tally does: masters from saved files, a small set of made-up vouchers, and - like the real one we met - it ignores
a date it cannot read and answers with its default day.
"""
import argparse, datetime as dt, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=19001)
ap.add_argument("--accept", default="dd-MMM-yyyy", help="the only date format it understands (yyyyMMdd, d-MMM-yyyy, dd-MM-yyyy, dd-MMM-yyyy, dd/MM/yyyy); prefix 'typed ' to require TYPE=\"Date\"")
ap.add_argument("--masters", required=True)
ap.add_argument("--company", default="ZZ SCALEPODS CONNECTOR TEST")
ap.add_argument("--default-day", default="2026-10-31", help="the day Tally answers with when it cannot read the dates asked for")
a = ap.parse_args()

PATTERNS = {"yyyyMMdd": r"^\d{8}$", "d-MMM-yyyy": r"^\d{1,2}-[A-Za-z]{3}-\d{4}$", "dd-MM-yyyy": r"^\d{2}-\d{2}-\d{4}$",
            "dd-MMM-yyyy": r"^\d{2}-[A-Za-z]{3}-\d{4}$", "dd/MM/yyyy": r"^\d{2}/\d{2}/\d{4}$"}
FMT = {"yyyyMMdd": "%Y%m%d", "d-MMM-yyyy": "%d-%b-%Y", "dd-MM-yyyy": "%d-%m-%Y", "dd-MMM-yyyy": "%d-%b-%Y", "dd/MM/yyyy": "%d/%m/%Y"}
typed = a.accept.startswith("typed ")
fmt_name = a.accept.replace("typed ", "")


def read(name):
    return open(f"{a.masters}/{name}", encoding="utf-8", errors="ignore").read()


def parse_date(s):
    return dt.datetime.strptime(s, FMT[fmt_name]).date()


def voucher(day, kind, n):
    d = day.strftime("%Y%m%d")
    guid = f"test-{d}-{kind}-{n}"
    head = (f'<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="{guid}" VCHTYPE="{kind}" ACTION="Create"><OLDAUDITENTRYIDS.LIST TYPE="Number"><OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS></OLDAUDITENTRYIDS.LIST>'
            f'<DATE>{d}</DATE><GUID>{guid}</GUID><VOUCHERTYPENAME>{kind}</VOUCHERTYPENAME><VOUCHERNUMBER>{kind[:2].upper()}/{d[4:]}/{n}</VOUCHERNUMBER>'
            f'<CSTFORMISSUETYPE>&#4; Not Applicable</CSTFORMISSUETYPE><ENTEREDBY>test</ENTEREDBY><ALTERID>{100 + n}</ALTERID><ISCANCELLED>{"Yes" if n == 9 else "No"}</ISCANCELLED>')
    if kind == "Sales":
        return head + (
            '<PARTYLEDGERNAME>TEST CUSTOMER A</PARTYLEDGERNAME><NARRATION>Plates as per PO 77, vehicle MH04 AB 1234</NARRATION><REFERENCE>PO77</REFERENCE><IRN>a1b2c3</IRN>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>TEST CUSTOMER A</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-295000.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST OUTPUT</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>45000.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
            '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>16MO3 PLATE-72085110</STOCKITEMNAME><RATE>125.00/Kgs</RATE><AMOUNT>250000.00</AMOUNT><ACTUALQTY> 2000.000 Kgs</ACTUALQTY><BILLEDQTY> 2000.000 Kgs</BILLEDQTY>'
            '<BASICUSERDESCRIPTION.LIST><BASICUSERDESCRIPTION>Heat 12345 / Plate 678</BASICUSERDESCRIPTION><BASICUSERDESCRIPTION>10 x 1250 x 6300</BASICUSERDESCRIPTION></BASICUSERDESCRIPTION.LIST>'
            '<BATCHALLOCATIONS.LIST><GODOWNNAME>Kalamboli</GODOWNNAME><BATCHNAME>HT-12345</BATCHNAME><AMOUNT>250000.00</AMOUNT></BATCHALLOCATIONS.LIST>'
            '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>SALES - ALLOY PLATES</LEDGERNAME><AMOUNT>250000.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>'
            '</VOUCHER></TALLYMESSAGE>')
    if kind == "Purchase":
        return head + ('<PARTYLEDGERNAME>TEST MILL</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>TEST MILL</LEDGERNAME><AMOUNT>118000.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
                       '<ALLLEDGERENTRIES.LIST><LEDGERNAME>PURCHASE - PLATES</LEDGERNAME><AMOUNT>-100000.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
                       '<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST INPUT</LEDGERNAME><AMOUNT>-18000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>')
    return head + ('<PARTYLEDGERNAME>TEST CUSTOMER A</PARTYLEDGERNAME><NARRATION>Cheque 556</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC BANK</LEDGERNAME><AMOUNT>-50000.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
                   '<ALLLEDGERENTRIES.LIST><LEDGERNAME>TEST CUSTOMER A</LEDGERNAME><AMOUNT>50000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>')


def daybook(a_day, b_day):
    msgs = []
    d = a_day
    while d <= b_day:
        if d.weekday() < 6:
            msgs.append(voucher(d, "Sales", 1)); msgs.append(voucher(d, "Receipt", 2))
            if d.day % 3 == 0: msgs.append(voucher(d, "Purchase", 3))
            if d.day == 15: msgs.append(voucher(d, "Sales", 9))  # a cancelled one
        d += dt.timedelta(days=1)
    return ('<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>' + a.company +
            '</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA>' + "".join(msgs) + '</DATA></BODY></ENVELOPE>')


BILLS = ('<ENVELOPE><BILLFIXED><BILLDATE>9-Apr-26</BILLDATE><BILLREF>SA/0409/1</BILLREF><BILLPARTY>TEST CUSTOMER A</BILLPARTY></BILLFIXED>'
         '<BILLCL>-125000.00</BILLCL><BILLDUE>9-May-26</BILLDUE><BILLOVERDUE>168</BILLOVERDUE>'
         '<BILLFIXED><BILLDATE>2-Jun-26</BILLDATE><BILLREF>SA/0602/4</BILLREF><BILLPARTY>TEST CUSTOMER B</BILLPARTY></BILLFIXED>'
         '<BILLCL>-40250.50</BILLCL><BILLDUE>2-Jul-26</BILLDUE><BILLOVERDUE>114</BILLOVERDUE></ENVELOPE>')


class H(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"<RESPONSE>TallyPrime Server is Running</RESPONSE>")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", "ignore")
        if "List of Companies" in body:
            out = f'<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="{a.company}" RESERVEDNAME=""><NAME TYPE="String">{a.company}</NAME></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>'
        elif "ScalePodsLedgers" in body:
            out = read("ledgers.xml")
        elif "ScalePodsItems" in body:
            out = read("stockitems.xml")
        elif "Bills Receivable" in body or "Bills Payable" in body:
            out = BILLS
        elif "Day Book" in body:
            f = re.search(r"<SVFROMDATE([^>]*)>([^<]*)</SVFROMDATE>", body); t = re.search(r"<SVTODATE([^>]*)>([^<]*)</SVTODATE>", body)
            ok = bool(f and t and re.match(PATTERNS[fmt_name], f.group(2)) and re.match(PATTERNS[fmt_name], t.group(2)) and (("TYPE" in f.group(1)) == typed))
            if ok:
                out = daybook(parse_date(f.group(2)), parse_date(t.group(2)))
            else:  # what the real one did: ignore the dates, answer with its default day
                dd = dt.date.fromisoformat(a.default_day)
                out = daybook(dd, dd).replace("Sales", "Journal").replace("Receipt", "Journal")
        else:
            out = "<ENVELOPE><RESPONSE>Unknown request</RESPONSE></ENVELOPE>"
        data = out.encode("utf-8")
        self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)


print(f"mock Tally on :{a.port}, understands only {a.accept!r}, company {a.company!r}", flush=True)
ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
