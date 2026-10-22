"""Compare a model's results (data/phase0/<tag>/) with the draft catalogue (data/phase0/catalog.csv).
The catalogue is Claude's own reading, so differences are 'to look at', not proof the model is wrong.
  python tools/docs-trial/score.py haiku
"""
import csv, json, os, re, sys, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "phase0")
tag = sys.argv[1]
like = set(os.listdir(os.path.join(OUT, sys.argv[2]))) if len(sys.argv) > 2 else None

NOT_FIRM = {"proforma_ours", "invoice_sales", "supporting_lr", "supporting_gst", "price_list", "offer_table",
            "sent_mail", "negotiation"}
UNSURE = {"fragment"}


def norm_po(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def num(s):
    s = re.sub(r"[^0-9.\-]", "", str(s or "").replace(",", ""))
    try:
        return float(s)
    except ValueError:
        return None


cat = {r["file"]: r for r in csv.DictReader(open(os.path.join(OUT, "catalog.csv"), encoding="utf-8"))}
rows = []
for f, r in cat.items():
    if r["duplicate_of"]:
        continue
    p = os.path.join(OUT, tag, f + ".json")
    if not os.path.exists(p) or (like is not None and f + ".json" not in like):
        continue
    d = json.load(open(p, encoding="utf-8"))
    x = d["result"]
    row = {"file": f, "medium": r["medium"], "cost": d["usd"], "secs": d["seconds"], "flags": len(x.get("uncertain", []))}
    if "_parse_error" in x:
        row["parse_error"] = True; rows.append(row); continue
    exp_firm = None if r["doc_type"] in UNSURE else (r["doc_type"] not in NOT_FIRM)
    row["firm_ok"] = None if exp_firm is None else (x["is_firm_order"] == exp_firm)
    row["dir_ok"] = (x["direction"] == "customer_orders_from_us") == (r["direction"] == "inbound") if r["direction"] in ("inbound", "outbound") else None
    if r["po_no"] and r["po_no"] not in ("-",):
        a = norm_po(r["po_no"])
        bs = [norm_po(x.get("po_number")), norm_po(x.get("document_number"))]
        row["po_ok"] = any(b and (a == b or a in b or b in a) for b in bs)
    else:
        row["po_ok"] = None
    row["date_ok"] = (x["po_date"] == r["po_date"] or (r["id"] == "1408" and x["po_date"] in ("2026-02-11", "2026-02-19"))) if r["po_date"] else None
    row["lines_ok"] = (len(x["lines"]) == int(r["lines"])) if r["lines"] != "" else None
    if r["total"] != "":
        ts = [num(x.get(k)) for k in ("total_amount", "net_amount")]; row["total_ok"] = any(t is not None and abs(t - float(r["total"])) < 1.0 for t in ts)
    else:
        row["total_ok"] = None
    row["wrong_firm"] = r["doc_type"], x["doc_kind"], x["is_firm_order"]
    row["exp"] = r; row["got"] = x
    rows.append(row)


def rate(k, subset=None):
    xs = [r[k] for r in rows if k in r and r[k] is not None and (subset is None or subset(r))]
    return f"{sum(xs)}/{len(xs)}" if xs else "-"


print(f"docs scored: {len(rows)}  cost ${sum(r['cost'] for r in rows):.4f}  avg {sum(r['secs'] for r in rows)/len(rows):.1f}s  parse errors: {sum(1 for r in rows if r.get('parse_error'))}")
print("\n%-14s %5s %9s %9s %9s %9s %9s %9s %6s" % ("medium", "n", "firm_ok", "dir_ok", "po_ok", "date_ok", "lines_ok", "total_ok", "flags"))
for m in sorted({r["medium"] for r in rows}) + [None]:
    sub = (lambda r, m=m: r["medium"] == m) if m else None
    n = sum(1 for r in rows if (m is None or r["medium"] == m))
    fl = sum(r["flags"] for r in rows if (m is None or r["medium"] == m)) / max(n, 1)
    print("%-14s %5d %9s %9s %9s %9s %9s %9s %6.1f" % (m or "ALL", n, rate("firm_ok", sub), rate("dir_ok", sub), rate("po_ok", sub), rate("date_ok", sub), rate("lines_ok", sub), rate("total_ok", sub), fl))

print("\n--- disagreements (catalogue vs model)")
for r in rows:
    if r.get("parse_error"):
        print(r["file"][:40], "PARSE ERROR"); continue
    bad = [k for k in ("firm_ok", "dir_ok", "po_ok", "date_ok", "lines_ok", "total_ok") if r.get(k) is False]
    if not bad:
        continue
    e, g = r["exp"], r["got"]
    out = []
    if "firm_ok" in bad: out.append(f"firm: cat={e['doc_type']} model={g['doc_kind']}/{g['is_firm_order']}")
    if "dir_ok" in bad: out.append(f"dir: cat={e['direction']} model={g['direction']}")
    if "po_ok" in bad: out.append(f"po: cat={e['po_no']!r} model={g['po_number']!r}")
    if "date_ok" in bad: out.append(f"date: cat={e['po_date']} model={g['po_date']!r}")
    if "lines_ok" in bad: out.append(f"lines: cat={e['lines']} model={len(g['lines'])}")
    if "total_ok" in bad: out.append(f"total: cat={e['total']} model={g['total_amount']!r}")
    print(r["file"][:34].ljust(34), " | ".join(out))
