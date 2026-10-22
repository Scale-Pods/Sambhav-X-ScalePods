import { Suspense } from "react";
import { connection } from "next/server";
import { ExternalLink } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { FilterShell, ParamSearch, ParamSelect } from "@/components/FilterBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { quotesList, readMailParams, type QuoteRow } from "@/lib/mail";
import { PAGE_SIZE } from "@/lib/payments";

type SP = Promise<Record<string, string | undefined>>;

export default function QuotationsPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readMailParams(sp);
  const d = await quotesList(p);
  const link = linker("/mail/quotations", sp);
  const cols: Col<QuoteRow>[] = [
    { label: "Quote no.", cell: (r) => <span className="font-semibold">{r.quote_no ?? ""}</span> },
    { label: "Date", cell: (r) => day(r.quoted_at) },
    { label: "Client", cell: (r) => r.client_name, nowrap: false },
    { label: "Email", cell: (r) => r.client_email },
    { label: "Subject", cell: (r) => r.subject, nowrap: false },
    { label: "Material", cell: (r) => r.material },
    { label: "Qty", cell: (r) => r.qty },
    { label: "Days", right: true, cell: (r) => r.days },
    { label: "Follow-up", cell: (r) => (r.source_tab === "Won" ? <Badge tone="ok">Order won</Badge> : r.fu2 ? <Badge tone="ok">2 done</Badge> : r.fu1 ? <Badge tone="info">1 done</Badge> : Number(r.days) >= 3 ? <Badge tone="warning">Due</Badge> : null) },
    { label: "Status", cell: (r) => r.status },
    { label: "Mail", cell: (r) => (r.gmail_url && /^https?:\/\//i.test(r.gmail_url) ? <a href={r.gmail_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open</a> : null) },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]}
      extra={<><ParamSearch placeholder="Quote no., client, email, material" value={p.q} />
        <ParamSelect name="show" label="Show" value={p.show} options={[{ value: "all", label: "All quotations" }, { value: "followup", label: "No follow-up yet" }, { value: "numbered", label: "With a quote number" }, { value: "won", label: "Orders won" }]} /></>}>
      <Card title="Quotations">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} format={(v) => String(v)} />
      </Card>
    </FilterShell>
  );
}
