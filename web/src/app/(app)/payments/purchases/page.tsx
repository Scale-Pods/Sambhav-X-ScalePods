import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { FileLink, ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, purchasesList, readPayParams, type PurchaseRow } from "@/lib/payments";
import { rupees2, rupeesShort } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function PurchasesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readPayParams(sp);
  const d = await purchasesList(p);
  const link = linker("/payments/purchases", sp);
  const cols: Col<PurchaseRow>[] = [
    { label: "Date", cell: (r) => day(r.invoice_date) },
    { label: "Invoice", info: "The invoice number as typed in the payment sheet.", cell: (r) => <span className="font-semibold">{r.invoice_no}</span> },
    { label: "Company", info: "The business the entry belongs to: SPF is Sambhav Pipes & Fittings, Sai is Sai Steel & Engineering.", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Supplier", cell: (r) => r.vendor, nowrap: false },
    { label: "Purchased for", cell: (r) => r.purchased_for },
    { label: "Amount", right: true, cell: (r) => <span className="font-medium">{rupees2(r.amount)}</span> },
    { label: "Days", info: "Credit days: how many days after the invoice the payment is allowed.", right: true, cell: (r) => r.credit_days },
    { label: "Due", info: "The payment date: the invoice date plus the credit days.", cell: (r) => day(r.due_date) },
    { label: "Broker", cell: (r) => r.broker },
    { label: "Bought by", cell: (r) => r.purchased_by },
    { label: "Checked by", cell: (r) => r.checked_by },
    { label: "Bill", info: "A link to the bill file (scan or PDF).", cell: (r) => <FileLink url={r.file_url} /> },
    { label: "Pay", info: "Prepares the RTGS / NEFT form for this invoice as an Excel file: the supplier's bank details are read from its bill.", cell: (r) => (Number(r.amount) > 0 && r.invoice_no && r.vendor ? <Link prefetch={false} href={`/payments/purchases/rtgs?${new URLSearchParams({ inv: r.invoice_no, party: r.vendor, entity: r.entity })}`} className="rounded-md border border-line bg-field px-2 py-1 text-[0.78rem] font-medium text-brand hover:border-brand">RTGS form</Link> : null) },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<PayExtras entity={p.entity ?? "all"} q={p.q} placeholder="Invoice, supplier, broker" />}>
      <Card title="Purchase invoices">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="Purchased" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-purchases")} format={rupeesShort} />
      </Card>
    </FilterShell>
  );
}
