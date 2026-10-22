import { Suspense } from "react";
import { connection } from "next/server";
import { ExternalLink } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { FilterShell, ParamSearch, ParamSelect } from "@/components/FilterBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { inboxList, readMailParams, type InboxRow } from "@/lib/mail";
import { PAGE_SIZE } from "@/lib/payments";

type SP = Promise<Record<string, string | undefined>>;

export default function InboxPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readMailParams(sp, "all");
  const d = await inboxList(p);
  const link = linker("/mail/inbox", sp);
  const cols: Col<InboxRow>[] = [
    { label: "Received", cell: (r) => day(r.received_at) },
    { label: "Subject", cell: (r) => <span className="font-semibold">{r.subject}</span>, nowrap: false },
    { label: "From", cell: (r) => r.from_name, nowrap: false },
    { label: "Email", cell: (r) => r.from_email },
    { label: "Days", right: true, cell: (r) => r.days },
    { label: "Status", cell: (r) => (r.status === "URGENT" ? <Badge tone="error">Urgent</Badge> : r.status === "Follow Up" ? <Badge tone="warning">Follow up</Badge> : r.status === "Replied" ? <Badge tone="ok">Replied</Badge> : <Badge tone="info">{r.status ?? "New"}</Badge>) },
    { label: "Remarks", cell: (r) => r.remarks, nowrap: false },
    { label: "Mail", cell: (r) => (r.gmail_url && /^https?:\/\//i.test(r.gmail_url) ? <a href={r.gmail_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open</a> : null) },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]}
      extra={<><ParamSearch placeholder="Subject, sender, email" value={p.q} />
        <ParamSelect name="state" label="Mails" value={p.state} options={[{ value: "Pending", label: "Waiting for a reply" }, { value: "Done", label: "Replied" }, { value: "Ignored", label: "Ignored" }, { value: "all", label: "All" }]} />
        <ParamSelect name="show" label="Status" value={p.show} options={[{ value: "all", label: "Any" }, { value: "URGENT", label: "Urgent" }, { value: "Follow Up", label: "Follow up" }, { value: "New", label: "New" }]} /></>}>
      <Card title="Inbox">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} format={(v) => String(v)} />
      </Card>
    </FilterShell>
  );
}
