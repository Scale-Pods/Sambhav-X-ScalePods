import { NextResponse, type NextRequest } from "next/server";
import { plates, summary } from "@/lib/analytics";
import { canExport, currentStaff } from "@/lib/auth";
import { parseFilter, todayIST } from "@/lib/filters";
import { readPlateQuery } from "@/lib/plateQuery";

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
