"""Load the WB2 stock book (SPF & RS) into Supabase from the CSVs written by wb2_parse.py.

Run `python tools/import/wb2_parse.py` first. Reads DATABASE_URL from .env.local.
Default is a dry run that rolls back; pass --commit to keep the data.

What is loaded, per the agreed defaults:
  - one lot + one receipt movement per purchase row, one sale movement per sale row (negative weight)
  - every row is tagged back to its sheet tab and row in legacy_refs
  - the sheet is loaded as it stands; anything doubtful goes to the exceptions table instead of being fixed silently:
      * purchase rows with no receipt date are NOT loaded (a lot needs a date)
      * a sale with no date takes the date of another row on the same invoice if that is unambiguous,
        otherwise it is placed on the lot's receipt date and flagged
      * sales above what was received, sales dated before receipt, and sales dated in the future are flagged
The stock_movements balance trigger is switched off for this transaction only: it blocks sales above 5% of the lot,
and the old sheet already contains such rows. They are reported as exceptions instead.
"""
import csv
import io
import json
import sys
import uuid
from collections import defaultdict
from datetime import date
from pathlib import Path

import psycopg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
SRC_FILE = "1_1_26-31_3_27 _ STOCK _ SPF & RS.xlsx"
COMMIT = "--commit" in sys.argv


def db_url() -> str:
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("DATABASE_URL missing in .env.local")


def f(v):
    return float(v) if v not in (None, "") else None


def hsn(v):
    return v[:-2] if v and v.endswith(".0") else (v or None)


