"""Score the model's reads against what staff typed into the Dispatch FMS sheet (an independent answer key).
The sample file prefix (PO_1030...) is the order number in the sheet. Lines are matched by size (thickness x width x length).
  python tools/docs-trial/score_sheet.py haiku2 [sonnet]     # with a second tag, its result replaces the first for those files
Reads DATABASE_URL from .env.local. Read-only.
"""
import csv, json, os, re, sys, collections
import psycopg

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "phase0")
tags = sys.argv[1:]


def env(name):
    for p in (os.path.join(ROOT, ".env.local"), os.path.join(ROOT, "web", ".env.local")):
        for line in open(p, encoding="utf-8"):
            m = re.match(rf"\s*{name}\s*=\s*(.+?)\s*$", line)
            if m: return m.group(1).strip("\"'")
    sys.exit(f"{name} missing")


def num(s):
    t = re.sub(r"[^0-9.]", "", str(s or "").replace(",", ""))
    try: return float(t) if t else None
    except ValueError: return None


def size_key(t, w, l):
    a = [num(t), num(w), num(l)]
    return tuple(sorted(int(round(x)) for x in a)) if all(x for x in a) else None  # order-free: 6x1250x6300 == 1250x6300x6


def sheet_size(s):
    nums = re.findall(r"\d+(?:\.\d+)?", s or "")
    return tuple(sorted(int(round(float(n))) for n in nums[:3])) if len(nums) >= 3 else None


cat = {r["file"]: r for r in csv.DictReader(open(os.path.join(OUT, "catalog.csv"), encoding="utf-8"))}
conn = psycopg.connect(env("DATABASE_URL"))
orders = {r[0]: r for r in conn.execute("select order_no, client, po_no, order_date::text from public.v_orders").fetchall()}
sheet_lines = collections.defaultdict(list)
for r in conn.execute("select order_no, size, qty, rate, unit, grade from public.v_order_lines order by row_no").fetchall():
    sheet_lines[r[0]].append(r)

tot = collections.Counter(); bad = []
for f, c in cat.items():
    if c["duplicate_of"] or c["doc_type"] in ("proforma_ours", "invoice_sales", "supporting_lr", "supporting_gst", "price_list", "offer_table", "sent_mail", "negotiation", "fragment"):
        continue
    key = f[3:7]
    if key not in orders or key == "1049":  # 1049 is two different documents under one number
        continue
    res = None
    for t in tags:  # later tags win
        p = os.path.join(OUT, t, f + ".json")
        if os.path.exists(p): res = json.load(open(p, encoding="utf-8"))["result"]; used = t
    if not res or not res["is_firm_order"]:
        tot["not_firm_or_missing"] += 1; continue
    sl = [x for x in sheet_lines[key] if sheet_size(x[1])]
    if not sl:
        tot["sheet_has_no_sizes"] += 1; continue
    # a document can be only part of an order; match each model line to a sheet line by size
    pool = collections.defaultdict(list)
    for x in sl: pool[sheet_size(x[1])].append(x)
    flagtxt = " ".join(res["uncertain"]).lower()
    for i, l in enumerate(res["lines"]):
        k = size_key(l["thickness_mm"], l["width_mm"], l["length_mm"])
        if not k: tot["line_no_size"] += 1; continue
        tot["lines"] += 1
        if k not in pool or not pool[k]:
            tot["size_not_in_sheet"] += 1; bad.append((key, used, f"line{i+1} size {k} not in sheet (sheet: {[sheet_size(x[1]) for x in sl][:4]})")); continue
        x = pool[k].pop(0)
        tot["size_ok"] += 1
        q_ok = num(l["qty"]) is not None and num(x[2]) is not None and abs(num(l["qty"]) - num(x[2])) < 0.01
        if num(l["qty"]) is None or l["qty_unit"] not in ("nos", "not_shown"): tot["qty_skipped"] += 1
        elif num(x[2]) is None: tot["qty_skipped"] += 1
        else:
            tot["qty_checked"] += 1
            if q_ok: tot["qty_ok"] += 1
            else: bad.append((key, used, f"line{i+1} qty doc={l['qty']} sheet={x[2]}"))
        if num(l["rate"]) and num(x[3]) and l["rate_unit"] in ("per_kg",):
            tot["rate_checked"] += 1
            if abs(num(l["rate"]) - num(x[3])) < 0.01: tot["rate_ok"] += 1
            else: bad.append((key, used, f"line{i+1} rate doc={l['rate']} sheet={x[3]}")); tot["rate_wrong_flagged" if "rate" in flagtxt else "rate_wrong_unflagged"] += 1
    tot["docs"] += 1

print("tags:", tags)
for k, v in sorted(tot.items()): print(f"  {k:24} {v}")
print("\nDifferences (document vs sheet):")
for b in bad: print("  ", b)
