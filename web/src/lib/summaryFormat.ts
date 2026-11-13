import "server-only";
import { q } from "./db";
import { TAB_SQL } from "./stockSheet";

// The Summary laid out exactly like the Summary tab of each stock sheet (STOCK IMS Admin = WB1, STOCK SPF & RS = WB2):
// the same rows (grade, thickness band), the same columns, the same order. The rows come from the synced sheet's Summary tab (so the layout is always
// the sheet's own); every number that can be worked out from the stock book is worked out from it, live. Two things are taken from the sheet as typed
// there: the Avg Rate, and the purchases of earlier years (not shown; they only feed Conservative and Aggressive, because the app holds today's stock,
// not the old purchase history).

export type FmtRow = {
  grade: string; band: string; rate: number | null; rateText: string;
  pur: number | null;               // WB2 only: all purchases of this grade and thickness
  sale: number; bal: number; q: number[];
  cons: number | null; aggr: number | null; gap: number | null; // WB1 only
};
export type Fmt = {
  book: "WB1" | "WB2"; title: string; sheetName: string; withPur: boolean; withTargets: boolean;
  quarters: { label: string; range: string }[]; rows: FmtRow[];
  totals: { pur: number; sale: number; bal: number; q: number[]; cons: number; aggr: number; gap: number };
  leftOut: { kg: number; where: string } | null;
};

const SOURCE = { WB1: "wb1_stock_ims", WB2: "wb2_stock_spf_rs" } as const;
// the grade names of the sheet's Summary -> the stock tabs they add up (the stock sheets name some tabs a little differently)
const TABS: Record<"WB1" | "WB2", Record<string, string[]>> = {
  WB1: {
    "GR 11 U": ["GR. 11"], "16M03 U": ["16M03"], "GR 22 U": ["GR. 22"], "GR 12 U": ["GR. 12  W"], "GR 5": ["GR. 5"], "GR 91": ["GR. 91"], "GR 9": ["GR. 9"],
    "GR 11 A/J": ["GR 11 A/J", "GR 11 AJ"], "GR 22 A": ["GR 22 - A/J", "GR 22 - AJ"], "A 36": ["A36"],
  },
  WB2: { "SA 537": ["SA 537"], "ROCKSTAR 400": ["ROCKSTAR 400"], "ROCKSTAR 500": ["ROCKSTAR 500"], "690 QL": ["690 QL"] },
};
const QUARTERS = {
  WB1: { from: "2026-04-01", labels: [["26-27 Q1", "Apr–Jun 26"], ["26-27 Q2", "Jul–Sep 26"], ["26-27 Q3", "Oct–Dec 26"], ["26-27 Q4", "Jan–Mar 27"]] },
  WB2: { from: "2026-01-01", labels: [["25-26 Q4", "Jan–Mar 26"], ["26-27 Q1", "Apr–Jun 26"], ["26-27 Q2", "Jul–Sep 26"], ["26-27 Q3", "Oct–Dec 26"], ["26-27 Q4", "Jan–Mar 27"]] },
} as const;

