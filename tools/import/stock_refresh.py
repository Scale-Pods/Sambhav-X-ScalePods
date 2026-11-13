"""Bring the stock book up to date with the LIVE stock sheets (WB1 STOCK IMS Admin, WB2 STOCK SPF & RS). Additive and safe.

  python tools/import/stock_refresh.py            dry run: reads the live sheets, compares them with the database, prints and writes the differences
  python tools/import/stock_refresh.py --commit   applies the safe part

What it does: reads both sheets live (typed values), runs the same parsers as the first load (wb1_parse.py / wb2_parse.py), and matches every
plate in the sheet to a plate already in the database by its heat / plate number + grade + size (never by row number: rows move).
  - a plate in the sheet that the database does not have          -> ADDED (lot + receipt) with its sales
  - a sale in the sheet that the database does not have on a plate -> ADDED (sale movement)
  - everything else (a plate that is in the database but no longer in the sheet, a sale or weight that differs, a tab the parsers do not read)
    is only LISTED in the report: nothing is deleted or changed, so counts and corrections made in the app are never overwritten.
The stock_movements balance trigger is switched off for this transaction only (as in the first load), then switched back on.
"""
import io
import json
import os
import re
import sys
import uuid
from collections import defaultdict
from datetime import date
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sync"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
if (sys.stdout.encoding or '').lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import live_book  # noqa: E402
import sheets_sync  # noqa: E402
import wb1_parse  # noqa: E402
import wb2_parse  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
COMMIT = "--commit" in sys.argv
TODAY = date.today().isoformat()

# the live tab names differ a little from the 8 Oct copy ("GR 11 A/J" for "GR 11 AJ")
WB1_TABS = {
    "GR. 11": "SA 387 GR 11 CL2", "GR 11 A/J": "SA 387 GR 11 CL2", "GR. 22": "SA 387 GR 22 CL2", "GR 22 - A/J": "SA 387 GR 22 CL2",
    "16M03": "16M03 PLATE", "GR. 12  W": "SA 387 GR 12 CL2", "GR. 5": "SA 387 GR 5 CL2", "GR. 9": "SA 387 GR 9", "GR. 91": "SA 387 GR 91",
    "A36": "A36", "SA 516 GR 70": "SA 516 GR 70",
}
NOT_READ = {"MIX GRADE": "different layout", "MANGANESE PLATE": "no heat numbers", "Corten": "hidden, small", "Incoming": "PO tracking, not stock"}


def f(v):
    return float(v) if v not in (None, "") else None


def hsn(v):
    return v[:-2] if v and v.endswith(".0") else (v or None)


def keyset(lot, book):
    if book == "WB1":
        return [wb1_parse.norm(t) for t in wb1_parse.tokens(lot["plate_no"]) + wb1_parse.tokens(lot["heat_no"]) if wb1_parse.norm(t)]
    return [wb2_parse.norm(lot["plate_no"] or lot["heat_no"])]


def match(live, db, book):
    """live lots vs database lots -> {live index: db index}. Passes from strict to loose; each database plate is used once."""
    taken, out = set(), {}
    index = defaultdict(list)
    for j, d in enumerate(db):
        for k in keyset(d, book):
            index[k].append(j)

    def passes():
        yield lambda l, d: (d["grade_raw"] == l["grade"] and d["thk"] == l["thickness_mm"] and d["wid"] == l["width_mm"] and d["len"] == l["length_mm"] and str(d["receipt_date"]) == str(l["receipt_date"]))
        yield lambda l, d: (d["grade_raw"] == l["grade"] and d["thk"] == l["thickness_mm"] and d["wid"] == l["width_mm"] and d["len"] == l["length_mm"])
        yield lambda l, d: (d["grade_raw"] == l["grade"] and d["thk"] == l["thickness_mm"])
        yield lambda l, d: True

    for ok in passes():
        for i, l in enumerate(live):
            if i in out:
                continue
            cands = []
            for k in keyset(l, book):
                cands += [j for j in index.get(k, []) if j not in taken]
            for j in dict.fromkeys(cands):
                if ok(l, db[j]):
                    out[i] = j
                    taken.add(j)
                    break
    return out


