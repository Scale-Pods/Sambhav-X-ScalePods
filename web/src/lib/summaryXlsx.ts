import ExcelJS from "exceljs";
import type { SummaryRow } from "@/lib/analytics";
import { rangeLabel, unitLabel, type Filter } from "@/lib/filters";
import { date, mm } from "@/lib/format";

// The Summary page as an Excel file, laid out like the screen: a grade line with its subtotal, the thicknesses under it, a Total at the end.

type Totals = { opening: number; received: number; sold: number; closing: number; plates: number };
const sum = (list: SummaryRow[]): Totals => list.reduce((a, r) => ({ opening: a.opening + r.opening, received: a.received + r.received, sold: a.sold + r.sold, closing: a.closing + r.closing, plates: a.plates + r.plates }), { opening: 0, received: 0, sold: 0, closing: 0, plates: 0 });

const PURPLE = "FF442F65"; // the header colour of their own Summary sheet
const GRADE_FILL = "FFEDE9F4";
const TOTAL_FILL = "FFFBE9C8";
const LINE = { style: "thin" as const, color: { argb: "FFD9D2C6" } };
const BAD = "FFC0392B";

export async function summaryXlsx(rows: SummaryRow[], f: Filter, view: "sheet" | "period", asOf: string): Promise<Buffer> {
  const u = f.unit;
  const keys = view === "period" ? (["opening", "received", "sold", "closing"] as const) : (["received", "sold", "closing"] as const);
  const labels: Record<(typeof keys)[number], string> = view === "period"
    ? { opening: f.from ? `Opening (${date(f.from)})` : "Opening", received: "Received", sold: "Sold", closing: `Closing (${date(asOf)})` }
    : { opening: "", received: "Purchased", sold: "Sold", closing: "Balance" };
  const cols = 2 + keys.length + 1;
  const numFmt = u === "t" ? "[>=10000000]##\\,##\\,##\\,##0.0;[>=100000]##\\,##\\,##0.0;##,##0.0" : "[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0";
  const conv = (kg: number) => (u === "t" ? Math.round(kg) / 1000 : Math.round(kg));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sambhav Stock";
  const ws = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  ws.columns = [{ width: 24 }, { width: 14 }, ...keys.map(() => ({ width: 19 })), { width: 12 }];

  const title = ws.addRow([view === "period" ? `Stock statement, ${rangeLabel(f)}` : `Position on ${date(asOf)}`]);
  title.font = { bold: true, size: 14 };
  const filters = [f.book ? `Book ${f.book}` : "All books", f.grades.length ? f.grades.join(", ") : "all grades", f.tmin != null || f.tmax != null ? `${f.tmin ?? "…"} to ${f.tmax ?? "…"} mm` : "all thicknesses", `weights in ${unitLabel(u) === "t" ? "tonnes" : "kg"}`];
  const sub = ws.addRow([filters.join("  ·  ")]);
  sub.font = { color: { argb: "FF6B6B6B" }, size: 10 };
  ws.addRow([]);

  const head = ws.addRow(["Grade", "Thickness", ...keys.map((k) => `${labels[k]} (${unitLabel(u)})`), "Plates left"]);
  head.height = 22;
  head.eachCell((c, i) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } };
    c.alignment = { vertical: "middle", horizontal: i > 2 ? "right" : "left", wrapText: true };
  });

  const put = (label: string, thk: string, t: Totals, opts: { fill?: string; bold?: boolean; negRed?: boolean; muted?: boolean }) => {
    const r = ws.addRow([label, thk, ...keys.map((k) => conv(t[k])), t.plates]);
    r.eachCell({ includeEmpty: true }, (c, i) => {
      if (i > cols) return;
      c.border = { bottom: LINE };
      if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
      c.font = { bold: opts.bold, color: opts.muted && i === cols ? { argb: "FF6B6B6B" } : undefined };
      if (i > 2) { c.alignment = { horizontal: "right" }; c.numFmt = i === cols ? "0" : numFmt; }
    });
    if (opts.negRed) {
      const ci = 3 + keys.indexOf("closing");
      if (t.closing < -0.5) r.getCell(ci).font = { bold: true, color: { argb: BAD } };
    }
    return r;
  };

  const byGrade = new Map<string, SummaryRow[]>();
  rows.forEach((r) => byGrade.set(r.grade, [...(byGrade.get(r.grade) ?? []), r]));
  for (const [grade, list] of byGrade) {
    put(grade, "", sum(list), { fill: GRADE_FILL, bold: true });
    for (const r of list) put("", `${mm(r.thk)} mm`, r, { negRed: true, muted: true });
  }
  const total = put("Total", "", sum(rows), { fill: TOTAL_FILL, bold: true });
  total.eachCell({ includeEmpty: true }, (c, i) => { if (i <= cols) c.border = { top: { style: "medium", color: { argb: PURPLE } }, bottom: LINE }; });

  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
