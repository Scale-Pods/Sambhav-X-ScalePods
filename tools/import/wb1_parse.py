"""WB1 (STOCK IMS Admin, SPF alloy plates, FY26-27) -> normalised lots and sale allocations. Dry run only.

Outputs in data/ (gitignored): wb1_lots.csv, wb1_movements.csv, wb1_exceptions.csv

The workbook has about six column layouts, so each grade tab is read by its own header row, not by fixed columns:
  [ PURCHASE block ] gap [ SALES block ] gap [ BALANCE block ]
The three blocks are told apart by the three THK headers. Header rows repeat down the tab (one per thickness section);
sale date / invoice / vehicle are filled forward from the first row of a sales entry until the next header.
Key to match a sale to a purchase: plate no when the row has one (AMNS / Jindal tabs), else the heat no.
A cell can hold several heats ("31922TB,16145TA,65532SC2"): split on comma / newline only ('333075/251134480' is one heat/batch).
A sale that names several heats is shared over those lots by remaining weight (estimate, flagged).
Sales whose key was never purchased are NOT turned into stock: they go to the exceptions list.
"""
import csv
import io
import re
import sys
import warnings
from collections import defaultdict
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore")
if (sys.stdout.encoding or '').lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

DATA = Path(__file__).resolve().parents[2] / "data"
SRC = DATA / "1_4_26 - 31_3_27 _ STOCK IMS Admin.xlsx"
# tab -> canonical grade code (tab-level; the CL / class column is kept in remarks, not split)
TABS = {
    "GR. 11": "SA 387 GR 11 CL2", "GR 11 AJ": "SA 387 GR 11 CL2",
    "GR. 22": "SA 387 GR 22 CL2", "GR 22 - AJ": "SA 387 GR 22 CL2",
    "16M03": "16M03 PLATE", "GR. 12  W": "SA 387 GR 12 CL2", "GR. 5": "SA 387 GR 5 CL2",
    "GR. 9": "SA 387 GR 9", "GR. 91": "SA 387 GR 91", "A36": "A36", "SA 516 GR 70": "SA 516 GR 70",
}
SKIPPED = {"Summary": "report", "Statistics": "report", "Incoming": "PO tracking, not stock", "MIX GRADE": "different layout, 39 rows: later pass",
           "MANGANESE PLATE": "no heat numbers, 17 rows: later pass", "Corten": "hidden, 7 rows: later pass"}
ALIAS = {"WIDTH": "WID", "LENGTH": "LEN", "PCS": "NOS", "QTY": "NOS", "WEIGHT": "WT", "V. NO": "VNO", "V.NO": "VNO", "HSN CODE": "HSN",
         "MTC LINK": "LINK", "HEAT NO.": "HEAT NO"}