const num = (s: string | undefined | null) => { const n = Number(String(s ?? "").replace(/[₹,\s]/g, "")); return Number.isFinite(n) ? n : null; };
/** "14 / 14.5 / 15 MM" -> [14, 14.5, 15] */
const bandOf = (label: string) => label.replace(/mm/i, "").split("/").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
const addMonths = (iso: string, m: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

export async function summaryFormat(book: "WB1" | "WB2"): Promise<Fmt | null> {
  const spine = await q<{ row_no: number; cells: string[] }>(
    `select row_no::int row_no, cells from public.sheet_rows where source_key = $1 and tab = 'Summary' and deleted_at is null and row_no >= 3 order by row_no`, [SOURCE[book]]);
  const lines = spine.filter((r) => (r.cells[0] ?? "").trim() !== "" && (r.cells[1] ?? "").trim() !== "");
  if (lines.length === 0) return null;
  const ql = QUARTERS[book];
  const starts = ql.labels.map((_, i) => addMonths(ql.from, 3 * i));
  const ends = starts.map((s) => addMonths(s, 3));
  const sale = `(m.movement_type::text not in ('receipt', 'opening_count'))`;
  const filters = starts.map((_, i) => `coalesce(-sum(m.weight_kg) filter (where ${sale} and m.movement_date >= $${2 + i}::date and m.movement_date < $${2 + starts.length + i}::date), 0) q${i}`).join(", ");
  const data = await q<Record<string, string>>(
    `select t.tab, t.thk::float8 thk, coalesce(sum(m.weight_kg) filter (where not ${sale}), 0) pur, coalesce(-sum(m.weight_kg) filter (where ${sale}), 0) sale_all, coalesce(sum(m.weight_kg), 0) bal, ${filters}
     from (select l.id, l.thickness_mm thk, l.stock_book_id, ${TAB_SQL} tab from public.lots l left join public.legacy_refs r on r.record_id = l.id and r.table_name = 'lots') t
       join public.stock_books b on b.id = t.stock_book_id and b.code = $1
       left join public.stock_movements m on m.lot_id = t.id
     where t.tab is not null group by t.tab, t.thk`, [book, ...starts, ...ends]);

  const grades = TABS[book];
  // every stock line goes to the sheet row of its grade whose thickness band holds it; one a little off (50.8 for "51") goes to the nearest row of that grade
  const owner = new Map<string, number>();
  const spineBands = lines.map((l) => ({ grade: l.cells[0].trim(), thks: bandOf(l.cells[1].trim()) }));
  for (const d of data) {
    let best = -1, bestGap = 0.61;
    spineBands.forEach((s, i) => {
      if (!(grades[s.grade] ?? []).includes(d.tab)) return;
      const gap = Math.min(...s.thks.map((x) => Math.abs(x - Number(d.thk))));
      if (gap < bestGap) { best = i; bestGap = gap; }
    });
    if (best >= 0) owner.set(`${d.tab}|${d.thk}`, best);
  }
  const rows: FmtRow[] = [];
  const used = new Set<string>(owner.keys());
  for (const [li, l] of lines.entries()) {
    const grade = l.cells[0].trim(), band = l.cells[1].trim();
    const hit = data.filter((d) => owner.get(`${d.tab}|${d.thk}`) === li);
    const sum = (k: string) => hit.reduce((a, d) => a + Number(d[k]), 0);
    const qs = starts.map((_, i) => sum(`q${i}`));
    const c = l.cells;
    let rateText = "", rate: number | null = null;
    const r0 = book === "WB1" ? c[6] : c[2];
    if (r0 != null && r0.trim() !== "") { rate = num(r0); rateText = rate != null && rate > 0 ? "₹" + rate.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
    const row: FmtRow = { grade, band, rate, rateText, pur: book === "WB2" ? sum("pur") : null, sale: book === "WB1" ? qs.reduce((a, b) => a + b, 0) : sum("sale_all"), bal: sum("bal"), q: qs, cons: null, aggr: null, gap: null };
    if (book === "WB1") {
      // two months of what was bought: last year (Conservative) or the average of the four years (Aggressive), from the sheet's own purchase columns
      const yrs = [2, 3, 4, 5].map((i) => num(c[i]) ?? 0);
      row.cons = (yrs[3] * 2) / 12;
      row.aggr = (yrs.reduce((a, b) => a + b, 0) / 4) * 2 / 12;
      row.gap = row.bal - row.cons;
    }
    rows.push(row);
  }
  // stock the sheet's rows do not reach (a thickness with no row, or a tab the Summary does not list)
  const wanted = new Set(Object.values(grades).flat());
  const missed = data.filter((d) => !used.has(`${d.tab}|${d.thk}`));
  const missedKg = missed.reduce((a, d) => a + Number(d.bal), 0);
  const missedTabs = [...new Set(missed.filter((d) => Math.abs(Number(d.bal)) > 0.5).map((d) => (wanted.has(d.tab) ? `${d.tab} (a thickness with no row)` : d.tab)))];
  const t = rows.reduce((a, r) => ({
    pur: a.pur + (r.pur ?? 0), sale: a.sale + r.sale, bal: a.bal + r.bal, q: a.q.map((x, i) => x + r.q[i]), cons: a.cons + (r.cons ?? 0), aggr: a.aggr + (r.aggr ?? 0), gap: a.gap + (r.gap ?? 0),
  }), { pur: 0, sale: 0, bal: 0, q: starts.map(() => 0), cons: 0, aggr: 0, gap: 0 });
  return {
    book, withPur: book === "WB2", withTargets: book === "WB1",
    title: book === "WB1" ? "STOCK IMS Admin (WB1) · 1/4/26 – 31/3/27" : "STOCK SPF & RS (WB2) · 1/1/26 – 31/3/27",
    sheetName: book === "WB1" ? "WB1 Summary" : "WB2 Summary",
    quarters: ql.labels.map(([label, range]) => ({ label, range })), rows, totals: t,
    leftOut: Math.abs(missedKg) > 0.5 || missedTabs.length ? { kg: missedKg, where: missedTabs.join(", ") } : null,
  };
}
