import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, Skeleton, td, Th } from "@/components/ui";
import { StockFitView } from "@/components/StockFitView";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { draftDetail } from "@/lib/drafts";
import { stockFit, type FitInput } from "@/lib/stockfit";
import { q } from "@/lib/db";
import { DismissDraft } from "./DismissDraft";

type P = Promise<{ id: string }>;

export default function DraftPage({ params }: { params: P }) {
  return (
    <>
      <Link href="/drafts" className="mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All drafts</Link>
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body params={params} />
      </Suspense>
    </>
  );
}

const rs = (n: number | null) => (n == null ? "" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n));
const nf = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n));
const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));

async function Body({ params }: { params: P }) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await draftDetail(id);
  if (!d) notFound();
  const me = await currentStaff();
  const canEdit = Boolean(me && canUploadDocs(me.role)) && d.status === "open";

  // stock for each line, as it is now
  const sells = d.kind !== "purchase_invoice"; // stock is checked for what customers ask for, not for what a vendor billed us
  const fits = !sells ? [] : await Promise.all(d.items.map(async (l) => {
    const input: FitInput = {
      grade: l.grade ?? l.grade_raw ?? "", thk: l.thickness_mm, width: l.width_mm, length: l.length_mm,
      needPcs: l.unit_code === "nos" && l.quantity ? Math.round(l.quantity) : null,
      needKg: l.weight_kg ?? (l.unit_code === "kg" ? l.quantity : l.unit_code === "mt" && l.quantity ? l.quantity * 1000 : null),
    };
    return { line: l.line_no, fit: await stockFit(input) };
  }));

  // what Tally says about this customer (only the owner and administrators can read it; for others this is empty)
  const tally = d.tally_ledger
    ? (await q<{ balance: number | null; gstin: string | null }>(`select closing_balance::float8 balance, gstin from public.tally_ledgers where deleted_at is null and name = $1 limit 1`, [d.tally_ledger]))[0]
    : null;

  return (
    <div className="space-y-6">
      <Card title={d.kind === "order" ? "Draft order" : d.kind === "purchase_invoice" ? "Draft purchase invoice" : "Draft quotation (enquiry)"} aside={<Badge tone={d.status === "open" ? "warning" : d.status === "promoted" ? "ok" : "neutral"}>{d.status === "open" ? "Open" : d.status === "dismissed" ? "Set aside" : "Done"}</Badge>}>
        <dl className="grid gap-x-8 gap-y-3 px-5 py-5 text-[0.92rem] sm:grid-cols-2">
          <div><dt className="text-muted">{sells ? "Customer" : "Vendor"}</dt><dd className="font-medium">{d.customer_name ?? "Not read"}{d.customer_gstin ? <span className="ml-2 font-normal text-muted">{d.customer_gstin}</span> : null}</dd></div>
          <div><dt className="text-muted">In Tally</dt><dd className="font-medium">{d.tally_ledger ? <>{d.tally_ledger}{tally?.balance != null ? <span className="ml-2 font-normal text-muted">{tally.balance > 0 ? `owes us ${rs(tally.balance)}` : tally.balance < 0 ? `we owe ${rs(-tally.balance)}` : "balance nil"}</span> : null}</> : <span className="text-muted">Not matched. Check the GSTIN and the name.</span>}</dd></div>
          <div><dt className="text-muted">{sells ? "PO / reference" : "Invoice number"}</dt><dd className="font-medium">{(sells ? d.po_no ?? d.doc_no : d.doc_no) ?? "—"}</dd></div>
          {!sells && d.po_no && <div><dt className="text-muted">Our order reference</dt><dd className="font-medium">{d.po_no}</dd></div>}
          {!sells && d.extra && (["irn", "ack_no", "eway_bill_no", "vehicle_no"] as const).filter((k) => d.extra?.[k]).map((k) => <div key={k}><dt className="text-muted">{({ irn: "IRN", ack_no: "E-invoice ack no.", eway_bill_no: "E-way bill", vehicle_no: "Vehicle" })[k]}</dt><dd className="break-all font-medium">{String(d.extra?.[k])}</dd></div>)}
          <div><dt className="text-muted">Document date</dt><dd className="font-medium">{d.doc_date ?? "—"}</dd></div>
          <div><dt className="text-muted">Delivery</dt><dd className="font-medium">{d.delivery_terms ?? "—"}</dd></div>
          <div><dt className="text-muted">Payment terms</dt><dd className="font-medium">{d.payment_terms ?? "—"}</dd></div>
          <div><dt className="text-muted">Total on the {sells ? "document" : "invoice"}</dt><dd className="font-medium">{rs(d.total_amount) || "—"}</dd></div>
          <div><dt className="text-muted">From</dt><dd className="font-medium"><Link href={`/documents/${d.document_id}`} className="text-brand hover:underline">{d.file}</Link><span className="ml-2 font-normal text-muted">confirmed {when(d.created_at)}{d.created_by ? ` by ${d.created_by}` : ""}</span></dd></div>
        </dl>
        {d.status === "dismissed" && <p className="border-t border-line px-5 py-3 text-[0.88rem] text-muted">Set aside{d.closed_by ? ` by ${d.closed_by}` : ""}{d.closed_at ? `, ${when(d.closed_at)}` : ""}{d.close_note ? `: ${d.close_note}` : "."}</p>}
      </Card>

      <Card title="Lines">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem]">
            <thead><tr className="border-b border-line">
              <Th>#</Th><Th>Grade</Th><Th>Size mm</Th>{!sells && <Th>HSN · heat · plate</Th>}<Th right>Qty</Th><Th right>Weight kg</Th><Th right>Rate</Th><Th right>Amount</Th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {d.items.map((l) => (
                <tr key={l.line_no}>
                  <td className={td}>{l.line_no}</td>
                  <td className={td}>{l.grade ?? l.grade_raw ?? ""}{l.grade_raw && !l.grade ? <span className="ml-1.5"><Badge tone="warning">not in grade list</Badge></span> : null}</td>
                  <td className={td + " num whitespace-nowrap"}>{[l.thickness_mm, l.width_mm, l.length_mm].map((v) => (v == null ? "?" : nf(v))).join(" × ")}</td>
                  {!sells && <td className={td + " text-[0.82rem]"}>{[l.hsn_code, l.heat_no && `heat ${l.heat_no}`, l.plate_no && `plate ${l.plate_no}`].filter(Boolean).join(" · ")}</td>}
                  <td className={td + " num text-right"}>{nf(l.quantity)} {l.unit_code ?? ""}</td>
                  <td className={td + " num text-right"}>{nf(l.weight_kg)}</td>
                  <td className={td + " num text-right"}>{l.rate != null ? `${rs(l.rate)}${l.rate_unit ? ` ${l.rate_unit.replace("_", " ")}` : ""}` : ""}</td>
                  <td className={td + " num text-right"}>{rs(l.amount)}</td>
                </tr>
              ))}
              {d.items.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No lines.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {fits.length > 0 && (
        <Card title="Do we have it in stock?">
          <div className="space-y-2 px-5 py-4 text-[0.9rem]">
            {fits.map((f) => <StockFitView key={f.line} fit={f.fit} title={`Line ${f.line}:`} />)}
            <p className="text-[0.78rem] text-muted">Checked just now. Plates of the same grade and thickness (within 0.05 mm) that are big enough, either way round. Nothing is reserved.</p>
          </div>
        </Card>
      )}

      {canEdit && <div><DismissDraft id={d.id} /></div>}
    </div>
  );
}