def main() -> None:
    lots_csv = list(csv.DictReader(open(DATA / "wb2_lots.csv", encoding="utf-8-sig")))
    moves_csv = list(csv.DictReader(open(DATA / "wb2_movements.csv", encoding="utf-8-sig")))
    today = date.today().isoformat()

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        cur.execute("select id, owner_entity_id from public.stock_books where code = 'WB2'")
        book_id, entity_id = cur.fetchone()
        cur.execute("select count(*) from public.lots where stock_book_id = %s", (book_id,))
        if cur.fetchone()[0]:
            sys.exit("WB2 already has lots: refusing to load twice")

        grade_of = {}
        for tab, grade in {r["tab"]: r["grade"] for r in lots_csv}.items():
            cur.execute("""select g.id from public.grades g
                           where app.norm_text(g.code) = app.norm_text(%s)
                           union select a.grade_id from public.grade_aliases a where a.alias_norm = app.norm_text(%s)""",
                        (grade, grade))
            ids = {r[0] for r in cur.fetchall()}
            if len(ids) != 1:
                sys.exit(f"grade '{grade}' (tab {tab}) resolves to {len(ids)} grades; fix the grade list first")
            grade_of[tab] = ids.pop()

        # ---- decide what is loaded
        exceptions = []     # (kind, severity, message, context, related_table, related_id)
        batch = {}
        for tab in {r["tab"] for r in lots_csv}:
            cur.execute("insert into public.import_batches (source_file, source_tab, row_count, note) values (%s, %s, %s, %s) returning id",
                        (SRC_FILE, tab, sum(1 for r in lots_csv if r["tab"] == tab) + sum(1 for m in moves_csv if m["tab"] == tab and m["type"] == "sale"),
                         "WB2 first load from the 18 Sep / 8 Oct client copy"))
            batch[tab] = cur.fetchone()[0]

        lot_rows, lot_by_key, skipped = [], {}, []
        for r in lots_csv:
            if not r["receipt_date"]:
                skipped.append(r)
                exceptions.append(("legacy_data", "warning", f"WB2 {r['tab']} row {r['row']}: purchase has no receipt date, so it was not loaded",
                                   {"tab": r["tab"], "row": int(r["row"]), "key": r["key"], "weight_kg": f(r["sheet_wt"])}, None, None))
                continue
            lid = uuid.uuid4()
            lot_rows.append((lid, r))
            key = (r["tab"], r["key"])
            if key in lot_by_key:
                exceptions.append(("duplicate_key", "warning", f"WB2 {r['tab']} row {r['row']}: plate {r['key']} appears twice; sales are matched to the first",
                                   {"tab": r["tab"], "row": int(r["row"]), "key": r["key"]}, "lots", lid))
            else:
                lot_by_key[key] = (lid, r)

        lot_sql = """insert into public.lots (id, stock_book_id, entity_id, origin, grade_id, grade_raw, thickness_mm, width_mm, length_mm,
                         heat_no, plate_no, tc_no, receipt_date, pieces_received, invoice_weight_kg, theoretical_weight_kg, hsn_code, remarks)
                     values (%s,%s,%s,'purchase',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

        # ---- invoice no -> date, from the sheet's own dated sale rows, only where unambiguous
        inv_dates = defaultdict(set)
        for m in moves_csv:
            if m["type"] == "sale" and m["date"] and m["inv"]:
                inv_dates[m["inv"]].add(m["date"])

        sale_rows = []
        for m in moves_csv:
            if m["type"] != "sale":
                continue
            hit = lot_by_key.get((m["tab"], m["key"]))
            if not hit:
                exceptions.append(("legacy_data", "error", f"WB2 {m['tab']} row {m['row']}: sale of a plate with no loaded lot ({m['key']})",
                                   {"tab": m["tab"], "row": int(m["row"]), "key": m["key"], "weight_kg": f(m["weight_kg"])}, None, None))
                continue
            lid, lot = hit
            d, note = m["date"], f"WB2 {m['tab']} row {m['row']}: invoice {m['inv']}, V.NO {m['vno']}"
            if not d:
                cands = inv_dates.get(m["inv"], set())
                if len(cands) == 1:
                    d = next(iter(cands))
                    note += "; date taken from another row of the same invoice"
                else:
                    d = lot["receipt_date"]
                    note += "; DATE UNKNOWN in the sheet, placed on the lot's receipt date"
                    exceptions.append(("legacy_data", "warning", f"WB2 {m['tab']} row {m['row']}: sale has no date (invoice {m['inv']})",
                                       {"tab": m["tab"], "row": int(m["row"]), "invoice": m["inv"], "placed_on": d, "other_dates_for_invoice": sorted(cands)},
                                       "lots", lid))
            if d > today:
                exceptions.append(("legacy_data", "warning", f"WB2 {m['tab']} row {m['row']}: sale dated in the future ({d})",
                                   {"tab": m["tab"], "row": int(m["row"]), "date": d}, "lots", lid))
            elif d < lot["receipt_date"]:
                exceptions.append(("legacy_data", "info", f"WB2 {m['tab']} row {m['row']}: sale dated {d} is before the receipt {lot['receipt_date']}",
                                   {"tab": m["tab"], "row": int(m["row"]), "sale_date": d, "receipt_date": lot["receipt_date"]}, "lots", lid))
            sale_rows.append((lid, m, d, note))

        # ---- insert
        cur.execute("alter table public.stock_movements disable trigger stock_movements_balance")
        cur.executemany(lot_sql, [
            (lid, book_id, entity_id, grade_of[r["tab"]], r["grade"], f(r["thickness_mm"]), f(r["width_mm"]), f(r["length_mm"]),
             r["heat_no"] or None, r["plate_no"] or None, r["tc_no"] or None, r["receipt_date"], int(r["pieces"]) if r["pieces"] else None,
             f(r["invoice_weight_kg"]), f(r["theoretical_weight_kg"]), hsn(r["hsn"]), "Loaded from WB2 sheet") for lid, r in lot_rows])

        cur.executemany("""insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note)
                           values (%s,'receipt',%s,%s,%s,%s)""",
                        [(lid, int(r["pieces"]) if r["pieces"] else 0, f(r["sheet_wt"]), r["receipt_date"],
                          f"WB2 {r['tab']} row {r['row']}: purchase") for lid, r in lot_rows])
        sale_rows.sort(key=lambda x: (x[2], x[1]["tab"], int(x[1]["row"])))
        cur.executemany("""insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note)
                           values (%s,'sale',%s,%s,%s,%s)""",
                        [(lid, int(m["pieces"]), f(m["weight_kg"]), d, note) for lid, m, d, note in sale_rows])
        cur.execute("alter table public.stock_movements enable trigger stock_movements_balance")

        # ---- legacy refs (tab + row + the sheet fields that have no column yet)
        cur.executemany("insert into public.legacy_refs (table_name, record_id, import_batch_id, source_tab, source_row, raw) values ('lots',%s,%s,%s,%s,%s)",
                        [(lid, batch[r["tab"]], r["tab"], int(r["row"]),
                          json.dumps({k: r[k] for k in ("tc_link", "con_mtc", "con_link", "rate_per_kg", "weight_source", "sheet_wt", "hsn", "tc_no")})) for lid, r in lot_rows])

        # ---- over-sold lots, measured on what is now in the database
        cur.execute("""select l.id, l.lot_no, l.grade_raw, l.plate_no, sum(m.weight_kg) filter (where m.weight_kg > 0) as received,
                              sum(m.weight_kg) as bal, sum(m.pieces) as pcs
                       from public.lots l join public.stock_movements m on m.lot_id = l.id
                       where l.stock_book_id = %s group by l.id having sum(m.weight_kg) < 0 or sum(m.pieces) < 0""", (book_id,))
        over_w = over_p = 0
        for lid, lot_no, g, plate, rec, bal, pcs in cur.fetchall():
            pct = -bal / rec * 100 if bal < 0 else 0
            if pct > 2:      # the warn threshold; smaller gaps are ordinary invoice-vs-weighbridge rounding
                over_w += 1
                exceptions.append(("weight_warning", "error" if pct > 5 else "warning",
                                   f"WB2 lot {lot_no} ({g} {plate}) sold {-bal:.0f} kg more than received ({pct:.1f}%)",
                                   {"lot_no": lot_no, "received_kg": float(rec), "balance_kg": float(bal)}, "lots", lid))
            if pcs < 0:
                over_p += 1
                exceptions.append(("legacy_data", "warning", f"WB2 lot {lot_no} ({g} {plate}) sold more pieces than received ({pcs})",
                                   {"lot_no": lot_no, "pieces_balance": int(pcs)}, "lots", lid))

        cur.executemany("insert into public.exceptions (kind, severity, message, context, related_table, related_id) values (%s,%s,%s,%s,%s,%s)",
                        [(k, s, m, json.dumps(c, default=str), t, i) for k, s, m, c, t, i in exceptions])

        # ---- verify
        cur.execute("""select count(distinct l.id), count(*) filter (where m.movement_type='receipt'), count(*) filter (where m.movement_type='sale'),
                              coalesce(sum(m.weight_kg) filter (where m.movement_type='receipt'),0),
                              coalesce(-sum(m.weight_kg) filter (where m.movement_type='sale'),0), coalesce(sum(m.weight_kg),0)
                       from public.lots l join public.stock_movements m on m.lot_id = l.id where l.stock_book_id = %s""", (book_id,))
        n_lots, n_rec, n_sale, kg_in, kg_out, kg_bal = cur.fetchone()
        exp_in = sum(f(r["sheet_wt"]) for r in lots_csv if r["receipt_date"])
        exp_out = sum(-f(m["weight_kg"]) for m in moves_csv if m["type"] == "sale")
        kinds = defaultdict(int)
        for k, s, *_ in exceptions:
            kinds[(k, s)] += 1
        print(f"lots {n_lots} (parsed {len(lots_csv)}, skipped {len(skipped)}) | receipts {n_rec} | sales {n_sale} (parsed {sum(1 for m in moves_csv if m['type']=='sale')})")
        print(f"received {kg_in:,.0f} kg (expected {exp_in:,.0f}) | sold {kg_out:,.0f} kg (expected {exp_out:,.0f}) | balance {kg_bal:,.0f} kg")
        print("skipped lots weight:", f"{sum(f(r['sheet_wt']) for r in skipped):,.0f} kg", "| lots over-sold by weight:", over_w, "| by pieces:", over_p)
        print("exceptions:", dict(kinds))
        ok = n_lots == len(lot_rows) and n_sale == len(sale_rows) and abs(float(kg_in) - exp_in) < 1 and abs(float(kg_out) - exp_out) < 1
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