def main() -> None:
    sheets, _ = sheets_sync.google()
    with psycopg.connect(sheets_sync.db_url()) as conn:
        cur = conn.cursor()
        cur.execute("select key, spreadsheet_id from public.sheet_sources where key in ('wb1_stock_ims','wb2_stock_spf_rs')")
        sid = dict(cur.fetchall())

        print("reading the live sheets ...")
        v1, f1 = live_book.fetch(sheets, sid["wb1_stock_ims"], set(WB1_TABS))
        lots1, sales1, alloc1, exc1, unmatched1, _ = wb1_parse.parse(v1, f1, {t: g for t, g in WB1_TABS.items() if t in v1})
        v2, f2 = live_book.fetch(sheets, sid["wb2_stock_spf_rs"], set(wb2_parse.TABS))
        lots2, moves2, exc2 = wb2_parse.parse(v2, f2)
        print(f"WB1 live: {len(lots1)} plates, {sum(l['sheet_wt'] for l in lots1):,.0f} kg received, {len(alloc1)} sale lines | WB2 live: {len(lots2)} plates, {sum(l['sheet_wt'] for l in lots2):,.0f} kg, {sum(1 for m in moves2 if m['type']=='sale')} sale lines")

        cur.execute("select id, owner_entity_id, code from public.stock_books where code in ('WB1','WB2')")
        books = {c: (i, e) for i, e, c in cur.fetchall()}
        cur.execute("select code, id from public.grades")
        grade_id = dict(cur.fetchall())
        # a grade the sheet writes differently from our list ("SA 537 CL 1" for "SA537 CL1 PLATE") is found through its aliases, so no second grade is ever made for it
        cur.execute("select alias_norm, grade_id from public.grade_aliases")
        alias_grade = dict(cur.fetchall())

        def grade_of(name):
            return grade_id.get(name) or alias_grade.get(re.sub(r"[^A-Z0-9]", "", (name or "").upper()))

        report, plan = [], {}
        for code, live, moves in (("WB1", lots1, alloc1), ("WB2", lots2, moves2)):
            bid = books[code][0]
            cur.execute("""select l.id, l.lot_no, l.grade_raw, l.thickness_mm::float8, l.width_mm::float8, l.length_mm::float8, l.heat_no, l.plate_no, l.receipt_date::text,
                                  coalesce(l.invoice_weight_kg, l.theoretical_weight_kg)::float8
                             from public.lots l where l.stock_book_id = %s""", (bid,))
            db = [dict(id=r[0], lot_no=r[1], grade_raw=r[2], thk=r[3], wid=r[4], len=r[5], heat_no=r[6], plate_no=r[7], receipt_date=r[8], w=r[9]) for r in cur.fetchall()]
            # a sale posted from a challan in the app carries its challan number (dispatches.challan_no): the same challan in the sheet is that sale, not a new one.
            # A sale that was taken back by a reversal no longer counts.
            cur.execute("""select m.lot_id, m.pieces, m.weight_kg::float8, m.movement_date::text, x.challan_no
                             from public.stock_movements m join public.lots l on l.id = m.lot_id
                             left join public.dispatch_lines dl on dl.id = m.dispatch_line_id
                             left join public.dispatches x on x.id = dl.dispatch_id and x.status <> 'cancelled'
                            where l.stock_book_id = %s and m.movement_type = 'sale'
                              and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)""", (bid,))
            db_sales = defaultdict(list)
            for lid, p, w, d, vno in cur.fetchall():
                db_sales[lid].append([p, w, d, False, vno])

            mp = match(live, db, code)
            new_lots = [i for i in range(len(live)) if i not in mp]
            used_db = set(mp.values())
            gone = [d for j, d in enumerate(db) if j not in used_db]

            # sales: WB1 moves carry lot_index; WB2 moves carry the plate key + tab
            live_sales = defaultdict(list)
            if code == "WB1":
                for a in moves:
                    live_sales[a["lot_index"]].append(a)
            else:
                idx = {(l["tab"], l["key"]): i for i, l in enumerate(live)}
                for m in moves:
                    if m["type"] == "sale" and (m["tab"], m["key"]) in idx:
                        live_sales[idx[(m["tab"], m["key"])]].append(m)
            new_sales, sale_missing, wchg = [], 0, []
            for i, l in enumerate(live):
                if i not in mp:
                    new_sales += [(i, s) for s in live_sales.get(i, [])]
                    continue
                d = db[mp[i]]
                if d["w"] is not None and abs((d["w"] or 0) - l["sheet_wt"]) > 1:
                    wchg.append((d["lot_no"], d["plate_no"] or d["heat_no"], d["w"], l["sheet_wt"]))
                have = db_sales.get(d["id"], [])
                for s in live_sales.get(i, []):
                    w = abs(s["weight_kg"])
                    svno = re.sub(r"[^A-Z0-9]", "", str(s.get("vno") or "").upper())
                    hit = (next((h for h in have if not h[3] and h[4] and re.sub(r"[^A-Z0-9]", "", str(h[4]).upper()) == svno), None) if svno else None) \
                        or next((h for h in have if not h[3] and abs(abs(h[1]) - w) < 0.6 and h[2] == (s["date"].isoformat() if hasattr(s["date"], "isoformat") else s["date"])), None) \
                        or next((h for h in have if not h[3] and abs(abs(h[1]) - w) < 0.6), None)
                    if hit:
                        hit[3] = True
                    else:
                        new_sales.append((i, s))
                sale_missing += sum(1 for h in have if not h[3])
            plan[code] = dict(live=live, mp=mp, new_lots=new_lots, new_sales=new_sales, db=db)
            kg_new = sum(live[i]["sheet_wt"] for i in new_lots)
            kg_sales = sum(abs(s["weight_kg"]) for _, s in new_sales)
            kg_gone = sum(d["w"] or 0 for d in gone)
            print(f"\n{code}: database {len(db)} plates | live {len(live)} | matched {len(mp)}")
            print(f"  to ADD: {len(new_lots)} plates ({kg_new:,.0f} kg), {len(new_sales)} sale lines ({kg_sales:,.0f} kg)")
            print(f"  only LISTED: {len(gone)} database plates not found in the sheet now ({kg_gone:,.0f} kg), {sale_missing} database sale lines not in the sheet, {len(wchg)} plates with a different weight")
            report += [(code, "added plate", live[i]["tab"], live[i]["row"], live[i]["plate_no"] or live[i]["heat_no"], live[i]["sheet_wt"]) for i in new_lots]
            report += [(code, "added sale", live[i]["tab"], s["row"], live[i]["plate_no"] or live[i]["heat_no"], abs(s["weight_kg"])) for i, s in new_sales]
            report += [(code, "not in sheet now", d["grade_raw"], d["lot_no"], d["plate_no"] or d["heat_no"], d["w"]) for d in gone]
            report += [(code, "weight differs", "", n, k, f"{a} -> {b}") for n, k, a, b in wchg]

        import csv
        DATA.mkdir(parents=True, exist_ok=True)  # the data folder is not in the repository, so it is missing on a fresh machine (the daily run)
        with open(DATA / "stock-refresh-report.csv", "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(["book", "what", "tab / grade", "row / lot", "plate or heat", "kg"])
            w.writerows(report)
        print(f"\nfull list: {DATA / 'stock-refresh-report.csv'}")

        if not COMMIT:
            print("dry run: nothing written (use --commit to apply the ADDED part)")
            return

        cur.execute("alter table public.stock_movements disable trigger stock_movements_balance")
        added_lots = added_sales = 0
        exceptions = []
        for code, p in plan.items():
            bid, eid = books[code]
            live, mp = p["live"], p["mp"]
            cur.execute("insert into public.import_batches (source_file, source_tab, row_count, note) values (%s,%s,%s,%s) returning id",
                        (f"live sheet {code}", "all stock tabs", len(p["new_lots"]) + len(p["new_sales"]), f"{code} refreshed from the live sheet on {TODAY}: new plates and sales only"))
            batch = cur.fetchone()[0]
            new_id = {}
            for i in p["new_lots"]:
                l = live[i]
                if not l["receipt_date"]:
                    exceptions.append(("legacy_data", "warning", f"{code} live {l['tab']} row {l['row']}: purchase has no receipt date, so it was not added", {"tab": l["tab"], "row": l["row"]}, None, None))
                    continue
                gid = grade_of(l["grade"])
                if gid is None:
                    exceptions.append(("legacy_data", "warning", f"{code} live {l['tab']} row {l['row']}: grade {l['grade']} is not in the grade list, so it was not added", {"tab": l["tab"], "row": l["row"]}, None, None))
                    continue
                lid = uuid.uuid4()
                new_id[i] = lid
                rd = l["receipt_date"] if isinstance(l["receipt_date"], str) else l["receipt_date"].isoformat()
                if code == "WB1":
                    inv_w, theo = (l["sheet_wt"], None) if l["weight_source"] == "typed" else (None, l["sheet_wt"])
                    remarks = "Added from the live WB1 sheet" + (f"; class {l['cls']}" if l["cls"] else "") + (f"; make {l['make']}" if l["make"] else "")
                    tc = None
                else:
                    inv_w, theo, remarks, tc = l["invoice_weight_kg"], l["theoretical_weight_kg"], "Added from the live WB2 sheet", l["tc_no"]
                cur.execute("""insert into public.lots (id, stock_book_id, entity_id, origin, grade_id, grade_raw, thickness_mm, width_mm, length_mm, heat_no, plate_no, tc_no,
                                                       receipt_date, pieces_received, invoice_weight_kg, theoretical_weight_kg, hsn_code, remarks)
                               values (%s,%s,%s,'purchase',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (lid, bid, eid, gid, l["grade"], l["thickness_mm"], l["width_mm"], l["length_mm"], l["heat_no"], l["plate_no"], tc, rd,
                             l["pieces"], inv_w, theo, hsn(l["hsn"]), remarks))
                cur.execute("insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note) values (%s,'receipt',%s,%s,%s,%s)",
                            (lid, l["pieces"] or 0, l["sheet_wt"], rd, f"{code} live {l['tab']} row {l['row']}: purchase (added {TODAY})"))
                raw = {k: l.get(k) for k in ("link", "mtc_no", "make", "cls", "rate_per_kg", "purchase_inv", "hsn", "weight_source", "sheet_wt", "keys", "tc_link", "con_mtc", "con_link", "tc_no") if k in l}
                cur.execute("insert into public.legacy_refs (table_name, record_id, import_batch_id, source_tab, source_row, raw) values ('lots',%s,%s,%s,%s,%s)",
                            (lid, batch, l["tab"], l["row"], json.dumps(raw, default=str)))
                added_lots += 1
            for i, s in p["new_sales"]:
                l = live[i]
                lid = new_id.get(i) or (p["db"][mp[i]]["id"] if i in mp else None)
                if lid is None:
                    continue
                d = s["date"]
                d = d if isinstance(d, str) or d is None else d.isoformat()
                note = f"{code} live {l['tab']} row {s['row']}: invoice {s.get('inv')}, V.NO {s.get('vno')} (added {TODAY})"
                if s.get("buyer"):
                    note += f", buyer {s['buyer']}"
                if not d:
                    d = l["receipt_date"] if isinstance(l["receipt_date"], str) else l["receipt_date"].isoformat()
                    note += "; DATE UNKNOWN in the sheet, placed on the plate's receipt date"
                    exceptions.append(("legacy_data", "warning", f"{code} live {l['tab']} row {s['row']}: sale has no date", {"tab": l["tab"], "row": s["row"]}, "lots", lid))
                cur.execute("insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note) values (%s,'sale',%s,%s,%s,%s)",
                            (lid, int(s["pieces"]), s["weight_kg"], d, note))
                added_sales += 1
        cur.execute("alter table public.stock_movements enable trigger stock_movements_balance")

        cur.execute("""select l.lot_no, l.grade_raw, coalesce(l.plate_no, l.heat_no), sum(m.weight_kg) filter (where m.weight_kg > 0), sum(m.weight_kg)
                         from public.lots l join public.stock_movements m on m.lot_id = l.id
                        where m.note like %s group by l.id having sum(m.weight_kg) < 0""", (f"%(added {TODAY})",))
        for no, g, k, rec, bal in cur.fetchall():
            if rec:
                exceptions.append(("weight_warning", "warning", f"Lot {no} ({g} {k}) sold {-bal:.0f} kg more than received", {"lot_no": no, "balance_kg": float(bal)}, None, None))
        if exceptions:
            # the same plate is skipped again on every daily run until the sheet is fixed: a note that is already in the review list is not added twice
            cur.execute("select message from public.exceptions where message = any(%s)", ([e[2] for e in exceptions],))
            known = {r[0] for r in cur.fetchall()}
            exceptions = [e for e in exceptions if e[2] not in known]
        if exceptions:
            cur.executemany("insert into public.exceptions (kind, severity, message, context, related_table, related_id) values (%s,%s,%s,%s,%s,%s)",
                            [(k, s, m, json.dumps(c, default=str), t, i) for k, s, m, c, t, i in exceptions])
        conn.commit()
        print(f"COMMITTED: {added_lots} plates and {added_sales} sale lines added, {len(exceptions)} notes for review")


if __name__ == "__main__":
    main()
