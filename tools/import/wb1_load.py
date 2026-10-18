"""Load the WB1 stock book (SPF alloy plates) into Supabase from the CSVs written by wb1_parse.py.

Run `python tools/import/wb1_parse.py` first. Reads DATABASE_URL from .env.local.
Default is a dry run that rolls back; pass --commit to keep the data. Same rules as wb2_load.py:
  - one lot + one receipt movement per purchase row that has a receipt date and a heat / plate number
  - sale movements as parsed; a sale that points at a lot that was not loaded is not loaded and is listed as an exception
  - the sheet is loaded as it stands; doubtful rows (over-sold lots, undated sales, shared-heat sales) go to the exceptions table
  - every row is tagged back to its tab and row in legacy_refs
The stock_movements balance trigger is switched off for this transaction only, then switched back on.
Mill / vendor are not in this sheet, so they stay empty; the MAKE column (AJ tabs) is kept in remarks.
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
SRC_FILE = "1_4_26 - 31_3_27 _ STOCK IMS Admin.xlsx"
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
    lots_csv = list(csv.DictReader(open(DATA / "wb1_lots.csv", encoding="utf-8-sig")))
    moves_csv = list(csv.DictReader(open(DATA / "wb1_movements.csv", encoding="utf-8-sig")))
    today = date.today().isoformat()

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        cur.execute("select id, owner_entity_id from public.stock_books where code = 'WB1'")
        book_id, entity_id = cur.fetchone()
        cur.execute("select count(*) from public.lots where stock_book_id = %s", (book_id,))
        if cur.fetchone()[0]:
            sys.exit("WB1 already has lots: refusing to load twice")

        grade_of = {}
        for code in {r["grade"] for r in lots_csv}:
            cur.execute("select id from public.grades where code = %s", (code,))
            row = cur.fetchone()
            if not row:
                cur.execute("insert into public.grades (code, family, is_plate, notes) values (%s, 'SA387', true, 'created from a WB1 tab; needs review') returning id", (code,))
                row = cur.fetchone()
                print("grade created:", code)
            grade_of[code] = row[0]

        batch = {}
        for tab in {r["tab"] for r in lots_csv}:
            cur.execute("insert into public.import_batches (source_file, source_tab, row_count, note) values (%s,%s,%s,%s) returning id",
                        (SRC_FILE, tab, sum(1 for r in lots_csv if r["tab"] == tab) + sum(1 for m in moves_csv if m["tab"] == tab),
                         "WB1 first load from the 8 Oct client copy"))
            batch[tab] = cur.fetchone()[0]

        exceptions = []
        lot_rows, lot_id = [], {}
        skipped = []
        for r in lots_csv:
            if not r["receipt_date"]:
                skipped.append(r)
                exceptions.append(("legacy_data", "warning", f"WB1 {r['tab']} row {r['row']}: purchase has no receipt date, so it was not loaded",
                                   {"tab": r["tab"], "row": int(r["row"]), "heat": r["heat_no"], "plate": r["plate_no"], "weight_kg": f(r["sheet_wt"])}, None, None))
                continue
            lid = uuid.uuid4()
            lot_id[r["lot_index"]] = (lid, r)
            lot_rows.append((lid, r))

        # rows the parser could not turn into stock: record them so nothing disappears silently
        for e in csv.DictReader(open(DATA / "wb1_exceptions.csv", encoding="utf-8-sig")):
            if "without heat" in e["problem"] or "never purchased" in e["problem"]:
                exceptions.append(("legacy_data", "error" if "never purchased" in e["problem"] else "warning", f"WB1 {e['tab']} row {e['row']}: {e['problem']}",
                                   {"tab": e["tab"], "row": int(e["row"]), "value": e["value"]}, None, None))

        sale_rows, dropped = [], []
        for m in moves_csv:
            hit = lot_id.get(m["lot_index"])
            if not hit:
                dropped.append(m)
                exceptions.append(("legacy_data", "warning", f"WB1 {m['tab']} row {m['row']}: sale points at a purchase that was not loaded, so it was not loaded",
                                   {"tab": m["tab"], "row": int(m["row"]), "weight_kg": f(m["weight_kg"])}, None, None))
                continue
            lid, lot = hit
            d = m["date"]
            note = f"WB1 {m['tab']} row {m['row']}: invoice {m['inv']}, V.NO {m['vno']}" + (f", buyer {m['buyer']}" if m["buyer"] else "") + (f", plot {m['plot']}" if m["plot"] else "")
            if m["notes"]:
                note += f"; sheet note: {m['notes']}"
            if m["shared"] == "True":
                note += "; one sale line named several heats, weight shared by remaining weight (estimate)"
                exceptions.append(("legacy_data", "info", f"WB1 {m['tab']} row {m['row']}: sale line names several heats; weight split is an estimate",
                                   {"tab": m["tab"], "row": int(m["row"])}, "lots", lid))
            if not d:
                d = lot["receipt_date"]
                note += "; DATE UNKNOWN in the sheet, placed on the lot's receipt date"
                exceptions.append(("legacy_data", "warning", f"WB1 {m['tab']} row {m['row']}: sale has no date", {"tab": m["tab"], "row": int(m["row"]), "invoice": m["inv"]}, "lots", lid))
            elif d > today:
                exceptions.append(("legacy_data", "warning", f"WB1 {m['tab']} row {m['row']}: sale dated in the future ({d})", {"tab": m["tab"], "row": int(m["row"]), "date": d}, "lots", lid))
            elif d < lot["receipt_date"]:
                exceptions.append(("legacy_data", "info", f"WB1 {m['tab']} row {m['row']}: sale dated {d} is before the receipt {lot['receipt_date']}",
                                   {"tab": m["tab"], "row": int(m["row"]), "sale_date": d, "receipt_date": lot["receipt_date"]}, "lots", lid))
            sale_rows.append((lid, m, d, note))

        cur.execute("alter table public.stock_movements disable trigger stock_movements_balance")
        cur.executemany("""insert into public.lots (id, stock_book_id, entity_id, origin, grade_id, grade_raw, thickness_mm, width_mm, length_mm,
                               heat_no, plate_no, receipt_date, pieces_received, invoice_weight_kg, theoretical_weight_kg, hsn_code, remarks)
                           values (%s,%s,%s,'purchase',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", [
            (lid, book_id, entity_id, grade_of[r["grade"]], r["grade"], f(r["thickness_mm"]), f(r["width_mm"]), f(r["length_mm"]),
             r["heat_no"] or None, r["plate_no"] or None, r["receipt_date"], int(r["pieces"]) if r["pieces"] else None,
             f(r["sheet_wt"]) if r["weight_source"] == "typed" else None, f(r["sheet_wt"]) if r["weight_source"] == "formula" else None, hsn(r["hsn"]),
             "Loaded from WB1 sheet" + (f"; class {r['cls']}" if r["cls"] else "") + (f"; make {r['make']}" if r["make"] else "")) for lid, r in lot_rows])
        cur.executemany("insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note) values (%s,'receipt',%s,%s,%s,%s)",
                        [(lid, int(r["pieces"]) if r["pieces"] else 0, f(r["sheet_wt"]), r["receipt_date"], f"WB1 {r['tab']} row {r['row']}: purchase") for lid, r in lot_rows])
        sale_rows.sort(key=lambda x: (x[2], x[1]["tab"], int(x[1]["row"])))
        cur.executemany("insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note) values (%s,'sale',%s,%s,%s,%s)",
                        [(lid, int(m["pieces"]), f(m["weight_kg"]), d, note) for lid, m, d, note in sale_rows])
        cur.execute("alter table public.stock_movements enable trigger stock_movements_balance")

        cur.executemany("insert into public.legacy_refs (table_name, record_id, import_batch_id, source_tab, source_row, raw) values ('lots',%s,%s,%s,%s,%s)",
                        [(lid, batch[r["tab"]], r["tab"], int(r["row"]),
                          json.dumps({k: r[k] for k in ("link", "mtc_no", "make", "cls", "rate_per_kg", "purchase_inv", "hsn", "weight_source", "sheet_wt", "keys")})) for lid, r in lot_rows])

        cur.execute("""select l.id, l.lot_no, l.grade_raw, coalesce(l.plate_no, l.heat_no), sum(m.weight_kg) filter (where m.weight_kg > 0), sum(m.weight_kg), sum(m.pieces)
                       from public.lots l join public.stock_movements m on m.lot_id = l.id where l.stock_book_id = %s
                       group by l.id having sum(m.weight_kg) < 0 or sum(m.pieces) < 0""", (book_id,))
        over_w = over_p = 0
        for lid, lot_no, g, key, rec, bal, pcs in cur.fetchall():
            pct = -bal / rec * 100 if bal < 0 else 0
            if pct > 2:
                over_w += 1
                exceptions.append(("weight_warning", "error" if pct > 5 else "warning", f"WB1 lot {lot_no} ({g} {key}) sold {-bal:.0f} kg more than received ({pct:.1f}%)",
                                   {"lot_no": lot_no, "received_kg": float(rec), "balance_kg": float(bal)}, "lots", lid))
            if pcs < 0:
                over_p += 1
                exceptions.append(("legacy_data", "warning", f"WB1 lot {lot_no} ({g} {key}) sold more pieces than received ({pcs})", {"lot_no": lot_no, "pieces_balance": int(pcs)}, "lots", lid))
        cur.executemany("insert into public.exceptions (kind, severity, message, context, related_table, related_id) values (%s,%s,%s,%s,%s,%s)",
                        [(k, s, m, json.dumps(c, default=str), t, i) for k, s, m, c, t, i in exceptions])

        cur.execute("""select count(distinct l.id), count(*) filter (where m.movement_type='receipt'), count(*) filter (where m.movement_type='sale'),
                              coalesce(sum(m.weight_kg) filter (where m.movement_type='receipt'),0), coalesce(-sum(m.weight_kg) filter (where m.movement_type='sale'),0),
                              coalesce(sum(m.weight_kg),0)
                       from public.lots l join public.stock_movements m on m.lot_id = l.id where l.stock_book_id = %s""", (book_id,))
        n_lots, n_rec, n_sale, kg_in, kg_out, kg_bal = cur.fetchone()
        exp_in = sum(f(r["sheet_wt"]) for _, r in lot_rows)
        exp_out = sum(-f(m["weight_kg"]) for _, m, _, _ in sale_rows)
        kinds = defaultdict(int)
        for k, s, *_ in exceptions:
            kinds[(k, s)] += 1
        print(f"lots {n_lots} (parsed {len(lots_csv)}, skipped {len(skipped)} = {sum(f(r['sheet_wt']) for r in skipped):,.0f} kg) | receipts {n_rec} | sales {n_sale} (parsed {len(moves_csv)}, dropped {len(dropped)})")
        print(f"received {kg_in:,.0f} kg (expected {exp_in:,.0f}) | sold {kg_out:,.0f} kg (expected {exp_out:,.0f}) | balance {kg_bal:,.0f} kg")
        print("over-sold lots by weight (>2%):", over_w, "| by pieces:", over_p, "| exceptions:", dict(kinds))
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
