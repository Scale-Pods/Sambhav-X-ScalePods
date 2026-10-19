"""Load the four small WB1 tabs that the first WB1 pass left out: MANGANESE PLATE, MIX GRADE, Incoming, Corten.

Reads DATABASE_URL from .env.local. Dry run (rolls back) unless --commit is passed.

  MANGANESE PLATE  balance list, no heat / plate numbers, no dates  -> lots + opening_count movements
  MIX GRADE        left block: plates with weights                  -> lots + opening_count movements
                   left block: pipes / fittings / angles (no weight) -> NOT stock; listed in one exception so nothing disappears
                   right block "SA 516 GR 70": same 5 / 4 / 4 plates already loaded from the SA 516 GR 70 tab -> skipped as a duplicate
  Incoming         mill purchase-order tracking                     -> mill_po_lines (reference data, not stock)
  Corten           vehicle weight log, June 2025                    -> vehicle_weight_log (reference data, not stock)

Plates that have no heat or plate number are loaded with identity_status 'legacy_missing' and an internal tag
(NOID-...) in plate_no, so they can be found, counted and tagged in the yard. Their receipt date is not in the sheet:
they are dated 1 Apr 2026 (start of the WB1 year) and say so in the remarks.
"""
import io
import json
import re
import sys
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl
import psycopg

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
SRC_FILE = "1_4_26 - 31_3_27 _ STOCK IMS Admin.xlsx"
COMMIT = "--commit" in sys.argv
OPENING = "2026-04-01"
IST = timezone(timedelta(hours=5, minutes=30))
NOTE = "WB1 small tabs, from the 8 Oct client copy"


def db_url() -> str:
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("DATABASE_URL missing in .env.local")


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def clean(v):
    s = None if v is None else re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def is_formula(ws_formula, r, c):
    v = ws_formula.cell(r, c).value
    return isinstance(v, str) and v.startswith("=")


