import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { ParamSelect } from "@/components/FilterBar";
import { PayBar } from "@/components/PayBar";
import { FileLink, ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, payablesList, readPayParams, type PayableRow } from "@/lib/payments";
import { amount, rupeesShort } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function PayablesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readPayParams(sp);
  const d = await payablesList(p);
  const link = linker("/payments/payables", sp);
  const cols: Col<PayableRow>[] = [
    { label: "Supplier", cell: (r) => <span className="font-semibold">{r.vendor}</span>, nowrap: false },
    { label: "Company", info: "The business the entry belongs to: SPF is Sambhav Pipes & Fittings, Sai is Sai Steel & Engineering.", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Invoice", info: "The invoice number as typed in the payment sheet.", cell: (r) => r.invoice_no },
    { label: "Date", cell: (r) => day(r.invoice_date) },
    { label: "Due", info: "The payment date: the invoice date plus the credit days.", cell: (r) => day(r.due_date) },
    { label: "Bought for", cell: (r) => r.purchased_for },
    { label: "Broker", cell: (r) => r.broker },
    { label: "Invoice (₹)", right: true, cell: (r) => amount(r.amount) },
    { label: "Advance (₹)", right: true, cell: (r) => (Number(r.advance) ? amount(r.advance) : "") },
    { label: "TDS (₹)", right: true, cell: (r) => (Number(r.tds) ? amount(r.tds) : "") },
    { label: "To pay (₹)", right: true, cell: (r) => <span className="font-semibold">{amount(r.pending)}</span> },
    { label: "Late", right: true, cell: (r) => (Number(r.overdue_days) > 0 && Number(r.pending) > 0 ? <span className={Number(r.overdue_days) > 30 ? "font-semibold text-bad" : "text-warn"}>{r.overdue_days} d</span> : "") },
    { label: "Checked", cell: (r) => (r.checked ? <Badge tone="ok">Checked</Badge> : null) },
    { label: "Bill", info: "A link to the bill file (scan or PDF).", cell: (r) => <FileLink url={r.file_url} /> },
    { label: "Note", info: "The remark written against the bill in the payment sheet.", cell: (r) => r.remark, nowrap: false },
  ];
  return (
    <>
      <PayBar entity={p.entity ?? "all"} q={p.q} placeholder="Supplier, invoice, broker">
        <ParamSelect name="show" label="Show" value={p.show} options={[{ value: "all", label: "Everything" }, { value: "open", label: "Still to pay" }, { value: "overdue", label: "Past the due date" }]} />
      </PayBar>
      <Card title="Creditors: who we owe">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="To pay" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-payables")} format={rupeesShort} />
      </Card>
    </>
  );
}
