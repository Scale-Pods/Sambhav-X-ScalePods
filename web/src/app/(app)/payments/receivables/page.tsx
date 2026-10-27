import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { ParamSelect } from "@/components/FilterBar";
import { PayBar } from "@/components/PayBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, readPayParams, receivablesList, type ReceivableRow } from "@/lib/payments";
import { amount, rupeesShort } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function ReceivablesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // "late" depends on today's date
  const sp = await searchParams;
  const p = readPayParams(sp);
  const d = await receivablesList(p);
  const link = linker("/payments/receivables", sp);
  const cols: Col<ReceivableRow>[] = [
    { label: "Customer", cell: (r) => <span className="font-semibold">{r.party}</span>, nowrap: false },
    { label: "Company", info: "The business the entry belongs to: SPF is Sambhav Pipes & Fittings, Sai is Sai Steel & Engineering.", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Invoice", info: "The invoice number as typed in the payment sheet.", cell: (r) => r.invoice_no },
    { label: "Date", cell: (r) => day(r.invoice_date) },
    { label: "Due", info: "The payment date: the invoice date plus the credit days. Past it and unpaid means overdue.", cell: (r) => day(r.due_date) },
    { label: "PO no.", cell: (r) => r.po_no },
    { label: "Salesperson", cell: (r) => r.salesperson },
    { label: "Invoice (₹)", right: true, cell: (r) => amount(r.amount) },
    { label: "Received (₹)", right: true, cell: (r) => (Number(r.received) ? amount(r.received) : "") },
    { label: "Owed (₹)", right: true, cell: (r) => <span className="font-semibold">{amount(r.pending)}</span> },
    { label: "Late", right: true, cell: (r) => (Number(r.overdue_days) > 0 && Number(r.pending) > 0 ? <span className={Number(r.overdue_days) > 90 ? "font-semibold text-bad" : Number(r.overdue_days) > 30 ? "text-warn" : ""}>{r.overdue_days} d</span> : "") },
    { label: "Note", info: "Blocked means the money is stuck and needs follow-up. Any other label is the sheet's own note, shown as written.", cell: (r) => (r.kind ? <Badge tone={r.kind === "Blocked" ? "error" : r.kind === "Market" ? "info" : "warning"}>{r.kind}</Badge> : null) },
  ];
  return (
    <>
      <PayBar entity={p.entity ?? "all"} q={p.q} placeholder="Customer, invoice, PO, salesperson">
        <ParamSelect name="show" label="Show" value={p.show} options={[{ value: "all", label: "Everything" }, { value: "open", label: "Still owed" }, { value: "overdue", label: "Past the due date" }, { value: "blocked", label: "Blocked" }]} />
      </PayBar>
      <Card title="Debtors: who owes us">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="Owed" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-receivables")} format={rupeesShort} />
      </Card>
    </>
  );
}
