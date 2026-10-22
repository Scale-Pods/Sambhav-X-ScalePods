import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { FileLink, ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, purchasesList, readPayParams, type PurchaseRow } from "@/lib/payments";
import { amount, rupeesShort } from "@/lib/money";

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
    { label: "Invoice", cell: (r) => <span className="font-semibold">{r.invoice_no}</span> },
    { label: "Company", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Supplier", cell: (r) => r.vendor, nowrap: false },
    { label: "Purchased for", cell: (r) => r.purchased_for },
    { label: "Amount (₹)", right: true, cell: (r) => <span className="font-medium">{amount(r.amount)}</span> },
    { label: "Weight", right: true, cell: (r) => (r.weight ? `${amount(r.weight)} ${r.unit ?? ""}` : "") },
    { label: "Rate", right: true, cell: (r) => (r.rate ? amount(r.rate) : "") },
    { label: "Days", right: true, cell: (r) => r.credit_days },
    { label: "Due", cell: (r) => day(r.due_date) },
    { label: "Broker", cell: (r) => r.broker },
    { label: "Bought by", cell: (r) => r.purchased_by },
    { label: "Checked by", cell: (r) => r.checked_by },
    { label: "Bill", cell: (r) => <FileLink url={r.file_url} /> },
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
