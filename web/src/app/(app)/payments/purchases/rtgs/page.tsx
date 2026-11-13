import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft, Lock } from "lucide-react";
import { Card, Skeleton } from "@/components/ui";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { driveReady } from "@/lib/drive";
import { q } from "@/lib/db";
import { todayIST } from "@/lib/filters";
import { RtgsForm } from "./RtgsForm";

export const metadata = { title: "RTGS form · Sambhav Stock" };
type SP = Promise<Record<string, string | undefined>>;

export default function RtgsPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={10} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const back = <Link href="/payments/purchases" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Purchase invoices</Link>;
  const me = await currentStaff().catch(() => null);
  if (!canUploadDocs(me?.role)) return <>{back}<Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Payment forms can be prepared by the owner, administrators, approvers and accounts.</p></Card></>;
  const invoice = (sp.inv ?? "").slice(0, 80), party = (sp.party ?? "").slice(0, 200), entity = sp.entity === "SAI" ? "SAI" : "SPF";
  const [row] = invoice ? await q<{ invoice_no: string; vendor: string; amount: string; file_url: string | null; due_date: string | null }>(
    `select invoice_no, vendor, amount, file_url, due_date::text from public.v_purchase_invoices where entry_no = 1 and invoice_no = $1 and vendor = $2 and entity = $3 limit 1`, [invoice, party, entity]) : [];
  if (!row) return <>{back}<Card><p className="px-5 py-10 text-muted">That invoice was not found.</p></Card></>;
  // what is still to be paid on it, if the Creditors list has it (an advance or TDS may already be taken off); otherwise the invoice amount
  const [pay] = await q<{ pending: string | null }>(`select pending from public.v_payables where invoice_no = $1 and vendor = $2 and entity = $3 limit 1`, [invoice, party, entity]).catch(() => []);
  const pending = pay?.pending != null ? Number(pay.pending) : null;
  return (
    <>
      {back}
      <h2 className="mb-1 font-display text-[1.3rem] font-bold tracking-[-0.01em]">RTGS / NEFT form</h2>
      <p className="mb-4 text-[0.92rem] text-muted">{row.vendor} · invoice {row.invoice_no}</p>
      <RtgsForm supplier={row.vendor} invoiceNo={row.invoice_no} entity={entity} link={row.file_url} invoiceAmount={Number(row.amount)} pending={pending} today={todayIST()} drive={driveReady()} />
    </>
  );
}
