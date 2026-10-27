import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Check, Minus } from "lucide-react";
import { Badge, Card, Skeleton, td, Th } from "@/components/ui";
import { PLACEHOLDER_INVOICE } from "@/lib/glossary";
import { TRAIL_PAGE, TRAIL_SHOWS, trailList, type TrailRow, type TrailShow } from "@/lib/tallytrail";

type SP = Promise<Record<string, string | undefined>>;
const TABS: Record<TrailShow, string> = { all: "All sales invoices", nopo: "No PO on file", nocert: "No certificate", nodispatch: "Not in the vehicle register" };

export default function TrailPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

const rs = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const dateFmt = (s: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(s));

function Dot({ on, label }: { on: boolean; label: string }) {
  return on ? <span className="inline-flex items-center gap-1 text-ok" title={label}><Check className="h-4 w-4" /></span> : <span className="inline-flex items-center text-muted" title={label}><Minus className="h-4 w-4" /></span>;
}

function po(r: TrailRow) {
  if (r.po_docs > 0) return <Badge tone="ok" info="A document with this PO number was uploaded and read. Open the invoice to see it.">PO uploaded</Badge>;
  if (r.po_orders > 0) return <Badge tone="ok" info="This PO number is in the orders sheet (Dispatch FMS), so an order exists for it.">In orders sheet</Badge>;
  if (r.verbal) return <Badge info="Tally says the order was given verbally (“PO NO : VERBAL”), so there is no PO paper to look for.">Verbal</Badge>;
  return r.po_ref
    ? <Badge tone="warning" info="The invoice names this PO number, but no uploaded document and no order in the orders sheet carries it. Upload the PO under Documents, or check the number typed in Tally.">Not found</Badge>
    : <Badge info="Nothing is typed in Tally's order-number field for this invoice.">No PO noted</Badge>;
}
function cert(r: TrailRow) {
  if (r.heats === 0) return <Badge info="No heat number could be read from this invoice's lines, so the certificates cannot be checked.">No heat no.</Badge>;
  if (r.certs_filed > 0) return <Badge tone="ok" info="A mill certificate is filed and linked to at least one plate on this invoice.">Filed</Badge>;
  if (r.cert_docs > 0) return <Badge tone="info" info="A certificate with this heat number was uploaded and read, but nobody has confirmed it yet. Confirm it under Documents.">Read, to confirm</Badge>;
  return <Badge tone="warning" info={`This invoice names ${r.heats} heat number${r.heats === 1 ? "" : "s"}. ${r.heats_in_stock} of them ${r.heats_in_stock === 1 ? "is" : "are"} in our stock book. No mill certificate is filed for any of them yet: upload the certificates under Documents.`}>{r.heats_in_stock} of {r.heats} plates in books, none filed</Badge>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const show = (TRAIL_SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as TrailShow) : "all";
  const search = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  const rows = await trailList(show, search, page);
  const total = rows[0]?.total ?? 0, pages = Math.max(1, Math.ceil(total / TRAIL_PAGE));
  const href = (changes: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...(show !== "all" ? { show } : {}), ...(search ? { q: search } : {}), ...(page > 1 ? { page: String(page) } : {}) });
    Object.entries(changes).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    const t = p.toString();
    return `/tally/invoices${t ? `?${t}` : ""}`;
  };
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[0.92rem] text-muted">
        Each sales invoice in Tally with the paperwork behind it, matched on the documents’ own numbers: the customer’s PO number, the heat numbers on its lines (against filed mill certificates)
        and the vehicle register. A dash means nothing was found yet, which is where to look first.
      </p>
      <details className="max-w-3xl rounded-lg border border-line bg-card px-4 py-2.5 text-[0.88rem]">
        <summary className="cursor-pointer font-semibold">How to read this table</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
          <li><b className="text-ink">Invoice</b>: the number typed in Tally. Only X, XX or XXXX is a placeholder (a draft or practice entry), marked “placeholder no.”.</li>
          <li><b className="text-ink">Customer PO</b>: the customer's order number written on the invoice. <i>Not found</i> means we hold no PO document and no order with that number yet; <i>Verbal</i> means Tally says there was no written PO.</li>
          <li><b className="text-ink">Certificates</b>: the mill test certificates for the plates on the invoice (found through their heat numbers). “0 of 1 plates in books, none filed” means the invoice names 1 heat number, none of those plates is in our stock book, and no certificate is filed.</li>
          <li><b className="text-ink">Vehicle register</b>, <b className="text-ink">E-invoice</b>, <b className="text-ink">E-way</b>: a tick means it was found, a dash means not found. The vehicle register sheet stops at 29 Sep 2026, so later invoices cannot show a tick yet.</li>
        </ul>
        <p className="mt-2 text-muted">Hover or tap the “i” next to a heading or a label for the same explanation.</p>
      </details>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line" aria-label="Filter">
          {TRAIL_SHOWS.map((s) => (
            <Link key={s} href={href({ show: s === "all" ? undefined : s, page: undefined })} aria-current={s === show ? "page" : undefined}
              className={"border-b-2 px-1 pb-3 text-[0.92rem] font-semibold transition-colors " + (s === show ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>{TABS[s]}</Link>
          ))}
        </nav>
        <form method="get" className="flex items-center gap-2">
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <input name="q" defaultValue={search} placeholder="Invoice, customer, PO, vehicle…" className="w-64 rounded-md border border-line bg-field px-3 py-1.5 text-[0.9rem]" />
          <button className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface">Search</button>
        </form>
      </div>
      <Card>
        {rows.length === 0 ? <p className="px-5 py-8 text-center text-muted">No invoices match.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-surface/60"><tr>
                <Th>Invoice</Th><Th>Date</Th><Th>Customer</Th><Th right>Amount</Th>
                <Th>Customer PO</Th><Th>Certificates</Th><Th>Vehicle register</Th><Th>E-invoice</Th><Th>E-way</Th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface/60">
                    <td className={td}><Link href={`/tally/invoices/${r.id}`} className="font-semibold text-brand hover:underline">{r.voucher_no}</Link>{/^x+$/i.test(r.voucher_no) && <span className="ml-1.5"><Badge tone="warning" info={PLACEHOLDER_INVOICE}>placeholder no.</Badge></span>}</td>
                    <td className={td + " whitespace-nowrap"}>{dateFmt(r.date)}</td>
                    <td className={td + " max-w-[16rem] truncate"} title={r.party ?? ""}>{(r.party ?? "").replace(/\s*\((Sale|Pur|Rent)\)\s*$/i, "")}</td>
                    <td className={td + " num text-right"}>{rs(r.amount)}</td>
                    <td className={td}>{po(r)}{r.po_ref && !r.verbal && <span className="ml-1.5 text-[0.78rem] text-muted">{r.po_ref}</span>}</td>
                    <td className={td}>{cert(r)}</td>
                    <td className={td}><Dot on={r.in_register > 0} label={r.in_register > 0 ? "In the vehicle register" : "Not in the vehicle register (it ends 29 Sep 2026)"} /></td>
                    <td className={td}><Dot on={r.has_irn} label={r.has_irn ? "IRN in Tally" : "No IRN in Tally"} /></td>
                    <td className={td}><Dot on={Boolean(r.eway_bill_no)} label={r.eway_bill_no ?? "No e-way bill in Tally"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[0.82rem] text-muted">
          <span>{total.toLocaleString("en-IN")} invoice{total === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-3">
            {page > 1 && <Link href={href({ page: page - 1 > 1 ? String(page - 1) : undefined })} className="hover:text-ink">← Newer</Link>}
            <span className="num">Page {page} of {pages}</span>
            {page < pages && <Link href={href({ page: String(page + 1) })} className="hover:text-ink">Older →</Link>}
          </span>
        </div>
      </Card>
    </div>
  );
}
