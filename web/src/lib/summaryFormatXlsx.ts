import "server-only";
import ExcelJS from "exceljs";
import type { Fmt } from "./summaryFormat";

const dmy = (iso: string) => iso.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("-");

/** The Summary in the stock sheets' own layout, one worksheet per book: dark header, Total row under it, one row per grade and thickness. */
export async function summaryFormatXlsx(books: Fmt[], asOf: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sambhav Stock";
  for (const d of books) {
    const ws = wb.addWorksheet(d.sheetName, { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
    const head = d.withPur
      ? ["Grade", "THK", "Avg Rate", "Total Pur", "Total Sale", dmy(asOf), ...d.quarters.map((x) => `${x.label} (${x.range})`)]
      : ["Grade", "THK", "Avg Rate", "Total Sale", ...d.quarters.map((x) => `${x.label} (${x.range})`), dmy(asOf), "Conservative", "Aggressive", "Short (-) / extra"];
    const hr = ws.addRow(head);
    hr.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B2A63" } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
    hr.height = 32;
    const tot = d.withPur
      ? ["Total", "", "", d.totals.pur, d.totals.sale, d.totals.bal, ...d.totals.q]
      : ["Total", "", "", d.totals.sale, ...d.totals.q, d.totals.bal, d.totals.cons, d.totals.aggr, d.totals.gap];
    const tr = ws.addRow(tot);
    tr.font = { bold: true };
    tr.eachCell((c, i) => { if (i > 3) c.font = { bold: true, color: { argb: "FF1F4FBF" } }; });
    for (const r of d.rows) {
      const row = d.withPur
        ? [r.grade, r.band, r.rate, r.pur, r.sale, r.bal, ...r.q]
        : [r.grade, r.band, r.rate, r.sale, ...r.q, r.bal, r.cons, r.aggr, r.gap];
      const x = ws.addRow(row);
      x.getCell(3).numFmt = '"₹"#,##0.00;;';
      for (let i = 4; i <= row.length; i++) x.getCell(i).numFmt = "#,##0;-#,##0;0";
      if (d.withTargets) { x.getCell(row.length - 2).numFmt = "#,##0.00"; x.getCell(row.length - 1).numFmt = "#,##0.00"; if ((r.gap ?? 0) < -0.5) x.getCell(row.length).font = { color: { argb: "FFC0392B" }, bold: true }; }
    }
    ws.getColumn(1).width = 16; ws.getColumn(2).width = 20; ws.getColumn(3).width = 12;
    for (let i = 4; i <= head.length; i++) ws.getColumn(i).width = 15;
    for (let i = 3; i <= head.length; i++) { ws.getColumn(i).alignment = { horizontal: "right" }; }
    ws.getRow(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    for (const row of [ws.getRow(1)]) row.eachCell((c) => { c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
    if (d.leftOut) { ws.addRow([]); ws.addRow([`Not in any row above: ${Math.round(d.leftOut.kg)} kg${d.leftOut.where ? ` (${d.leftOut.where})` : ""}`]); }
    if (d.withTargets) ws.addRow(["Conservative = two months of last year's purchase; Aggressive = two months of the 4-year average purchase; last column = balance minus Conservative."]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
