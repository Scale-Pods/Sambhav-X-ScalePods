import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, readPayParams, salesList, type SalesRow } from "@/lib/payments";
import { rupeesShort, rupees2 } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function SalesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // the period depends on today's date
  const sp = await searchParams;
  const p = readPayParams(sp);
  const d = await salesList(p);
  const link = linker("/payments/sales", sp);
  const cols: Col<SalesRow>[] = [
    { label: "Date", cell: (r) => day(r.invoice_date) },
    { label: "Invoice", cell: (r) => <span className="font-semibold">{r.invoice_no}{r.fy_mismatch && <span title="The date does not match the year in the invoice number" className="ml-1.5"><Badge tone="warning">check year</Badge></span>}</span> },
    { label: "Company", info: "The business the entry belongs to: SPF is Sambhav Pipes & Fittings, Sai is Sai Steel & Engineering.", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Customer", cell: (r) => r.client, nowrap: false },
    { label: "Salesperson", cell: (r) => r.salesperson },
    { label: "PO no.", cell: (r) => r.po_no },
    { label: "Amount", right: true, cell: (r) => <span className="font-medium">{rupees2(r.amount)}</span> },
    { label: "Days", info: "Credit days: how many days after the invoice the payment is allowed.", right: true, cell: (r) => r.credit_days },
    { label: "Due", info: "The payment date: the invoice date plus the credit days.", cell: (r) => day(r.due_date) },
    { label: "Transporter", cell: (r) => r.transporter },
    { label: "Made by", cell: (r) => r.made_by },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<PayExtras entity={p.entity ?? "all"} q={p.q} placeholder="Invoice, customer, PO, salesperson" />}>
      <Card title="Sales invoices">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="Invoiced" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-sales")} format={rupeesShort} />
      </Card>
    </FilterShell>
  );
}
