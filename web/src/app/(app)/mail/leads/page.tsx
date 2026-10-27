import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { FilterShell, ParamSearch, ParamSelect } from "@/components/FilterBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { leadsList, readMailParams, type LeadRow } from "@/lib/mail";
import { PAGE_SIZE } from "@/lib/payments";

type SP = Promise<Record<string, string | undefined>>;

export default function LeadsPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readMailParams(sp);
  const d = await leadsList(p);
  const link = linker("/mail/leads", sp);
  const cols: Col<LeadRow>[] = [
    { label: "Received", info: "The date the enquiry came in.", cell: (r) => day(r.received_at) },
    { label: "Name", cell: (r) => <span className="font-semibold">{r.name}</span> },
    { label: "Company", cell: (r) => r.company, nowrap: false },
    { label: "City", cell: (r) => [r.city, r.state].filter(Boolean).join(", ") },
    { label: "Mobile", cell: (r) => r.mobile },
    { label: "Product", cell: (r) => r.product, nowrap: false },
    { label: "What they asked", cell: (r) => <span className="line-clamp-2 max-w-[22rem] whitespace-pre-line text-muted" title={r.message ?? ""}>{r.message}</span>, nowrap: false },
    { label: "Type", cell: (r) => <Badge tone={r.query_kind === "Buy lead" ? "info" : r.query_kind === "Phone call" ? "warning" : "neutral"}>{r.query_kind}</Badge> },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]}
      extra={<><ParamSearch placeholder="Name, company, city, product" value={p.q} />
        <ParamSelect name="kind" label="Type" value={p.kind} options={[{ value: "all", label: "All" }, { value: "Buy lead", label: "Buy leads" }, { value: "Direct enquiry", label: "Direct enquiries" }, { value: "Phone call", label: "Phone calls" }, { value: "Business enquiry", label: "Business enquiries" }]} /></>}>
      <Card title="IndiaMART leads">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} format={(v) => String(v)} />
      </Card>
    </FilterShell>
  );
}
