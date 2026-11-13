import { NextResponse, type NextRequest } from "next/server";
import { plates, summary } from "@/lib/analytics";
import { reconciliation } from "@/lib/queries";
import { canExport, currentStaff } from "@/lib/auth";
import { parseFilter, todayIST } from "@/lib/filters";
import { readPlateQuery } from "@/lib/plateQuery";
import { isoDay } from "@/lib/money";
import { summaryXlsx } from "@/lib/summaryXlsx";
import { summaryFormat } from "@/lib/summaryFormat";
import { summaryFormatXlsx } from "@/lib/summaryFormatXlsx";
import { compare, partiesList, readTallyParams } from "@/lib/tally";
import { brokerageList, expensesList, gpayList, payablesList, pettyList, purchasesList, readPayParams, receivablesList, salesList } from "@/lib/payments";

// CSV downloads for the owner and administrators only: exports take data outside the system.
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection from cell text
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (head: string[], rows: unknown[][]) => "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
const kg = (v: number) => Math.round(v);

export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  let me;
  try {
    me = await currentStaff();
  } catch {
    me = null;
  }
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canExport(me.role)) return NextResponse.json({ error: "Only the owner or an administrator can download data" }, { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  if (kind === "summary-ims-xlsx") {
    const books: ("WB1" | "WB2")[] = sp.book === "WB1" || sp.book === "WB2" ? [sp.book] : ["WB1", "WB2"];
    const data = (await Promise.all(books.map((b) => summaryFormat(b)))).filter((x): x is NonNullable<typeof x> => x != null);
    if (data.length === 0) return NextResponse.json({ error: "The stock sheets' Summary tab has not been synced yet" }, { status: 404 });
    const file = await summaryFormatXlsx(data, todayIST());
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="sambhav-summary-stock-sheet-${todayIST()}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }
  if (kind === "summary-xlsx") {
    const f = parseFilter(sp, "fy");
    const view = sp.view === "period" ? "period" : "sheet";
    const rows = await summary(view === "period" ? f : { ...f, from: null }, null);
    const file = await summaryXlsx(rows, f, view, f.to ?? todayIST());
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="sambhav-summary-${view}-${todayIST()}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }
  let body: string;
  if (kind === "summary") {
    const f = parseFilter(sp, "fy");
    const period = sp.view === "period";
    const rows = await summary(period ? f : { ...f, from: null }, null);
    body = period
      ? csv(["Grade", "Thickness (mm)", "Opening (kg)", "Received (kg)", "Sold (kg)", "Closing (kg)", "Plates left"],
          rows.map((r) => [r.grade, r.thk, kg(r.opening), kg(r.received), kg(r.sold), kg(r.closing), r.plates]))
      : csv(["Grade", "Thickness (mm)", "Purchased (kg)", "Sold (kg)", "Balance (kg)", "Plates left"],
          rows.map((r) => [r.grade, r.thk, kg(r.received), kg(r.sold), kg(r.closing), r.plates]));
  } else if (kind === "plates") {
    const { rows } = await plates({ ...readPlateQuery(sp), page: 1, all: true });
    body = csv(["Plate no", "Heat no", "Grade", "Thickness (mm)", "Width (mm)", "Length (mm)", "Pieces", "Left (kg)", "Received", "Book"],
      rows.map((r) => [r.plate_no, r.heat_no, r.grade, Number(r.thk), r.wid && Number(r.wid), r.len && Number(r.len), r.pcs, kg(Number(r.kg)), String(r.receipt_date).slice(0, 10), r.book]));
  } else if (kind === "count") {
    const session = sp.session ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(session)) return NextResponse.json({ error: "Which count?" }, { status: 400 });
    const { rows } = await reconciliation(session);
    body = csv(["Plate / heat", "Grade", "Thickness (mm)", "Books at window start (kg)", "Counted (kg)", "Out before count (kg)", "In before count (kg)", "Opening worked back (kg)", "Difference (kg)", "Result", "Times counted"],
      rows.map((r) => [r.ident, r.grade, Number(r.thickness_mm), kg(Number(r.books_kg)), r.counted_kg == null ? "" : kg(Number(r.counted_kg)), kg(Number(r.out_before_kg)), kg(Number(r.in_before_kg)),
        r.opening_kg == null ? "" : kg(Number(r.opening_kg)), r.diff_kg == null ? "" : kg(Number(r.diff_kg)), r.status, r.count_lines]));
  } else if (kind.startsWith("pay-")) {
    const pp = { ...readPayParams(sp), all: true };
    const d = isoDay;
    const co = (e: string) => (e === "SAI" ? "Sai" : "SPF");
    if (kind === "pay-sales") {
      const { rows } = await salesList(pp);
      body = csv(["Invoice date", "Invoice no", "Company", "Customer", "Salesperson", "PO no", "Amount", "Credit days", "Due date", "Transporter", "Made by", "Checked by"],
        rows.map((r) => [d(r.invoice_date), r.invoice_no, co(r.entity), r.client, r.salesperson, r.po_no, r.amount, r.credit_days, d(r.due_date), r.transporter, r.made_by, r.checked_by]));
    } else if (kind === "pay-purchases") {
      const { rows } = await purchasesList(pp);
      body = csv(["Invoice date", "Invoice no", "Company", "Supplier", "Purchased for", "Amount", "Credit days", "Due date", "Broker", "Bought by", "Checked by", "Bill"],
        rows.map((r) => [d(r.invoice_date), r.invoice_no, co(r.entity), r.vendor, r.purchased_for, r.amount, r.credit_days, d(r.due_date), r.broker, r.purchased_by, r.checked_by, r.file_url]));
    } else if (kind === "pay-expenses") {
      const { rows } = await expensesList(pp);
      body = csv(["Date", "Type", "Company", "Paid to", "Invoice no", "Amount", "TDS", "Checked by", "Bill"],
        rows.map((r) => [d(r.invoice_date), r.category, co(r.entity), r.vendor, r.invoice_no, r.amount, r.tds, r.checked_by, r.file_url]));
    } else if (kind === "pay-receivables") {
      const { rows } = await receivablesList(pp);
      body = csv(["Customer", "Company", "Invoice no", "Invoice date", "Due date", "PO no", "Salesperson", "Invoice amount", "Received", "Owed", "Days late", "Note"],
        rows.map((r) => [r.party, co(r.entity), r.invoice_no, d(r.invoice_date), d(r.due_date), r.po_no, r.salesperson, r.amount, r.received, r.pending, r.overdue_days, r.kind]));
    } else if (kind === "pay-payables") {
      const { rows } = await payablesList(pp);
      body = csv(["Supplier", "Company", "Invoice no", "Invoice date", "Due date", "Bought for", "Broker", "Invoice amount", "Advance", "TDS", "To pay", "Days late", "Note"],
        rows.map((r) => [r.vendor, co(r.entity), r.invoice_no, d(r.invoice_date), d(r.due_date), r.purchased_for, r.broker, r.amount, r.advance, r.tds, r.pending, r.overdue_days, r.remark]));
    } else if (kind === "tally-parties") {
      const { rows } = await partiesList({ ...readTallyParams(sp), all: true });
      body = csv(["Name", "Kind", "GSTIN", "State", "Balance (Dr positive)", "Orders in your sheets"], rows.map((r) => [r.name, r.parent_group, r.gstin, r.state, r.balance, r.orders]));
    } else if (kind === "tally-receivables" || kind === "tally-payables") {
      const { rows } = await compare(kind === "tally-receivables" ? "receivable" : "payable", { ...readTallyParams(sp), all: true });
      body = csv(["Status", "In Tally", "In the sheet", "Tally balance", "Sheet amount", "Difference"], rows.map((r) => [r.status, r.tally_name, r.sheet_name, r.tally_name ? r.tally : "", r.sheet_name ? r.sheet : "", r.diff]));
    } else if (kind === "pay-gpay") {
      const { rows } = await gpayList(pp);
      body = csv(["Date", "What for", "For whom", "Amount", "Paid by", "Screenshot"], rows.map((r) => [d(r.entered_at), r.description, r.for_whom, r.amount, r.paid_by, r.file_url]));
    } else if (kind === "pay-cash") {
      const { rows } = await pettyList(pp);
      body = csv(["Date", "Spent by", "On what", "Amount", "Bill"], rows.map((r) => [d(r.entered_at), r.who, r.what, r.amount, r.file_url]));
    } else if (kind === "pay-brokerage") {
      const { rows } = await brokerageList(pp);
      body = csv(["Date", "Company", "Party", "Broker", "Weight", "Rate", "Unit", "Basic amount"], rows.map((r) => [d(r.entry_date), co(r.entity), r.party, r.broker, r.weight, r.rate, r.unit, r.basic_amount]));
    } else {
      return NextResponse.json({ error: "Unknown export" }, { status: 404 });
    }
  } else {
    return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sambhav-${kind}-${todayIST()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
