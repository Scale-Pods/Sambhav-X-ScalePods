"""WB2 (STOCK | SPF & RS) -> normalised lots and movements, with a reconciliation against the sheet's own Summary.

Dry run only: nothing is written to the database. Outputs go to data/ (gitignored):
  data/wb2_lots.csv, data/wb2_movements.csv, data/wb2_exceptions.csv, data/wb2_reconciliation.csv

Sheet layout (every grade tab):  PURCHASE A..O | SALES Q..Z | BALANCE AB..AG, repeated per thickness section.
  Purchase: A DATE, B THK, C WID, D LEN, E NOS, F WT, G HEAT NO, H PLATE NO, I TC NO, J LINK, K CON MTC, L CON LINK, M HSN, N RATE
  Sales:    Q DATE, R INV NO, S V.NO, T THK, U WID, V LEN, W NOS, X WT, Y PLOT, Z PLATE NO
Only the first plate of a sales invoice carries date / invoice no: continuation rows are filled forward.
WT is a typed invoice weight on some rows and the formula T*W*L*0.000008*NOS on others; both are kept apart.
"""
import csv
import datetime as dt
import io
import re
import sys
import warnings
from collections import defaultdict
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

DATA = Path(__file__).resolve().parents[2] / "data"
SRC = DATA / "1_1_26-31_3_27 _ STOCK _ SPF & RS.xlsx"
TABS = {"SA 537": "SA 537 CL 1", "690 QL": "S690QL", "ROCKSTAR 400": "ROCKSTAR 400", "ROCKSTAR 500": "ROCKSTAR 500"}

