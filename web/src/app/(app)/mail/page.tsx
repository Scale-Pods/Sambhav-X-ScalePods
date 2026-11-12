import Link from "next/link";
import { MailboxFilter, NoTracker } from "@/components/MailboxFilter";
import { mailScope } from "@/lib/mailboxes";
import { Suspense } from "react";
import { connection } from "next/server";
import { mailOverview, readMailParams } from "@/lib/mail";
import { periodLabel } from "@/lib/filters";
import { FilterShell } from "@/components/FilterBar";
import { CountHBar, MonthlyCountChart } from "@/components/charts/OrderCharts";
import { Card, Skeleton, Stat, StatsSkeleton } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;
const f0 = new Intl.NumberFormat("en-IN");

export default function MailOverview({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<><StatsSkeleton /><div className="mt-6"><Card><Skeleton rows={8} /></Card></div></>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // the period depends on today's date
  const sp = await searchParams;
  const p = readMailParams(sp);
  const scope = await mailScope(sp.mb);
  if (!scope.tracker) return <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<MailboxFilter mb={sp.mb} />}><NoTracker what="The overview figures" label={scope.label} /></FilterShell>;
  const o = await mailOverview(p.f);
  const keep = (path: string, extra: Record<string, string> = {}) => {
    const u = new URLSearchParams(extra);
    ["p", "from", "to"].forEach((k) => sp[k] && u.set(k, sp[k]!));
    return `${path}${u.toString() ? "?" + u : ""}`;
  };

  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<MailboxFilter mb={sp.mb} />}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">
        Quotations and leads for <span className="font-semibold text-ink">{periodLabel(p.f)}</span>. The inbox is today&apos;s position, whatever the period.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/mail/inbox" className="block rounded-lg focus-visible:outline-2"><Stat label="Mails waiting for a reply" value={f0.format(o.inbox.pending)} sub={`${f0.format(o.inbox.urgent)} urgent · ${f0.format(o.inbox.follow)} follow-ups · ${f0.format(o.inbox.fresh)} new`} tone="accent" /></Link>
        <Link href={keep("/mail/quotations", { show: "followup" })} className="block rounded-lg focus-visible:outline-2"><Stat label="Quotes with no follow-up" value={f0.format(o.quotes.followup)} sub="quoted three or more days ago, not followed up" /></Link>
        <Link href={keep("/mail/quotations")} className="block rounded-lg focus-visible:outline-2"><Stat label="Quotations sent" value={f0.format(o.quotes.n)} sub={`${f0.format(o.quotes.numbered)} with a quotation number · ${o.quotes.won} orders marked won`} /></Link>
        <Link href={keep("/mail/leads")} className="block rounded-lg focus-visible:outline-2"><Stat label="IndiaMART leads" value={f0.format(o.leads.n)} sub={`${f0.format(o.leads.buy)} buy leads`} /></Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <MonthlyCountChart title="IndiaMART leads" subtitle="Per month" points={o.leadsMonthly} name="Leads" tone="in" />
        <MonthlyCountChart title="Quotations sent" subtitle="Per month, by the date quoted" points={o.quotesMonthly} name="Quotations" tone="out" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <CountHBar title="Where the leads come from" subtitle="Top 10 states" rows={o.leadStates} tone="in" head="State" unit="leads" />
        <CountHBar title="What leads ask for" subtitle="Top 10 products" rows={o.leadProducts} tone="in" head="Product" unit="leads" />
        <CountHBar title="What is being quoted" subtitle="Top 10 materials in the quotation tracker" rows={o.quoteMaterials} tone="out" head="Material" unit="quotes" />
        <CountHBar title="Clients quoted most often" subtitle="Top 10 by number of quotations" rows={o.topClients} tone="out" head="Client" unit="quotes" />
      </div>

      <Card title="Checked against your sheet" className="mt-6">
        <div className="space-y-2 px-5 py-4 text-[0.9rem] text-muted">
          <p>The Email Tracker&apos;s own dashboard says <span className="font-semibold text-ink">{f0.format(o.typed.pending)}</span> mails are pending{o.typed.pending === o.inbox.pending ? ": the same as here." : `; here there are ${f0.format(o.inbox.pending)}.`} It also lists {f0.format(o.typed.open)} open quotations, which is the size of the quotation tracker{o.typed.asOf ? ` (last updated ${o.typed.asOf})` : ""}.</p>
          <p>Quotation numbers are read from the mail subject (&ldquo;QUOTATION NO - 629&rdquo;). Price, quantity and delivery are mostly empty in the tracker today, so they are blank here too: that is what the quotation module will fix.</p>
        </div>
      </Card>
    </FilterShell>
  );
}
