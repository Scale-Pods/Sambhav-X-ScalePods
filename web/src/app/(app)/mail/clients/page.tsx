import { Suspense } from "react";
import { MailboxFilter, NoTracker } from "@/components/MailboxFilter";
import { mailScope } from "@/lib/mailboxes";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { FilterShell, ParamSearch, ParamSelect } from "@/components/FilterBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { clientsList, readMailParams, type ClientRow } from "@/lib/mail";
import { PAGE_SIZE } from "@/lib/payments";

type SP = Promise<Record<string, string | undefined>>;

export default function ClientsPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readMailParams(sp, "all");
  const scope = await mailScope(sp.mb);
  if (!scope.tracker) return <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<MailboxFilter mb={sp.mb} />}><NoTracker what="Clients" label={scope.label} /></FilterShell>;
  const d = await clientsList(p);
  const link = linker("/mail/clients", sp);
  const cols: Col<ClientRow>[] = [
    { label: "Client", cell: (r) => <span className="font-semibold">{r.client_name}</span>, nowrap: false },
    { label: "Email", cell: (r) => r.email },
    { label: "Grade", cell: (r) => r.grade },
    { label: "Enquiries", right: true, cell: (r) => r.enquiries },
    { label: "Quotations", right: true, cell: (r) => r.quotations },
    { label: "Orders won", right: true, cell: (r) => r.orders_won },
    { label: "Last contact", cell: (r) => day(r.last_contact) },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]}
      extra={<><MailboxFilter mb={sp.mb} /><ParamSearch placeholder="Client or email" value={p.q} />
        <ParamSelect name="grade" label="Grade" value={p.grade} options={[{ value: "all", label: "All" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }]} /></>}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">Grades are as set in the Email Tracker. Almost every client is still graded C, so the grade says little yet.</p>
      <Card title="Clients">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} format={(v) => String(v)} />
      </Card>
    </FilterShell>
  );
}
