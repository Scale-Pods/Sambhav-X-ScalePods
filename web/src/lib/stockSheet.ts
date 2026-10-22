import "server-only";
import { q } from "./db";

// The stock books laid out the way the sheets are: one tab per grade, one section per thickness, and in each section
// PURCHASE | SALES | BALANCE side by side. Everything is built from the checked ledger, so the balance is calculated from the rows
// and cannot drift from them (the sheets' balance blocks are typed by hand).

export type BookTab = { tab: string; lots: number; balance_kg: number };

export async function stockBookTabs(book: string): Promise<BookTab[]> {
  const rows = await q<{ tab: string; lots: string; kg: string }>(
    `select r.source_tab tab, count(distinct l.id) lots, coalesce(sum(bal.kg), 0) kg
     from public.lots l
       join public.stock_books b on b.id = l.stock_book_id
       join public.legacy_refs r on r.record_id = l.id and r.table_name = 'lots'
       left join (select lot_id, sum(weight_kg) kg from public.stock_movements group by 1) bal on bal.lot_id = l.id
     where b.code = $1 group by r.source_tab order by min(l.lot_no)`, [book]);
  return rows.map((r) => ({ tab: r.tab, lots: Number(r.lots), balance_kg: Number(r.kg) }));
}

export type PurchaseRow = {
  lot_no: number; date: string | null; thk: number; wid: number | null; len: number | null; nos: number; wt: number;
  heat: string | null; plate: string | null; hsn: string | null; rate: number | null; links: { label: string; url: string }[];
};
export type SaleRow = {
  lot_no: number; date: string; inv: string | null; vno: string | null; thk: number; wid: number | null; len: number | null; nos: number; wt: number;
  plot: string | null; ident: string | null; note: string | null; adjustment: boolean;
};
export type BalanceRow = { lot_no: number; plot: string | null; thk: number; wid: number | null; len: number | null; nos: number; wt: number; ident: string | null };
export type Section = { thk: number; purchases: PurchaseRow[]; sales: SaleRow[]; balance: BalanceRow[]; totals: { pur: number; sale: number; bal: number } };

type Raw = {
  lot_id: string; lot_no: string; thk: string; wid: string | null; len: string | null; heat_no: string | null; plate_no: string | null; hsn: string | null;
  rd: string | null; yard: string | null; raw: Record<string, string | null> | null;
  mtype: string | null; md: string | null; wt: string | null; pcs: string | null; note: string | null;
};

const http = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);
const pick = (note: string | null, re: RegExp) => note?.match(re)?.[1]?.trim() ?? null;
const clean = (s: string | null) => (s ? s.replace(/\.0$/, "") : s);

export async function stockSheetTab(book: string, tab: string, search: string) {
  const like = search ? `%${search.replace(/[\\%_]/g, (m) => "\\" + m)}%` : null;
  const rows = await q<Raw>(
    `select l.id lot_id, l.lot_no, l.thickness_mm thk, l.width_mm wid, l.length_mm len, l.heat_no, l.plate_no, l.hsn_code hsn, l.receipt_date::text rd,
            y.code yard, r.raw, m.movement_type::text mtype, m.movement_date::text md, m.weight_kg wt, m.pieces pcs, m.note
     from public.lots l
       join public.stock_books b on b.id = l.stock_book_id
       join public.legacy_refs r on r.record_id = l.id and r.table_name = 'lots'
       left join public.yards y on y.id = l.yard_id
       left join public.stock_movements m on m.lot_id = l.id
     where b.code = $1 and r.source_tab = $2 and ($3::text is null or l.heat_no ilike $3 or l.plate_no ilike $3)
     order by l.thickness_mm, l.lot_no, m.seq`, [book, tab, like]);

  const sections = new Map<number, Section>();
  const sec = (thk: number) => {
    let s = sections.get(thk);
    if (!s) { s = { thk, purchases: [], sales: [], balance: [], totals: { pur: 0, sale: 0, bal: 0 } }; sections.set(thk, s); }
    return s;
  };
  const lots = new Map<string, { thk: number; row: Raw; wt: number; pcs: number }>();
  for (const r of rows) {
    const thk = Number(r.thk);
    const s = sec(thk);
    const ident = r.plate_no ?? r.heat_no;
    let lot = lots.get(r.lot_id);
    if (!lot) { lot = { thk, row: r, wt: 0, pcs: 0 }; lots.set(r.lot_id, lot); }
    if (r.mtype == null) continue;
    const wt = Number(r.wt), pcs = Number(r.pcs ?? 0);
    lot.wt += wt; lot.pcs += pcs;
    const dims = { thk, wid: r.wid == null ? null : Number(r.wid), len: r.len == null ? null : Number(r.len) };
    if (r.mtype === "receipt" || r.mtype === "opening_count") {
      const raw = r.raw ?? {};
      const links = [
        { label: "MTC", url: http(raw.link) }, { label: "TC", url: http(raw.tc_link) }, { label: "CON", url: http(raw.con_link) },
      ].filter((l): l is { label: string; url: string } => l.url != null);
      const rate = raw.rate_per_kg == null || raw.rate_per_kg === "" ? null : Number(raw.rate_per_kg);
      s.purchases.push({ lot_no: Number(r.lot_no), date: r.md, ...dims, nos: pcs, wt, heat: r.heat_no, plate: r.plate_no, hsn: clean(r.hsn), rate: Number.isFinite(rate) ? rate : null, links });
      s.totals.pur += wt;
    } else {
      const buyer = pick(r.note, /buyer ([^,;]+)/);
      const sheetNote = pick(r.note, /sheet note: (.+)$/);
      s.sales.push({
        lot_no: Number(r.lot_no), date: r.md ?? "", inv: clean(pick(r.note, /invoice ([^,;]+)/)), vno: pick(r.note, /V\.NO ([^,;]+)/), ...dims,
        nos: -pcs, wt: -wt, plot: pick(r.note, /plot ([^,;]+)/), ident, adjustment: r.mtype === "adjustment",
        note: r.mtype === "adjustment" ? (r.note ?? "Count adjustment") : [buyer, sheetNote].filter(Boolean).join(" · ") || null,
      });
      s.totals.sale += -wt;
    }
  }
  for (const { thk, row, wt, pcs } of lots.values()) {
    if (wt > 0.5 || pcs > 0) {
      sec(thk).balance.push({ lot_no: Number(row.lot_no), plot: row.yard, thk, wid: row.wid == null ? null : Number(row.wid), len: row.len == null ? null : Number(row.len), nos: pcs, wt, ident: row.plate_no ?? row.heat_no });
      sec(thk).totals.bal += wt;
    }
  }
  const out = [...sections.values()].sort((a, b) => a.thk - b.thk);
  for (const s of out) s.sales.sort((a, b) => a.date.localeCompare(b.date) || a.lot_no - b.lot_no);
  return {
    sections: out,
    totals: out.reduce((t, s) => ({ pur: t.pur + s.totals.pur, sale: t.sale + s.totals.sale, bal: t.bal + s.totals.bal }), { pur: 0, sale: 0, bal: 0 }),
  };
}