def main() -> None:
    wv = openpyxl.load_workbook(ROOT / "data" / SRC_FILE, data_only=True)
    wf = openpyxl.load_workbook(ROOT / "data" / SRC_FILE, data_only=False)

    # ------------------------------------------------------------------ parse
    plates = []          # dicts: tab, row, grade_raw, thk, wid, len, pcs, kg, yard, heat, remark, formula
    mn = wv["MANGANESE PLATE"]
    for r in range(1, mn.max_row + 1):
        plot, thk, wid, ln, nos, wt = (num(mn.cell(r, c).value) for c in range(1, 7))
        if plot and thk and wid and ln and wt:
            plates.append(dict(tab="MANGANESE PLATE", row=r, grade_raw="MANGANESE PLATE (MN 13)", thk=thk, wid=wid, ln=ln, pcs=int(nos or 0), kg=wt,
                               yard=str(int(plot)), heat=None, remark="", formula=is_formula(wf["MANGANESE PLATE"], r, 6)))

    mx = wv["MIX GRADE"]
    nonplates, skipped_rows = [], []
    for r in range(4, mx.max_row + 1):
        gr, thk, wid, ln, qty, heat, wt, plot = (mx.cell(r, c).value for c in range(2, 10))
        if not any(v not in (None, "") for v in (gr, thk, wid, ln, qty, heat, wt)):
            continue
        if num(thk) and num(wid) and num(ln) and num(wt) and num(wt) > 0 and str(mx.cell(r, 1).value) in ("12.0", "20.0"):
            h, remark = clean(heat), ""
            if h and h.upper() == "NO":
                h = None
            if h and h.upper().startswith("COIL"):
                remark = "from coil"
                h = clean(h.split("/", 1)[1]) if "/" in h else None
            g = clean(gr)
            g = "UNSPECIFIED" if not g or g.upper() == "NO" else g.upper()
            y = str(int(plot)) if isinstance(plot, (int, float)) else clean(plot)
            plates.append(dict(tab="MIX GRADE", row=r, grade_raw=g, thk=num(thk), wid=num(wid), ln=num(ln), pcs=int(num(qty) or 0), kg=num(wt),
                               yard=y, heat=h, remark=remark, formula=is_formula(wf["MIX GRADE"], r, 8)))
        elif str(mx.cell(r, 1).value) == "18.0":
            nonplates.append(dict(row=r, grade=clean(gr), size=clean(thk), spec=clean(wid), qty=num(qty), heat=clean(heat), note=clean(mx.cell(r, 10).value)))
        else:
            skipped_rows.append(r)

    po_lines = []
    inc = wv["Incoming"]
    head = None
    for r in range(3, inc.max_row + 1):
        a = clean(inc.cell(r, 9).value)
        if a and a.upper().startswith("PO."):
            m = re.match(r"PO\.\s*NO\.\s*(\w+)(?:\s+Email)?\s*-\s*SO\.\s*NO\.\s*(\w+)\s*-\s*(.+)$", a, re.I)
            head = dict(po=m.group(1), so=m.group(2), grade=clean(m.group(3)), po_date=None, so_date=None) if m else None
            continue
        if a and a.lower().startswith("po date") and head:
            m = re.match(r"Po Date\s+(\S+)\s+(\S+)\s+So Date", a, re.I)
            if m:
                head["po_date"], head["so_date"] = m.group(1), m.group(2)
        size = clean(inc.cell(r, 10).value)
        if head and size and re.fullmatch(r"\d+(\.\d+)?\s*MM", size, re.I):
            po_lines.append(dict(row=r, **head, size=float(re.sub(r"[^\d.]", "", size)), rec=num(inc.cell(r, 11).value), ordered=num(inc.cell(r, 12).value), pending=num(inc.cell(r, 13).value)))

    weights = []
    ct = wv["Corten"]
    corten_note = None
    for r in range(2, ct.max_row + 1):
        ts, d, veh, wt, photo = (ct.cell(r, c).value for c in range(1, 6))
        if isinstance(d, datetime) and num(wt):
            weights.append(dict(row=r, ts=ts.replace(tzinfo=IST) if isinstance(ts, datetime) else None, date=d.date(), veh=clean(veh), kg=num(wt),
                                photo=(wf["Corten"].cell(r, 5).hyperlink.target if wf["Corten"].cell(r, 5).hyperlink else clean(photo))))
        elif clean(d) and "total" in str(d).lower():
            corten_note = f"{clean(d)}: {clean(ct.cell(r, 4).value)} = {ct.cell(r, 5).value}"

    print(f"parsed: plates {len(plates)} ({sum(p['kg'] for p in plates):,.1f} kg: "
          f"Mn {sum(1 for p in plates if p['tab'] == 'MANGANESE PLATE')}, mix {sum(1 for p in plates if p['tab'] == 'MIX GRADE')}) | "
          f"non-plate rows {len(nonplates)} | PO lines {len(po_lines)} in {len({p['po'] for p in po_lines})} POs | vehicle weights {len(weights)}")

    # ------------------------------------------------------------------ load
    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        cur.execute("select id, owner_entity_id from public.stock_books where code = 'WB1'")
        book_id, entity_id = cur.fetchone()
        cur.execute("select 1 from public.import_batches where source_file = %s and source_tab = 'MANGANESE PLATE'", (SRC_FILE,))
        if cur.fetchone():
            sys.exit("the small tabs are already loaded: refusing to load twice")

        cur.execute("select count(distinct l.id), coalesce(sum(m.weight_kg), 0) from public.lots l join public.stock_movements m on m.lot_id = l.id where l.stock_book_id = %s", (book_id,))
        lots_before, kg_before = cur.fetchone()

        yard_of = {}
        for code in {p["yard"] for p in plates if p["yard"]}:
            cur.execute("select id from public.yards where code = %s", (code,))
            row = cur.fetchone()
            if not row:
                cur.execute("insert into public.yards (code, name) values (%s, %s) returning id", (code, f"Plot {code} (from the WB1 sheet; confirm)"))
                row = cur.fetchone()
                print("yard created:", code)
            yard_of[code] = row[0]

        grade_map = {"E250 BR": "E250BR", "E350BR": "E350 BR"}
        grade_of = {}
        for raw in {p["grade_raw"] for p in plates}:
            code = grade_map.get(raw, raw)
            cur.execute("select id from public.grades where code = %s", (code,))
            row = cur.fetchone()
            if not row:
                cur.execute("insert into public.grades (code, is_plate, notes) values (%s, true, 'created from a WB1 small tab; needs review') returning id", (code,))
                row = cur.fetchone()
                print("grade created:", code)
            grade_of[raw] = row[0]

        batch = {}
        counts = {"MANGANESE PLATE": sum(1 for p in plates if p["tab"] == "MANGANESE PLATE"), "MIX GRADE": sum(1 for p in plates if p["tab"] == "MIX GRADE") + len(nonplates),
                  "Incoming": len(po_lines), "Corten": len(weights)}
        for tab, n in counts.items():
            cur.execute("insert into public.import_batches (source_file, source_tab, row_count, note) values (%s,%s,%s,%s) returning id",
                        (SRC_FILE, tab, n, NOTE + (f" ({corten_note})" if tab == "Corten" and corten_note else "")))
            batch[tab] = cur.fetchone()[0]

        seq = {"MANGANESE PLATE": 0, "MIX GRADE": 0}
        tags = {"MANGANESE PLATE": "NOID-MN13", "MIX GRADE": "NOID-MIX"}
        lot_ids, untagged = [], {"MANGANESE PLATE": [], "MIX GRADE": []}
        for p in plates:
            lid = uuid.uuid4()
            plate_no, status = None, "ok"
            if not p["heat"]:
                seq[p["tab"]] += 1
                plate_no, status = f"{tags[p['tab']]}-{seq[p['tab']]:03d}", "legacy_missing"
                untagged[p["tab"]].append(plate_no)
            remarks = (f"Loaded from WB1 {p['tab']} tab row {p['row']}. The sheet has no receipt date: dated {OPENING} (start of the WB1 year)."
                       + (" No heat or plate number in the sheet: internal tag, to be replaced by the real number when it is read off the plate." if status == "legacy_missing" else "")
                       + (f" {p['remark'].capitalize()}." if p["remark"] else ""))
            cur.execute("""insert into public.lots (id, stock_book_id, entity_id, origin, grade_id, grade_raw, thickness_mm, width_mm, length_mm, heat_no, plate_no,
                                                    identity_status, receipt_date, pieces_received, invoice_weight_kg, theoretical_weight_kg, yard_id, remarks)
                           values (%s,%s,%s,'opening_count',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (lid, book_id, entity_id, grade_of[p["grade_raw"]], p["grade_raw"], p["thk"], p["wid"], p["ln"], p["heat"], plate_no, status, OPENING, p["pcs"],
                         None if p["formula"] else p["kg"], p["kg"] if p["formula"] else None, yard_of.get(p["yard"]), remarks))
            cur.execute("insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note) values (%s,'opening_count',%s,%s,%s,%s)",
                        (lid, p["pcs"], p["kg"], OPENING, f"WB1 {p['tab']} row {p['row']}: balance stock"))
            cur.execute("insert into public.legacy_refs (table_name, record_id, import_batch_id, source_tab, source_row, raw) values ('lots',%s,%s,%s,%s,%s)",
                        (lid, batch[p["tab"]], p["tab"], p["row"], json.dumps({k: p[k] for k in ("grade_raw", "thk", "wid", "ln", "pcs", "kg", "yard", "heat", "remark")})))
            lot_ids.append(lid)

        for r in po_lines:
            cur.execute("""insert into public.mill_po_lines (po_no, so_no, grade_raw, po_date_text, so_date_text, size_mm, ordered_kg, received_kg, pending_kg, sheet_block, import_batch_id, source_tab, source_row)
                           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'Incoming',%s)""",
                        (r["po"], r["so"], r["grade"], r["po_date"], r["so_date"], r["size"], r["ordered"], r["rec"], r["pending"],
                         "PO columns I-M, under the heading 'EVONITH - SAMBHAV - GR 11, 22'; mill and buyer are not stated on each PO", batch["Incoming"], r["row"]))
        for w in weights:
            cur.execute("insert into public.vehicle_weight_log (logged_at, weigh_date, vehicle_no, weight_kg, photo_url, import_batch_id, source_tab, source_row) values (%s,%s,%s,%s,%s,%s,'Corten',%s)",
                        (w["ts"], w["date"], w["veh"], w["kg"], w["photo"], batch["Corten"], w["row"]))

        # nothing disappears silently
        exc = []
        for tab, tags_ in untagged.items():
            if tags_:
                exc.append(("legacy_data", "warning", f"WB1 {tab}: {len(tags_)} plates have no heat or plate number, so they were loaded with internal tags ({tags_[0]} to {tags_[-1]}) as opening stock dated {OPENING}",
                            {"tab": tab, "tags": tags_}, None, None))
        if any(p["yard"] == "739" for p in plates):
            exc.append(("legacy_data", "info", "WB1 MANGANESE PLATE: the sheet says plot 739, which is neither Plot 753 nor Plot D-15. Plot 739 was added as a yard: please confirm it is right", {"tab": "MANGANESE PLATE", "plot": "739"}, None, None))
        if nonplates:
            exc.append(("legacy_data", "info", f"WB1 MIX GRADE: {len(nonplates)} rows are pipes, fittings or angles with no weight, so they are not in the plate ledger. They stay in the sheet until pieces-based stock is decided",
                        {"tab": "MIX GRADE", "rows": nonplates}, None, None))
        exc.append(("legacy_data", "info", "WB1 MIX GRADE: the right-hand 'SA 516 GR 70' block (D15: 5 x 20 mm, 4 x 25 mm 2000 wide, 4 x 25 mm 2500 wide) was not loaded: the same 13 plates are already loaded from the SA 516 GR 70 tab with their heat numbers",
                    {"tab": "MIX GRADE", "block": "J-O"}, None, None))
        sample = clean(mx.cell(40, 2).value)
        if sample:
            exc.append(("legacy_data", "info", f"WB1 MIX GRADE row 40: '{sample}' 20 x 1250 x 3150 ('{clean(mx.cell(40, 7).value)}', '{clean(mx.cell(40, 10).value)}') has no weight and is a sample cut, so it was not loaded", {"tab": "MIX GRADE", "row": 40}, None, None))
        cur.executemany("insert into public.exceptions (kind, severity, message, context, related_table, related_id) values (%s,%s,%s,%s,%s,%s)",
                        [(k, s, m, json.dumps(c, default=str), t, i) for k, s, m, c, t, i in exc])

        # verification
        cur.execute("select count(distinct l.id), coalesce(sum(m.weight_kg), 0) from public.lots l join public.stock_movements m on m.lot_id = l.id where l.stock_book_id = %s", (book_id,))
        lots_after, kg_after = cur.fetchone()
        exp_kg = sum(p["kg"] for p in plates)
        cur.execute("select count(*), coalesce(sum(received_kg), 0), coalesce(sum(ordered_kg), 0) from public.mill_po_lines")
        n_po, rec_kg, ord_kg = cur.fetchone()
        cur.execute("select count(*), coalesce(sum(weight_kg), 0) from public.vehicle_weight_log")
        n_w, w_kg = cur.fetchone()
        print(f"WB1 lots {lots_before} -> {lots_after} (+{lots_after - lots_before}, expected +{len(plates)}) | WB1 balance {float(kg_before):,.1f} -> {float(kg_after):,.1f} kg (+{float(kg_after - kg_before):,.1f}, expected +{exp_kg:,.1f})")
        print(f"mill PO lines {n_po} (expected {len(po_lines)}; ordered {float(ord_kg):,.0f} kg, received {float(rec_kg):,.0f} kg) | vehicle weights {n_w} ({float(w_kg):,.0f} kg)")
        bad = [r for r in po_lines if r["rec"] is not None and r["ordered"] is not None and r["pending"] is not None and abs(r["ordered"] - r["rec"] - r["pending"]) > 0.5]
        bad += [r for r in po_lines if r["rec"] is None and r["ordered"] is not None and r["pending"] is not None and abs(r["ordered"] - r["pending"]) > 0.5]
        print("PO lines whose pending does not equal ordered - received:", len(bad))
        print("exceptions added:", len(exc))
        ok = (lots_after - lots_before == len(plates) and abs(float(kg_after - kg_before) - exp_kg) < 0.5 and n_po == len(po_lines) == 28 and n_w == len(weights) == 4)
        if not ok:
            conn.rollback()
            sys.exit("VERIFICATION FAILED: rolled back")
        if COMMIT:
            conn.commit()
            print("COMMITTED")
        else:
            conn.rollback()
            print("dry run: rolled back (use --commit to keep)")


if __name__ == "__main__":
    main()
