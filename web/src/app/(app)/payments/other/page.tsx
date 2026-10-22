import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { FileLink, ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, brokerageList, gpayList, pettyList, readPayParams, type BrokerageRow, type GpayRow, type PettyRow } from "@/lib/payments";
import { amount, rupeesShort } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;
const VIEWS = [["gpay", "GPay payments"], ["cash", "Small cash expenses"], ["brokerage", "Brokerage"]] as const;

export default function OtherPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readPayParams(sp);
  const view = VIEWS.find((v) => v[0] === sp.view)?.[0] ?? "gpay";
  const link = linker("/payments/other", sp);
  const chip = (on: boolean) => "rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset " + (on ? "bg-ink text-surface ring-ink" : "bg-field text-muted ring-line hover:text-ink");
  let table;
  if (view === "gpay") {
    const d = await gpayList(p);
    const cols: Col<GpayRow>[] = [
      { label: "Date", cell: (r) => day(r.entered_at) }, { label: "What for", cell: (r) => <span className="font-semibold">{r.description}</span>, nowrap: false },
      { label: "For whom", cell: (r) => r.for_whom }, { label: "Amount (₹)", right: true, cell: (r) => <span className="font-medium">{amount(r.amount)}</span> },
      { label: "Paid by", cell: (r) => r.paid_by }, { label: "Screenshot", cell: (r) => <FileLink url={r.file_url} /> },
    ];
    table = <><PayTable cols={cols} rows={d.rows} /><ListFooter total={d.total} sum={d.sum} sumLabel="Paid" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-gpay")} format={rupeesShort} /></>;
  } else if (view === "cash") {
    const d = await pettyList(p);
    const cols: Col<PettyRow>[] = [
      { label: "Date", cell: (r) => day(r.entered_at) }, { label: "Spent by", cell: (r) => r.who }, { label: "On what", cell: (r) => <span className="font-semibold">{r.what}</span>, nowrap: false },
      { label: "Amount (₹)", right: true, cell: (r) => <span className="font-medium">{amount(r.amount)}</span> }, { label: "Bill", cell: (r) => <FileLink url={r.file_url} /> },
    ];
    table = <><PayTable cols={cols} rows={d.rows} /><ListFooter total={d.total} sum={d.sum} sumLabel="Spent" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-cash")} format={rupeesShort} /></>;
  } else {
    const d = await brokerageList(p);
    const cols: Col<BrokerageRow>[] = [
      { label: "Date", cell: (r) => day(r.entry_date) }, { label: "Company", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
      { label: "Party", cell: (r) => <span className="font-semibold">{r.party}</span>, nowrap: false }, { label: "Broker", cell: (r) => r.broker },
      { label: "Weight", right: true, cell: (r) => (r.weight ? amount(r.weight) : "") }, { label: "Rate", right: true, cell: (r) => (r.rate ? amount(r.rate) : "") },
      { label: "Basic (₹)", right: true, cell: (r) => <span className="font-medium">{amount(r.basic_amount)}</span> },
    ];
    table = <><PayTable cols={cols} rows={d.rows} /><ListFooter total={d.total} sum={d.sum} sumLabel="Total" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-brokerage")} format={rupeesShort} /></>;
  }
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<PayExtras entity={p.entity ?? "all"} q={p.q} placeholder="Search" />}>
      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map(([k, l]) => <Link key={k} href={link({ view: k, page: undefined })} className={chip(view === k)}>{l}</Link>)}
      </div>
      <Card title={VIEWS.find((v) => v[0] === view)![1]}>{table}</Card>
    </FilterShell>
  );
}