P = dict(date=1, thk=2, wid=3, len=4, nos=5, wt=6, heat=7, plate=8, tc=9, link=10, con=11, con_link=12, hsn=13, rate=14)
S = dict(date=17, inv=18, vno=19, thk=20, wid=21, len=22, nos=23, wt=24, plot=25, plate=26)


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def txt(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s.upper() not in ("NA", "N/A", "NIL", "-", "NONE") else None


def link_of(cell):
    """A certificate cell often shows a file name with the real web address behind it: prefer the address."""
    if cell.hyperlink is not None and cell.hyperlink.target:
        return cell.hyperlink.target
    return txt(cell.value)


def norm(v):
    return re.sub(r"[^A-Z0-9]", "", str(v).upper()) if v is not None else ""


def as_date(v):
    return v.date() if isinstance(v, dt.datetime) else (v if isinstance(v, dt.date) else None)


def main() -> None:
    wv = openpyxl.load_workbook(SRC, data_only=True)
    wf = openpyxl.load_workbook(SRC, data_only=False)

    lots, moves, exc = [], [], []
    for tab, grade in TABS.items():
        ws, wsf = wv[tab], wf[tab]
        by_plate: dict[str, dict] = {}
        carry = dict(date=None, inv=None, vno=None)
        for r in range(4, ws.max_row + 1):
            if str(ws.cell(r, P["date"]).value).strip().upper() == "DATE":
                carry = dict(date=None, inv=None, vno=None)       # new thickness section
                continue
            if str(ws.cell(r, P["wt"]).value).strip().lower() == "total pur":
                continue

            # ---- purchase side
            thk, wt = num(ws.cell(r, P["thk"]).value), num(ws.cell(r, P["wt"]).value)
            heat, plate = txt(ws.cell(r, P["heat"]).value), txt(ws.cell(r, P["plate"]).value)
            if thk is not None and wt and (heat or plate):
                is_formula = isinstance(wsf.cell(r, P["wt"]).value, str) and str(wsf.cell(r, P["wt"]).value).startswith("=")
                wid, ln, nos = num(ws.cell(r, P["wid"]).value), num(ws.cell(r, P["len"]).value), num(ws.cell(r, P["nos"]).value)
                theo = round(thk * (wid or 0) * (ln or 0) * 0.000008 * (nos or 0), 2) if wid and ln and nos else None
                rec = as_date(ws.cell(r, P["date"]).value)
                key = norm(plate or heat)
                lot = dict(tab=tab, row=r, grade=grade, receipt_date=rec, thickness_mm=thk, width_mm=wid, length_mm=ln,
                           pieces=int(nos) if nos else None, heat_no=heat, plate_no=plate, tc_no=txt(ws.cell(r, P["tc"]).value),
                           tc_link=link_of(wsf.cell(r, P["link"])), con_mtc=txt(ws.cell(r, P["con"]).value),
                           con_link=link_of(wsf.cell(r, P["con_link"])), hsn=txt(ws.cell(r, P["hsn"]).value),
                           rate_per_kg=num(ws.cell(r, P["rate"]).value), sheet_wt=wt,
                           invoice_weight_kg=None if is_formula else wt, theoretical_weight_kg=wt if is_formula else theo,
                           weight_source="formula" if is_formula else "typed", key=key)
                if rec is None:
                    exc.append((tab, r, "purchase row without a receipt date", plate or heat))
                if not plate:
                    exc.append((tab, r, "purchase row without a plate number (WB2 key is plate no)", heat))
                if key in by_plate:
                    exc.append((tab, r, "duplicate purchase key in the same tab", key))
                by_plate.setdefault(key, lot)
                lots.append(lot)
                moves.append(dict(tab=tab, row=r, key=key, type="receipt", date=rec, weight_kg=wt, pieces=int(nos) if nos else 0,
                                  inv=None, vno=None))

            # ---- sales side (date / invoice carried forward)
            sd, si, sv = as_date(ws.cell(r, S["date"]).value), txt(ws.cell(r, S["inv"]).value), txt(ws.cell(r, S["vno"]).value)
            if sd or si:
                carry = dict(date=sd or carry["date"], inv=si or carry["inv"], vno=sv or carry["vno"])
            sthk, swt, splate = num(ws.cell(r, S["thk"]).value), num(ws.cell(r, S["wt"]).value), txt(ws.cell(r, S["plate"]).value)
            if sthk is not None and swt and splate:
                key = norm(splate)
                nos = num(ws.cell(r, S["nos"]).value)
                if carry["date"] is None:
                    exc.append((tab, r, "sale row without a date", splate))
                moves.append(dict(tab=tab, row=r, key=key, type="sale", date=carry["date"], weight_kg=-swt,
                                  pieces=-int(nos) if nos else 0, inv=carry["inv"], vno=carry["vno"]))

        known = {m["key"] for m in moves if m["tab"] == tab and m["type"] == "receipt"}
        for m in moves:
            if m["tab"] == tab and m["type"] == "sale" and m["key"] not in known:
                exc.append((tab, m["row"], "sale of a plate that was never purchased in this tab", m["key"]))

    # ---- reconciliation vs the sheet's own Summary
    sm = wv["Summary"]
    summary = {}
    for r in range(4, sm.max_row + 1):
        g, t = sm.cell(r, 1).value, sm.cell(r, 2).value
        if g and t and re.match(r"^\d", str(t).strip()):
            summary[(str(g).strip().upper(), float(re.findall(r"[\d.]+", str(t))[0]))] = (
                num(sm.cell(r, 4).value) or 0, num(sm.cell(r, 5).value) or 0, num(sm.cell(r, 6).value) or 0)

    got = defaultdict(lambda: [0.0, 0.0])
    thk_of = {}
    for lot in lots:
        thk_of[(lot["tab"], lot["key"])] = lot["thickness_mm"]
        got[(lot["tab"].upper(), lot["thickness_mm"])][0] += lot["sheet_wt"]
    for m in moves:
        if m["type"] == "sale":
            t = thk_of.get((m["tab"], m["key"]))
            if t is not None:
                got[(m["tab"].upper(), t)][1] += -m["weight_kg"]

    rec_rows, bad = [], 0
    for k in sorted(set(summary) | set(got)):
        sp, ss, sb = summary.get(k, (0, 0, 0))
        gp, gs = got.get(k, (0, 0))
        ok = abs(gp - sp) < 1 and abs(gs - ss) < 1
        if not ok:
            bad += 1
        rec_rows.append([k[0], k[1], round(sp, 1), round(gp, 1), round(ss, 1), round(gs, 1), round(sb, 1), round(gp - gs, 1), "OK" if ok else "DIFF"])

    # ---- write outputs
    def write(name, header, rows):
        with open(DATA / name, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    keys = ["tab", "row", "grade", "receipt_date", "thickness_mm", "width_mm", "length_mm", "pieces", "heat_no", "plate_no", "tc_no",
            "tc_link", "con_mtc", "con_link", "hsn", "rate_per_kg", "sheet_wt", "invoice_weight_kg", "theoretical_weight_kg", "weight_source", "key"]
    write("wb2_lots.csv", keys, [[lot[k] for k in keys] for lot in lots])
    write("wb2_movements.csv", ["tab", "row", "key", "type", "date", "weight_kg", "pieces", "inv", "vno"],
          [[m[k] for k in ("tab", "row", "key", "type", "date", "weight_kg", "pieces", "inv", "vno")] for m in moves])
    write("wb2_exceptions.csv", ["tab", "row", "problem", "value"], exc)
    write("wb2_reconciliation.csv", ["tab", "thickness", "summary_purchase", "parsed_purchase", "summary_sale", "parsed_sale",
                                    "summary_balance", "parsed_balance", "status"], rec_rows)

    sales = [m for m in moves if m["type"] == "sale"]
    print(f"lots: {len(lots)}   purchase kg: {sum(l['sheet_wt'] for l in lots):,.0f}")
    print(f"sale movements: {len(sales)}   sale kg: {-sum(m['weight_kg'] for m in sales):,.0f}")
    print("typed weights:", sum(1 for l in lots if l['weight_source'] == 'typed'), " formula weights:", sum(1 for l in lots if l['weight_source'] == 'formula'))
    print("exceptions:", len(exc))
    for kind in sorted({e[2] for e in exc}):
        print("   ", sum(1 for e in exc if e[2] == kind), kind)
    print(f"reconciliation vs Summary: {len(rec_rows) - bad} OK, {bad} differ (of {len(rec_rows)} grade/thickness rows)")
    for row in rec_rows:
        if row[-1] == "DIFF":
            print("   DIFF", row)
    net = sum(l['sheet_wt'] for l in lots) + sum(m['weight_kg'] for m in sales)
    print(f"net balance from movements: {net:,.0f} kg")


if __name__ == "__main__":
    main()
