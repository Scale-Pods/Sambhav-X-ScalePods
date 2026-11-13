import "server-only";
import ExcelJS from "exceljs";
import { rupeesInWords } from "./rupeesWords";

// The RTGS / NEFT request as a proper Excel file: sheet 1 is the form (one page, ready to print and sign), sheet 2 is the same payment as one row of a table.

export type Rtgs = {
  mode: "RTGS" | "NEFT"; date: string; // YYYY-MM-DD
  remitter: string; remitterAccount: string;
  holder: string; account: string; bank: string; branch: string; ifsc: string;
  amount: number; remarks: string; supplier: string; invoiceNo: string;
};

const LINE = { style: "thin" as const, color: { argb: "FF9AA5B1" } };
const HEAD = "FF1F2D3D", BAND = "FFEEF2F6";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}-${MON[Number(m) - 1]}-${y}`; };

export async function rtgsXlsx(p: Rtgs): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sambhav Stock";
  const ws = wb.addWorksheet("RTGS form", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  ws.columns = [{ width: 30 }, { width: 62 }];
  const section = (text: string) => {
    const r = ws.addRow([text]); ws.mergeCells(r.number, 1, r.number, 2);
    r.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; r.height = 20;
  };
  const row = (label: string, value: string | number | null, o: { bold?: boolean; fmt?: string; tall?: boolean; text?: boolean } = {}) => {
    const r = ws.addRow([label, value ?? ""]);
    r.getCell(1).font = { bold: true, size: 10 }; r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
    r.getCell(2).font = { bold: o.bold ?? false, size: 11 }; r.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    if (o.fmt) r.getCell(2).numFmt = o.fmt;
    if (o.text) r.getCell(2).numFmt = "@";
    [1, 2].forEach((c) => { r.getCell(c).border = { top: LINE, bottom: LINE, left: LINE, right: LINE }; });
    r.height = o.tall ? 34 : 22;
  };
  const t = ws.addRow(["HDFC Bank  ·  RTGS / NEFT Request Form"]); ws.mergeCells(t.number, 1, t.number, 2);
  t.getCell(1).font = { bold: true, size: 15 }; t.getCell(1).alignment = { horizontal: "center" }; t.height = 28;
  const sub = ws.addRow([`Prepared from ${p.supplier ? `the bill of ${p.supplier}` : "a supplier bill"}${p.invoiceNo ? `, invoice ${p.invoiceNo}` : ""}`]); ws.mergeCells(sub.number, 1, sub.number, 2);
  sub.getCell(1).font = { italic: true, size: 9, color: { argb: "FF55606D" } }; sub.getCell(1).alignment = { horizontal: "center" };
  ws.addRow([]);
  section("Request");
  row("Transfer by", p.mode === "RTGS" ? "☑ RTGS      ☐ NEFT" : "☐ RTGS      ☑ NEFT", { bold: true });
  row("Date", dmy(p.date));
  section("Remitter (our side)");
  row("Customer's name", p.remitter); row("Account no", p.remitterAccount, { text: true });
  section("Beneficiary (the supplier)");
  row("Name", p.holder, { bold: true }); row("Account no", p.account, { bold: true, text: true }); row("Re-confirm account no", p.account, { text: true });
  row("Bank name & branch", [p.bank, p.branch].filter(Boolean).join(", "), { tall: true }); row("IFSC code", p.ifsc, { bold: true }); row("A/c type", "☑ Resident      ☐ Non Resident      ☐ FCRA");
  section("Amount");
  row("In figures (₹)", p.amount, { bold: true, fmt: '"₹"#,##0.00' });
  row("In words", rupeesInWords(p.amount), { tall: true });
  row("Remarks", p.remarks, { tall: true });
  section("Beneficiary account name verification (tick one)");
  row("Option 1", "☐  HDFC Bank to verify the beneficiary bank account name", { tall: true });
  row("Option 2", "☐  Beneficiary account name is verified by the customer (we have checked the account number and IFSC)", { tall: true });
  section("Signature of authorised signatory");
  const sg = ws.addRow(["1st signatory\n\n\n", "2nd signatory\n\n\n"]); sg.height = 64;
  sg.eachCell((c) => { c.alignment = { vertical: "top", wrapText: true }; c.border = { top: LINE, bottom: LINE, left: LINE, right: LINE }; c.font = { size: 10 }; });
  const note = ws.addRow(["Bank use, seals and the terms are on the bank's own form; this sheet carries the details to copy onto it."]); ws.mergeCells(note.number, 1, note.number, 2);
  note.getCell(1).font = { italic: true, size: 9, color: { argb: "FF55606D" } };

  const tb = wb.addWorksheet("Payment row");
  tb.addRow(["Mode", "Date", "Beneficiary name", "Account no", "IFSC", "Bank", "Branch", "Amount (₹)", "Amount in words", "Remarks", "Supplier invoice no"]);
  tb.addRow([p.mode, new Date(p.date + "T00:00:00Z"), p.holder, p.account, p.ifsc, p.bank, p.branch, p.amount, rupeesInWords(p.amount), p.remarks, p.invoiceNo]);
  tb.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; });
  tb.getCell("B2").numFmt = "dd-mmm-yyyy"; tb.getCell("D2").numFmt = "@"; tb.getCell("H2").numFmt = "#,##0.00";
  [10, 13, 34, 20, 14, 22, 30, 16, 52, 30, 20].forEach((w, i) => { tb.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
