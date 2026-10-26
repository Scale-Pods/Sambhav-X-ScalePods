import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";
import { trailDetail } from "@/lib/tallytrail";

type P = Promise<{ id: string }>;

export default function TrailDetailPage({ params }: { params: P }) {
  return (
    <>
      <Link href="/tally/invoices" className="mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All sales invoices</Link>
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body params={params} />
      </Suspense>
    </>
  );
}

const rs = (n: number | null) => (n == null ? "" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n));
const nf = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n));
const dateFmt = (s: string | null) => (s ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(s)) : "");
const label = "text-[0.72rem] font-semibold uppercase tracking-wider text-muted";

async function Body({ params }: { params: P }) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await trailDetail(id);
  if (!t) notFound();
  const { v } = t;
  const nothingForPo = t.po_docs.length === 0 && t.po_orders.length === 0;

  return (
    <div className="space-y-6">
      <Card title={`Sales invoice ${v.voucher_no}`} aside={<Badge tone="info">Tally</Badge>}>
        <dl className="grid gap-x-8 gap-y-3 px-5 py-5 text-[0.92rem] sm:grid-cols-2">
          <div><dt className="text-muted">Customer</dt><dd className="font-medium">{(v.party ?? "").replace(/\s*\((Sale|Pur|Rent)\)\s*$/i, "")}{v.party_gstin ? <span className="ml-2 font-normal text-muted">{v.party_gstin}</span> : null}</dd></div>
          <div><dt className="text-muted">Date and amount</dt><dd className="font-medium">{dateFmt(v.date)} · {rs(v.amount)}</dd></div>
          <div><dt className="text-muted">Customer PO noted in Tally</dt><dd className="font-medium">{v.buyer_order_no ?? "none"}</dd></div>
          <div><dt className="text-muted">Dispatch</dt><dd className="font-medium">{[v.shipped_by, v.vehicle_no].filter(Boolean).join(" · ") || "—"}</dd></div>
          <div><dt className="text-muted">E-way bill</dt><dd className="font-medium">{v.eway_bill_no ?? "—"}{v.eway_valid_upto ? <span className="ml-2 font-normal text-muted">valid to {v.eway_valid_upto.slice(6, 8)}/{v.eway_valid_upto.slice(4, 6)}/{v.eway_valid_upto.slice(0, 4)}</span> : null}</dd></div>
          <div><dt className="text-muted">E-invoice (IRN)</dt><dd className="break-all font-medium">{v.irn ? `${v.irn.slice(0, 16)}…` : "—"}{v.ack_no ? <span className="ml-2 font-normal text-muted">ack {v.ack_no}</span> : null}</dd></div>
        </dl>
      </Card>

      <Card title="Lines">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr className="border-b border-line"><th className={th}>#</th><th className={th}>Item</th><th className={th}>Heat no.</th><th className={th + " text-right"}>Quantity</th><th className={th + " text-right"}>Rate</th><th className={th + " text-right"}>Amount</th></tr></thead>
            <tbody className="divide-y divide-line">
              {t.items.map((i) => (
                <tr key={i.line_no}>
                  <td className={td}>{i.line_no}</td>
                  <td className={td}><span className="font-medium">{i.item_name}</span>{i.hsn_code ? <span className="ml-2 text-[0.8rem] text-muted">HSN {i.hsn_code}</span> : null}{i.description ? <span className="block text-[0.8rem] text-muted">{i.description}</span> : null}</td>
                  <td className={td}>{i.heat || ""}</td>
                  <td className={td + " num text-right"}>{nf(i.quantity)} {i.unit ?? ""}</td>
                  <td className={td + " num text-right"}>{rs(i.rate)}</td>
                  <td className={td + " num text-right"}>{rs(i.amount)}</td>
                </tr>
              ))}
              {t.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No item lines (an invoice without stock items).</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="The customer's PO">
        <div className="space-y-2 px-5 py-4 text-[0.92rem]">
          {v.verbal ? <p><Badge>Verbal order</Badge> <span className="text-muted">Tally says the order was given verbally ({v.buyer_order_no}), so there is no PO number to look for.</span></p>
            : !v.po_ref ? <p className="text-muted">No PO number is noted on this invoice.</p> : (
              <>
                {t.po_docs.map((d) => <p key={d.id}><Badge tone="ok">PO uploaded</Badge> <Link href={`/documents/${d.id}`} className="font-medium text-brand hover:underline">{d.file}</Link> <span className="text-muted">· {d.buyer ?? ""} · PO {d.po} · {d.review === "pending" ? "waiting for review" : d.review}</span></p>)}
                {t.po_orders.map((o) => <p key={o.order_no}><Badge tone="ok">In the orders sheet</Badge> <Link href={`/orders/${encodeURIComponent(o.order_no)}`} className="font-medium text-brand hover:underline">Order {o.order_no}</Link> <span className="text-muted">· {o.client} · PO {o.po_no} · {o.order_date ?? ""} · {o.status}</span></p>)}
                {nothingForPo && <p><Badge tone="warning">Not found</Badge> <span className="text-muted">PO {v.po_ref} is on the invoice, but no uploaded document or order carries that number. Upload the PO from Documents.</span></p>}
              </>
            )}
        </div>
      </Card>

      <Card title="Mill certificates for the heat numbers">
        <div className="space-y-3 px-5 py-4 text-[0.92rem]">
          {t.heats.length === 0 && <p className="text-muted">No heat numbers on the lines of this invoice.</p>}
          {t.heats.map((h) => (
            <div key={h.heat} className="rounded-md border border-line bg-surface/40 px-3 py-2.5">
              <p className="font-medium">Heat {h.heat}</p>
              <p className="mt-0.5 text-[0.85rem] text-muted">
                {h.lots.length ? <>In our books: {h.lots.map((l, i) => <span key={l.lot_no}>{i > 0 ? ", " : ""}<Link href={`/stock/${l.lot_no}`} className="font-medium text-brand hover:underline">plate {l.lot_no}</Link>{l.plate_no ? ` (${l.plate_no})` : ""} · {l.status}</span>)}</> : "Not found in our plates."}
              </p>
              <p className="mt-1 text-[0.85rem]">
                {h.lots.some((l) => l.certs.length) ? <><Badge tone="ok">Certificate filed</Badge> <span className="text-muted">{[...new Set(h.lots.flatMap((l) => l.certs))].join(", ")}</span></>
                  : h.cert_docs.length ? <><Badge tone="info">Read, to confirm</Badge> {h.cert_docs.map((d) => <Link key={d.id} href={`/documents/${d.id}`} className="ml-1 font-medium text-brand hover:underline">{d.file}</Link>)}</>
                  : <><Badge tone="warning">No certificate</Badge> <span className="text-muted">Upload the mill test certificate from Documents.</span></>}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Dispatch and documents">
        <div className="space-y-2 px-5 py-4 text-[0.92rem]">
          {t.register.length ? t.register.map((r, i) => <p key={i}><Badge tone="ok">Vehicle register</Badge> <span className="text-muted">{dateFmt(r.dispatch_date)} · invoice {r.invoice_no} · vehicle {r.vehicle_no ?? "—"} · {r.weight_kg != null ? `${nf(r.weight_kg)} kg` : ""} {r.grade ?? ""}</span></p>)
            : <p><Badge>Not in the register</Badge> <span className="text-muted">No row with this invoice number around this date. The register sheet runs to 29 Sep 2026.</span></p>}
          {t.same_numbers.map((d) => <p key={d.id}><Badge tone="ok">Document with the same {d.by}</Badge> <Link href={`/documents/${d.id}`} className="font-medium text-brand hover:underline">{d.file}</Link></p>)}
          {t.same_numbers.length === 0 && (v.irn || v.eway_bill_no) && <p className={label}>No uploaded document carries this IRN or e-way bill number.</p>}
        </div>
      </Card>
    </div>
  );
}
