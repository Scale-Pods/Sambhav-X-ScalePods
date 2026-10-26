import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Check, Minus } from "lucide-react";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";
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
  if (r.po_docs > 0) return <Badge tone="ok">PO uploaded</Badge>;
  if (r.po_orders > 0) return <Badge tone="ok">In orders sheet</Badge>;
  if (r.verbal) return <Badge>Verbal</Badge>;
  return r.po_ref ? <Badge tone="warning">Not found</Badge> : <Badge>No PO noted</Badge>;
}
function cert(r: TrailRow) {
  if (r.heats === 0) return <Badge>No heat no.</Badge>;
  if (r.certs_filed > 0) return <Badge tone="ok">Filed</Badge>;
  if (r.cert_docs > 0) return <Badge tone="info">Read, to confirm</Badge>;
  return <Badge tone="warning">{r.heats_in_stock} of {r.heats} plates in books, none filed</Badge>;
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
                <th className={th}>Invoice</th><th className={th}>Date</th><th className={th}>Customer</th><th className={th + " text-right"}>Amount</th>
                <th className={th}>Customer PO</th><th className={th}>Certificates</th><th className={th}>Vehicle register</th><th className={th}>E-invoice</th><th className={th}>E-way</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface/60">
                    <td className={td}><Link href={`/tally/invoices/${r.id}`} className="font-semibold text-brand hover:underline">{r.voucher_no}</Link></td>
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
