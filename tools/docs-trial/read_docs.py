"""Phase 0 trial: read the sample order documents with a Claude model and save structured results.

Usage (from repo root):
  python tools/docs-trial/read_docs.py --model claude-haiku-5-5 --tag haiku --limit 1 --only PO_1030
  python tools/docs-trial/read_docs.py --model claude-haiku-5-5 --tag haiku

Reads ANTHROPIC_API_KEY from web/.env.local (never printed). Client documents stay in data/ (git-ignored).
Stops by itself when the running cost passes --budget (USD).
"""
import argparse, base64, hashlib, io, json, os, re, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic
import fitz  # PyMuPDF
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DOCS = os.path.join(ROOT, "data", "Sample Documents")
OUT = os.path.join(ROOT, "data", "phase0")

# USD per million tokens (input, output) - from the claude-api model table
PRICES = {"claude-haiku-5-5": (0.10, 0.50), "claude-sonnet-5-5": (2.00, 10.00)}


def load_key():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    for p in (os.path.join(ROOT, "web", ".env.local"), os.path.join(ROOT, ".env.local")):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                m = re.match(r"\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$", line)
                if m:
                    os.environ["ANTHROPIC_API_KEY"] = m.group(1).strip('"\'')
                    return
    sys.exit("ANTHROPIC_API_KEY not found in web/.env.local")


def S(desc=None):
    d = {"type": "string"}
    if desc:
        d["description"] = desc
    return d


# No nullable unions (the API limits them): every value is a plain string copied as shown; "" means not shown.
LINE = {
    "type": "object",
    "properties": {
        "description": S("item as written"),
        "grade": S(), "thickness_mm": S(), "width_mm": S(), "length_mm": S(),
        "qty": S("number as shown"),
        "qty_unit": {"type": "string", "enum": ["nos", "kg", "mt", "m", "m2", "other", "not_shown"]},
        "weight_kg": S(), "rate": S("number as shown"),
        "rate_unit": {"type": "string", "enum": ["per_kg", "per_mt", "per_nos", "per_m", "other", "not_shown"]},
        "amount": S(),
    },
    "required": ["description", "grade", "thickness_mm", "width_mm", "length_mm", "qty", "qty_unit", "weight_kg", "rate", "rate_unit", "amount"],
    "additionalProperties": False,
}

SCHEMA = {
    "type": "object",
    "properties": {
        "doc_kind": {"type": "string", "enum": [
            "purchase_order", "po_amendment", "typed_order_note", "chat_order", "handwritten_order",
            "broker_delivery_order", "email_order", "negotiation_not_final", "our_proforma_invoice",
            "our_sales_invoice", "transport_receipt", "price_list_or_offer", "registration_or_certificate",
            "sent_mail_or_notice", "other_not_an_order"]},
        "is_firm_order": {"type": "boolean"},
        "direction": {"type": "string", "enum": ["customer_orders_from_us", "we_buy_from_supplier", "our_own_document", "unclear"]},
        "seller_entity_named": S(), "buyer_name": S(), "buyer_gstin": S(), "po_number": S(),
        "document_number": S("the number printed on this document: PO / order / D.O. / proforma / SR / LR number; empty if none"),
        "po_date": S("YYYY-MM-DD or empty"), "currency": S(), "payment_terms": S(), "delivery_terms": S(),
        "net_amount": S("total before tax, as shown, or empty"),
        "tax_amount": S("total GST/IGST as shown, or empty"),
        "total_amount": S("final payable total including tax, as shown, or empty"),
        "lines": {"type": "array", "items": LINE},
        "readable": {"type": "boolean"},
        "uncertain": {"type": "array", "items": {"type": "string"},
                      "description": "every value you are not sure of, as 'field: why'"},
    },
    "required": ["doc_kind", "is_firm_order", "direction", "seller_entity_named", "buyer_name", "buyer_gstin",
                 "po_number", "document_number", "po_date", "currency", "payment_terms", "delivery_terms", "net_amount", "tax_amount", "total_amount", "lines",
                 "readable", "uncertain"],
    "additionalProperties": False,
}

