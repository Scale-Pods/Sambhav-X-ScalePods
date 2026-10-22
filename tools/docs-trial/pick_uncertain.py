"""Pick the documents a cheaper model is not sure about (from data/phase0/<tag>/), write data/phase0/uncertain_<tag>.txt."""
import json, os, re, sys, glob
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "phase0"); tag = sys.argv[1]
KEY = re.compile(r"^(rate|qty|quantity|size|thickness|width|length|grade|po_date|date|direction|doc_kind|is_firm|po_number|document_number|total|net_amount|amount|line)", re.I)
DOUBT = re.compile(r"could be|may be|might|unclear|ambiguous|illegible|cannot|can't|not clear|misread|either|or \d|hard to read|uncertain|not legible|cut off|struck|overwritten|guess", re.I)
n = 0; rows = []
for p in sorted(glob.glob(f"{OUT}/{tag}/*.json")):
    d = json.load(open(p, encoding="utf-8")); x = d["result"]; f = d["file"]; why = []
    CERTAIN_NOT = ("our_proforma_invoice", "our_sales_invoice", "transport_receipt", "price_list_or_offer", "registration_or_certificate", "sent_mail_or_notice")
    if not x["is_firm_order"] and x["doc_kind"] not in CERTAIN_NOT: why.append("not firm")
    if x["direction"] == "unclear" and x["doc_kind"] not in CERTAIN_NOT: why.append("direction unclear")
    if not x["readable"]: why.append("unreadable")
    if x["is_firm_order"] and x["doc_kind"] not in ("our_proforma_invoice",):
        for i, l in enumerate(x["lines"], 1):
            miss = [k for k in ("rate", "qty") if not l[k]]
            if miss: why.append(f"line{i} missing {'/'.join(miss)}")
            try:
                r = float(re.sub(r"[^0-9.]", "", l["rate"] or "") or 0)
            except ValueError:
                r = 0
            if r and l["rate_unit"] == "per_kg" and not (60 <= r <= 600): why.append(f"line{i} rate {r} out of band")
        if not x["po_date"] and x["doc_kind"] not in ("chat_order", "email_order", "typed_order_note"): why.append("no date")
    for u in x["uncertain"]:
        if KEY.match(u.strip()) and DOUBT.search(u): why.append("flag: " + u[:60]); break
    if why:
        rows.append((f, why))
open(f"{OUT}/uncertain_{tag}.txt", "w", encoding="utf-8").write("\n".join(f for f, _ in rows))
print(len(rows), "uncertain of", len(glob.glob(f"{OUT}/{tag}/*.json")))
for f, w in rows: print(f[:38].ljust(38), "; ".join(w)[:110])