PLOTISH = {"PLOT", "NEW PLOT"}


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def txt(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s.upper() not in ("NA", "N/A", "NIL", "NO", "-", "NONE", "0", "0.0") else None


def link_of(cell):
    """A certificate cell often shows a file name with the real web address behind it: prefer the address."""
    if cell.hyperlink is not None and cell.hyperlink.target:
        return cell.hyperlink.target
    return txt(cell.value)


def norm(v):
    return re.sub(r"[^A-Z0-9]", "", str(v).upper())


def as_date(v):
    return v.date().isoformat() if hasattr(v, "date") and not isinstance(v, str) else None


def tokens(cell):
    """one cell -> list of heat / plate tokens"""
    if not cell:
        return []
    return [t.strip() for t in re.split(r"[,\n;]+", str(cell)) if t.strip()]


def header_map(ws, r):
    """col -> normalised header name for one header row, plus block boundaries."""
    names = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(r, c).value
        if isinstance(v, str) and v.strip():
            n = re.sub(r"\s+", " ", v.strip().upper())
            if re.fullmatch(r"1%? ?INT|INT 1%", n):
                n = "INT"
            names[c] = ALIAS.get(n, n)
    thk = [c for c, n in names.items() if n == "THK"]
    if len(thk) < 2:
        return None
    t2 = thk[1]
    c = t2 - 1
    while c >= 1 and names.get(c) in ("DATE", "INV NO", "VNO", "BUYER"):
        c -= 1
    s0 = c + 1
    if len(thk) >= 3:
        b0 = thk[2]
        while names.get(b0 - 1) in PLOTISH:
            b0 -= 1
    else:
        b0 = ws.max_column + 1
    return dict(P={c: n for c, n in names.items() if c < s0}, S={c: n for c, n in names.items() if s0 <= c < b0})


def pick(block, name, which=0):
    cols = sorted(c for c, n in block.items() if n == name)
    return cols[which] if len(cols) > which else None


def parse(wv, wf, tabs=None):
    """Read the grade tabs of an openpyxl-like workbook pair (values, formulas): -> lots, sales, alloc, exc, unmatched, remaining."""
    lots, sales, exc = [], [], []

    for tab, grade in (tabs or TABS).items():
        ws, wsf = wv[tab], wf[tab]
        hm = None
        carry = dict(date=None, inv=None, vno=None)
        for r in range(1, ws.max_row + 1):
            h = header_map(ws, r)
            if h:
                hm, carry = h, dict(date=None, inv=None, vno=None)
                continue
            if not hm:
                continue
            P, S = hm["P"], hm["S"]
            g = lambda blk, n, w=0: ws.cell(r, pick(blk, n, w)).value if pick(blk, n, w) else None

            # ---- purchase row
            thk, wt = num(g(P, "THK")), num(g(P, "WT"))
            heat, plate = txt(g(P, "HEAT NO")), txt(g(P, "PLATE NO"))
            if thk and wt and wt > 0 and (heat or plate):
                wcol = pick(P, "WT")
                is_formula = isinstance(wsf.cell(r, wcol).value, str) and str(wsf.cell(r, wcol).value).startswith("=")
                wid, ln, nos = num(g(P, "WID")), num(g(P, "LEN")), num(g(P, "NOS"))
                keys = [norm(t) for t in (tokens(plate) + tokens(heat)) if norm(t)]
                cl = txt(g(P, "CL")) or txt(g(P, "DUAL"))
                make = txt(g(P, "MAKE"))
                lots.append(dict(tab=tab, row=r, grade=grade, receipt_date=as_date(g(P, "DATE")), thickness_mm=thk, width_mm=wid, length_mm=ln,
                                 pieces=int(nos) if nos else None, heat_no=heat, plate_no=plate, keys="|".join(dict.fromkeys(keys)),
                                 hsn=txt(g(P, "HSN")), rate_per_kg=num(g(P, "RATE")), link=link_of(wsf.cell(r, pick(P, "LINK"))) if pick(P, "LINK") else None, mtc_no=txt(g(P, "MTC NO")),
                                 make=make, cls=cl, sheet_wt=wt, weight_source="formula" if is_formula else "typed",
                                 purchase_inv=txt(g(P, "INV NO"))))
                if not as_date(g(P, "DATE")):
                    exc.append((tab, r, "purchase row without a receipt date", heat or plate))
            elif thk and wt and wt > 0:
                exc.append((tab, r, "purchase row without heat / plate number: not loaded", f"{thk} x {wt} kg"))

            # ---- sales row (date / invoice / vehicle carried forward)
            sd, si, sv = as_date(g(S, "DATE")), txt(g(S, "INV NO")), txt(g(S, "VNO"))
            if si and not re.fullmatch(r"\d+(\.0)?(/\d{2}-\d{2})?|\d+[ ,]+\d+", si):
                si = None          # thickness / quarter markers ('6MM', 'Q1') sitting in the invoice column
            if sd or si:
                carry = dict(date=sd or carry["date"], inv=si or carry["inv"], vno=sv or carry["vno"])
            sthk, swt = num(g(S, "THK")), num(g(S, "WT"))
            sh, sp = txt(g(S, "HEAT NO")), txt(g(S, "PLATE NO"))
            if sthk and swt and swt > 0 and (sh or sp):
                keys = [norm(t) for t in (tokens(sp) + tokens(sh)) if norm(t)]
                nos = num(g(S, "NOS"))
                if not carry["date"]:
                    exc.append((tab, r, "sale row without a date", sp or sh))
                sales.append(dict(tab=tab, row=r, keys="|".join(dict.fromkeys(keys)), date=carry["date"], inv=carry["inv"], vno=carry["vno"],
                                  thickness_mm=sthk, width_mm=num(g(S, "WID")), length_mm=num(g(S, "LEN")), pieces=int(nos) if nos else 0,
                                  weight_kg=swt, buyer=txt(g(S, "BUYER")), notes=txt(g(S, "NOTES")), plot=txt(g(S, "PLOT"))))

    # ---- allocate each sale to purchase lots
    by_key = defaultdict(list)
    for i, l in enumerate(lots):
        for k in l["keys"].split("|"):
            by_key[(l["tab"], k)].append(i)
    remaining = [l["sheet_wt"] for l in lots]
    alloc, unmatched = [], []
    for s in sales:
        picked = []
        for k in s["keys"].split("|"):
            cand = by_key.get((s["tab"], k), [])
            if not cand:
                continue
            def fit(i):
                l = lots[i]
                dims = sum(1 for a, b in (("thickness_mm", "thickness_mm"), ("width_mm", "width_mm"), ("length_mm", "length_mm")) if l[a] and s[b] and abs(l[a] - s[b]) < 1)
                return (dims, remaining[i])
            best = max(cand, key=fit)
            if best not in picked:
                picked.append(best)
        if not picked:
            unmatched.append(s)
            exc.append((s["tab"], s["row"], "sale of a heat / plate that was never purchased: not loaded", s["keys"]))
            continue
        share = [max(remaining[i], 1.0) for i in picked]
        tot = sum(share)
        if len(picked) > 1:
            exc.append((s["tab"], s["row"], f"sale names {len(picked)} heats; weight shared by remaining weight (estimate)", s["keys"]))
        left_w, left_p = s["weight_kg"], s["pieces"]
        for n, i in enumerate(picked):
            last = n == len(picked) - 1
            w = left_w if last else round(s["weight_kg"] * share[n] / tot, 2)
            p = left_p if last else round(s["pieces"] * share[n] / tot)
            left_w -= w
            left_p -= p
            remaining[i] -= w
            alloc.append(dict(lot_index=i, tab=s["tab"], row=s["row"], date=s["date"], weight_kg=-w, pieces=-p, inv=s["inv"], vno=s["vno"],
                              buyer=s["buyer"], notes=s["notes"], plot=s["plot"], shared=len(picked) > 1))

    return lots, sales, alloc, exc, unmatched, remaining


def main() -> None:
    wv = openpyxl.load_workbook(SRC, data_only=True)
    wf = openpyxl.load_workbook(SRC, data_only=False)
    lots, sales, alloc, exc, unmatched, remaining = parse(wv, wf)

    # ---- write
    def write(name, header, rows):
        with open(DATA / name, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    lk = list(lots[0].keys())
    write("wb1_lots.csv", ["lot_index"] + lk, [[i] + [l[k] for k in lk] for i, l in enumerate(lots)])
    mk = ["lot_index", "tab", "row", "date", "weight_kg", "pieces", "inv", "vno", "buyer", "notes", "plot", "shared"]
    write("wb1_movements.csv", mk, [[a[k] for k in mk] for a in alloc])
    write("wb1_exceptions.csv", ["tab", "row", "problem", "value"], exc)

    kg_in = sum(l["sheet_wt"] for l in lots)
    kg_out = -sum(a["weight_kg"] for a in alloc)
    print(f"lots {len(lots)} | received {kg_in:,.0f} kg | sale rows {len(sales)} | allocated movements {len(alloc)} | sold {kg_out:,.0f} kg")
    print(f"unmatched sales (not loaded): {len(unmatched)} rows, {sum(s['weight_kg'] for s in unmatched):,.0f} kg")
    print(f"balance from movements: {kg_in - kg_out:,.0f} kg")
    per = defaultdict(lambda: [0, 0.0, 0, 0.0])
    for l in lots:
        per[l["tab"]][0] += 1
        per[l["tab"]][1] += l["sheet_wt"]
    for a in alloc:
        per[a["tab"]][2] += 1
        per[a["tab"]][3] += -a["weight_kg"]
    for t, v in per.items():
        print(f"  {t:12} lots {v[0]:4} in {v[1]:>10,.0f} | sales {v[2]:4} out {v[3]:>10,.0f}")
    print("typed weights:", sum(1 for l in lots if l["weight_source"] == "typed"), "formula:", sum(1 for l in lots if l["weight_source"] == "formula"))
    print("lots with several keys:", sum(1 for l in lots if "|" in l["keys"] and l["keys"].count("|") >= 1), "| exceptions:", len(exc))
    for kind in sorted({re.sub(r"\d+ heats", "n heats", e[2]) for e in exc}):
        print("   ", sum(1 for e in exc if re.sub(r"\d+ heats", "n heats", e[2]) == kind), kind)
    over = defaultdict(float)
    for i, l in enumerate(lots):
        if remaining[i] < -0.5:
            over[i] = -remaining[i]
    print("lots sold above what was received:", len(over), "| above 5%:", sum(1 for i, v in over.items() if v > lots[i]["sheet_wt"] * 0.05))


if __name__ == "__main__":
    main()
