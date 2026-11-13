import "server-only";
import ExcelJS from "exceljs";
import type { Section } from "./stockSheet";

// The stock sheet view as an Excel file, laid out like the stock book itself: one worksheet per grade tab, a block per thickness, and in each block
// PURCHASE | SALES | BALANCE side by side, with the totals under each.

const STEEL = "FF2B3A4A", GREEN = "FFE3F3EA", AMBER = "FFFBEFD8", BLUE = "FFE3EFF7", GREY = "FFEEF1F5";
const LINE = { style: "thin" as const, color: { argb: "FFD3D9E0" } };

const PUR = ["Date", "Thk", "Wid", "Len", "Nos", "Wt", "Heat no", "Plate no", "Cert", "HSN", "Rate"];
const SALE = ["Date", "Inv no", "V. no", "Thk", "Wid", "Len", "Nos", "Wt", "Plot", "Heat / plate", "Notes"];
const BAL = ["Plot", "Thk", "Wid", "Len", "Nos", "Wt", "Heat / plate"];
const GAP = 1;
const COL = { pur: 1, sale: 1 + PUR.length + GAP, bal: 1 + PUR.length + GAP + SALE.length + GAP };
const WIDTHS = [11, 6, 8, 8, 6, 9, 14, 12, 8, 9, 8, 2, 11, 10, 10, 6, 8, 8, 6, 9, 10, 14, 28, 2, 9, 6, 8, 8, 6, 9, 14];

const date = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z") : null);

export type TabData = { tab: string; sections: Section[] };

export async function stockSheetXlsx(book: string, tabs: TabData[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sambhav Stock";
  const used = new Set<string>();
  for (const t of tabs) {
    let name = t.tab.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Tab";
    while (used.has(name.toLowerCase())) name = name.slice(0, 26) + "_" + (used.size % 100);
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 0 }] });
    WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    for (const s of t.sections) {
      let r = ws.rowCount + 1;
      // the thickness title across the whole block
      ws.mergeCells(r, 1, r, COL.bal + BAL.length - 1);
      const title = ws.getCell(r, 1);
      title.value = `${s.thk} MM`; title.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 }; title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STEEL } };
      r++;
      const block = (col: number, caption: string, fill: string, head: string[]) => {
        ws.mergeCells(r, col, r, col + head.length - 1);
        const c = ws.getCell(r, col); c.value = caption; c.font = { bold: true, size: 10 }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        head.forEach((h, i) => {
          const x = ws.getCell(r + 1, col + i); x.value = h; x.font = { bold: true, size: 10 }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } }; x.border = { bottom: LINE };
          x.alignment = { horizontal: ["Thk", "Wid", "Len", "Nos", "Wt", "Rate"].includes(h) ? "right" : "left" };
        });
      };
      block(COL.pur, "PURCHASE STOCK", GREEN, PUR); block(COL.sale, "SALES STOCK", AMBER, SALE); block(COL.bal, "BALANCE STOCK", BLUE, BAL);
      const top = r + 2;
      const n = Math.max(s.purchases.length, s.sales.length, s.balance.length);
      s.purchases.forEach((p, i) => {
        const row = ws.getRow(top + i), c = COL.pur;
        row.getCell(c).value = date(p.date); row.getCell(c).numFmt = "dd-mm-yy";
        row.getCell(c + 1).value = p.thk; row.getCell(c + 2).value = p.wid; row.getCell(c + 3).value = p.len; row.getCell(c + 4).value = p.nos; row.getCell(c + 5).value = p.wt;
        row.getCell(c + 6).value = p.heat; row.getCell(c + 7).value = p.plate;
        row.getCell(c + 8).value = p.links.length ? { text: p.links.map((l) => l.label).join(" "), hyperlink: p.links[0].url } : null;
        row.getCell(c + 9).value = p.hsn; row.getCell(c + 10).value = p.rate;
        [c + 2, c + 3, c + 4, c + 5].forEach((k) => { row.getCell(k).numFmt = "#,##0"; });
        row.getCell(c + 10).numFmt = "0.00";
      });
      s.sales.forEach((p, i) => {
        const row = ws.getRow(top + i), c = COL.sale;
        row.getCell(c).value = date(p.date || null); row.getCell(c).numFmt = "dd-mm-yy";
        row.getCell(c + 1).value = p.inv; row.getCell(c + 2).value = p.vno; row.getCell(c + 3).value = p.thk; row.getCell(c + 4).value = p.wid; row.getCell(c + 5).value = p.len;
        row.getCell(c + 6).value = p.nos; row.getCell(c + 7).value = p.wt; row.getCell(c + 8).value = p.plot; row.getCell(c + 9).value = p.ident;
        row.getCell(c + 10).value = p.adjustment ? "Count adjustment" : p.note;
        [c + 4, c + 5, c + 6, c + 7].forEach((k) => { row.getCell(k).numFmt = "#,##0"; });
      });
      s.balance.forEach((p, i) => {
        const row = ws.getRow(top + i), c = COL.bal;
        row.getCell(c).value = p.plot; row.getCell(c + 1).value = p.thk; row.getCell(c + 2).value = p.wid; row.getCell(c + 3).value = p.len; row.getCell(c + 4).value = p.nos; row.getCell(c + 5).value = p.wt; row.getCell(c + 6).value = p.ident;
        [c + 2, c + 3, c + 4, c + 5].forEach((k) => { row.getCell(k).numFmt = "#,##0"; });
      });
      // the totals under each block
      const tr = ws.getRow(top + n);
      const total = (col: number, at: number, label: string, v: number) => { const l = tr.getCell(col + at - 1); l.value = label; l.font = { bold: true, size: 10 }; l.alignment = { horizontal: "right" }; const x = tr.getCell(col + at); x.value = v; x.numFmt = "#,##0"; x.font = { bold: true }; };
      total(COL.pur, 5, "Total purchase", s.totals.pur); total(COL.sale, 7, "Total sale", s.totals.sale); total(COL.bal, 5, "Total balance", s.totals.bal);
      ws.getRow(top + n + 1).height = 8; // a little room before the next thickness
    }
  }
  if (tabs.length === 0) wb.addWorksheet(book).getCell(1, 1).value = "Nothing in this book.";
  return Buffer.from(await wb.xlsx.writeBuffer());
}
