import { NextResponse, type NextRequest } from "next/server";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { rtgsXlsx, type Rtgs } from "@/lib/rtgsXlsx";

const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, n) : "");

/** The RTGS / NEFT request as an Excel file. Everything is checked again here: nothing from the browser is trusted. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me || !canUploadDocs(me.role)) return NextResponse.json({ error: "Your login may not prepare payment forms." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const p: Rtgs = {
    mode: b.mode === "NEFT" ? "NEFT" : "RTGS", date: s(b.date, 10), remitter: s(b.remitter, 120), remitterAccount: s(b.remitterAccount, 30).replace(/\D/g, ""),
    holder: s(b.holder, 120), account: s(b.account, 30).replace(/\D/g, ""), bank: s(b.bank, 80), branch: s(b.branch, 160), ifsc: s(b.ifsc, 11).toUpperCase(),
    amount: Math.round(Number(b.amount) * 100) / 100, remarks: s(b.remarks, 140), supplier: s(b.supplier, 120), invoiceNo: s(b.invoiceNo, 60),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return NextResponse.json({ error: "The date is not valid." }, { status: 400 });
  if (!p.holder || !/^\d{9,18}$/.test(p.account) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p.ifsc)) return NextResponse.json({ error: "The beneficiary name, account number and IFSC must be valid." }, { status: 400 });
  if (!(p.amount > 0) || p.amount > 1e10) return NextResponse.json({ error: "The amount is not valid." }, { status: 400 });
  const file = await rtgsXlsx(p);
  const name = `rtgs-${p.invoiceNo || p.supplier || "payment"}`.replace(/[^\w.-]+/g, "-").slice(0, 60);
  return new NextResponse(new Uint8Array(file), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" },
  });
}
