import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, Skeleton, td, th } from "@/components/ui";
import { DRAFT_SHOWS, draftsList, type DraftShow } from "@/lib/drafts";

type SP = Promise<Record<string, string | undefined>>;
const TABS: Record<DraftShow, string> = { open: "Open", dismissed: "Set aside", all: "All" };

export default function DraftsPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Drafts" hint="A customer order or enquiry that a person has confirmed from a document. Work from it: check stock, then raise the order or the quotation. Nothing here is posted to orders or the books." />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));
const rs = (n: number | null) => (n == null ? "" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n));

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const show = (DRAFT_SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as DraftShow) : "open";
  const rows = await draftsList(show);
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line" aria-label="Drafts">
        {DRAFT_SHOWS.map((s) => (
          <Link key={s} href={s === "open" ? "/drafts" : `/drafts?show=${s}`} aria-current={s === show ? "page" : undefined}
            className={"border-b-2 px-1 pb-3 text-[0.95rem] font-semibold transition-colors " + (s === show ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
            {TABS[s]}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <p className="px-5 py-8 text-center text-muted">No drafts here. Confirm a customer order or enquiry from Documents and it appears.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line">
                <th className={th}>Draft</th><th className={th}>Customer</th><th className={th}>PO / ref</th><th className={th}>Date</th>
                <th className={th + " text-right"}>Lines</th><th className={th + " text-right"}>Total</th><th className={th}>Status</th><th className={th}>Made</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface/60">
                    <td className={td}><Link href={`/drafts/${d.id}`} className="font-semibold text-brand hover:underline">{d.kind === "order" ? "Order" : "Enquiry"}</Link></td>
                    <td className={td + " max-w-[18rem]"}>
                      <span className="block truncate font-medium" title={d.customer_name ?? ""}>{d.customer_name ?? "—"}</span>
                      {d.tally_ledger ? <span className="text-[0.78rem] text-ok">in Tally</span> : <span className="text-[0.78rem] text-muted">not matched in Tally</span>}
                    </td>
                    <td className={td}>{d.po_no ?? d.doc_no ?? ""}</td>
                    <td className={td + " whitespace-nowrap"}>{d.doc_date ?? ""}</td>
                    <td className={td + " text-right"}>{d.lines}</td>
                    <td className={td + " num text-right"}>{rs(d.total_amount)}</td>
                    <td className={td}><Badge tone={d.status === "open" ? "warning" : d.status === "promoted" ? "ok" : "neutral"}>{d.status === "open" ? "Open" : d.status === "dismissed" ? "Set aside" : "Done"}</Badge></td>
                    <td className={td + " whitespace-nowrap text-muted"}>{when(d.created_at)}{d.created_by ? ` · ${d.created_by.split(" ")[0]}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