SYSTEM = """You read documents for Sambhav Pipes & Fittings (SPF), a Mumbai steel trader. Related selling names: Sai Steel & Engineering Co, Sambhav Metal, RS (they appear as "Sambhav Steel", "Sambhav Pipe", "Sambhav Metal" etc. - all the seller side). They sell alloy steel plates (SA 387 Gr 11/12/22/5/91 Cl 1/2, 16Mo3, SA 516, S690QL), pipes, fittings, flanges and bolts.
Customers send orders as typed PDFs, scans, photos of printed POs, handwritten notes on their letterhead, WhatsApp or email screenshots. Some files are not orders.

Extract exactly what the document shows, using the picture itself. Rules:

1. Never guess. If a value is missing, unreadable or ambiguous, leave it empty ("" / not_shown) and add a line to `uncertain` ("field: reason"). Also list anything inconsistent (dates, arithmetic, units, struck-out text, cut-off edges, a digit you could read two ways).

2. Direction - decide it from who is ordering from whom:
   - customer_orders_from_us: a buyer orders from SPF/Sai/Sambhav. This includes any PO or order *addressed to* Sambhav/SPF/Sai (the customer is the buyer; SPF is the vendor/supplier/"issued to"), handwritten notes on a customer's letterhead addressed "To Sambhav", and WhatsApp messages passed on by "Mukesh Sir" or "Harshil Sir" (they forward customer orders; they are staff, not the buyer).
   - we_buy_from_supplier: SPF is the buyer and issues the order to a supplier (the PO is on SPF's letterhead, or says "SPF to <supplier>").
   - our_own_document: our proforma invoice, our sales invoice, our sent mail.
   - unclear: only when nothing in the picture tells you.

3. doc_kind and is_firm_order:
   - A customer's PO, amendment, email confirmation or order note is a firm order (is_firm_order=true), even if forwarded, unsigned or on plain paper. A forwarded WhatsApp message headed "Order", "Purchase Order", "PO", "We confirm PO" or "Order confirmation" with sizes and a rate is a firm order (chat_order).
   - A handwritten note headed "D.O." or "Order" on a customer's letterhead is a customer order (handwritten_order). broker_delivery_order is only for a printed slip by a broker/co-ordinator (e.g. Nalin Girish, Mehul Trivedi) with brokerage and rate per M/T.
   - Mark is_firm_order=false only for: price negotiations where the rate or terms are still being argued, our own proformas/invoices/mails, lorry receipts, rate cards/offers, registration certificates, and pure fragments with no order intent. If a PO is marked UNAPPROVED, draft or "waiting for approval", still mark it as an order but put the status in `uncertain`.
   - An order that lacks a price or quantity is still an order: set is_firm_order=true and list the gap in `uncertain`.

4. Dates as YYYY-MM-DD (Indian day/month/year). Use the date printed or written on the document. The file name often carries the date the photo or screenshot was taken (e.g. "2026-01-03"): a handwritten date should be consistent with it (same or slightly earlier); if your reading puts the year a year earlier than the file date, re-read the digits, and if still unsure keep what you see and flag it. WhatsApp bubbles show only a time: leave the date empty unless a date is visible. For an amendment use the amendment date in po_date and mention the original order date in `uncertain` or delivery_terms.

5. Numbers: copy as shown. Rates are per kg unless the document says per MT/tonne, per piece or per metre; record the unit shown. In Indian handwriting "148/-" means rupees 148 (the "/-" is a currency mark, not a digit): never read it as 1481 or 1487. Steel plate rates are normally between about 60 and 600 rupees per kg (per MT: 60,000-600,000). If a rate you read falls outside that, re-read the digits and flag it. Indian grouping 1,23,456.00 means 123456.00; some scans use dots, e.g. 2.33.145.00 means 233145.00.

6. Plate sizes are thickness x width x length in mm (6mm x 1250 x 6300). Write each dimension in its own field, one line item per size. If a size or quantity is written only once for several lines, repeat it on each line and flag that.

7. Totals: net_amount = before tax, tax_amount = GST/IGST total, total_amount = final payable including tax. Fill what the document shows; leave the others empty. Do not calculate.

8. document_number is the number printed on this document (PO no., order no., D.O. no., SR no., proforma no., LR no.). po_number is the customer's PO/order number only. For handwritten notes use a ref number only if written. Do not invent numbers, and never use the file name as a number.

9. Include every line item that is visible. For multi-page files you see only the first pages; read what is there and note if a page says "Page 1 of N"."""


def prep_image(im: Image.Image, maxside=1568):
    im = im.convert("RGB")
    im.thumbnail((maxside, maxside))
    b = io.BytesIO(); im.save(b, "JPEG", quality=85)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.standard_b64encode(b.getvalue()).decode()}}


def doc_blocks(path, max_pages=4):
    if path.lower().endswith(".pdf"):
        d = fitz.open(path)
        blocks = []
        for i, pg in enumerate(d):
            if i >= max_pages:
                break
            pix = pg.get_pixmap(dpi=110)
            blocks.append(prep_image(Image.frombytes("RGB", [pix.width, pix.height], pix.samples)))
        return blocks, len(d)
    return [prep_image(Image.open(path))], 1


def unique_files():
    seen, out = {}, []
    for f in sorted(os.listdir(DOCS)):
        h = hashlib.md5(open(os.path.join(DOCS, f), "rb").read()).hexdigest()
        if h in seen:
            continue
        seen[h] = f; out.append(f)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--only", help="file name prefix filter, e.g. PO_1030")
    ap.add_argument("--list", help="text file with one file name per line (only these)")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--budget", type=float, default=0.60, help="stop when cost exceeds this (USD)")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    load_key()
    client = anthropic.Anthropic(max_retries=3, timeout=180)
    pin, pout = PRICES[a.model]
    outdir = os.path.join(OUT, a.tag); os.makedirs(outdir, exist_ok=True)

    files = [f for f in unique_files() if not a.only or f.startswith(a.only)]
    if a.list:
        keep = set(open(a.list, encoding="utf-8").read().splitlines())
        files = [f for f in files if f in keep]
    if a.limit:
        files = files[:a.limit]
    lock = threading.Lock(); spent = {"usd": 0.0, "in": 0, "out": 0, "n": 0, "stop": False}

    def work(f):
        dest = os.path.join(outdir, f + ".json")
        if os.path.exists(dest):
            return f, "cached"
        if spent["stop"]:
            return f, "skipped (budget)"
        blocks, pages = doc_blocks(os.path.join(DOCS, f))
        note = f"File name: {f}. " + (f"PDF with {pages} pages; the first {len(blocks)} are shown." if pages > 1 else "")
        t = time.time()
        r = client.messages.create(
            model=a.model, max_tokens=8000, system=SYSTEM,
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": blocks + [{"type": "text", "text": note + "Extract the document."}]}],
        )
        text = next((b.text for b in r.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except Exception:
            data = {"_parse_error": text[:500]}
        u = r.usage
        usd = (u.input_tokens * pin + u.output_tokens * pout) / 1e6
        with lock:
            spent["usd"] += usd; spent["in"] += u.input_tokens; spent["out"] += u.output_tokens; spent["n"] += 1
            if spent["usd"] > a.budget:
                spent["stop"] = True
        json.dump({"file": f, "model": a.model, "stop_reason": r.stop_reason, "input_tokens": u.input_tokens,
                   "output_tokens": u.output_tokens, "usd": round(usd, 6), "seconds": round(time.time() - t, 1),
                   "result": data}, open(dest, "w", encoding="utf-8"), indent=1)
        return f, f"ok {u.input_tokens}in/{u.output_tokens}out ${usd:.5f}"

    with ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(work, f) for f in files]
        for fu in as_completed(futs):
            try:
                f, msg = fu.result()
            except Exception as e:
                f, msg = "?", f"ERROR {type(e).__name__}: {str(e)[:200]}"
            print(f[:60].ljust(60), msg, flush=True)
    print(f"\nDONE docs={spent['n']} in={spent['in']} out={spent['out']} cost=${spent['usd']:.4f}")


if __name__ == "__main__":
    main()
