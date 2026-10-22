import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { FileLink, ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE, expensesList, readPayParams, type ExpenseRow } from "@/lib/payments";
import { amount, rupeesShort } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function ExpensesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readPayParams(sp);
  const d = await expensesList(p);
  const link = linker("/payments/expenses", sp);
  const cols: Col<ExpenseRow>[] = [
    { label: "Date", cell: (r) => day(r.invoice_date) },
    { label: "Type", cell: (r) => <span className="font-semibold">{r.category}</span> },
    { label: "Company", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Paid to", cell: (r) => r.vendor, nowrap: false },
    { label: "Invoice", cell: (r) => r.invoice_no },
    { label: "Amount (₹)", right: true, cell: (r) => <span className="font-medium">{amount(r.amount)}</span> },
    { label: "TDS", right: true, cell: (r) => (r.tds && Number(r.tds) ? amount(r.tds) : "") },
    { label: "Checked by", cell: (r) => r.checked_by },
    { label: "Bill", cell: (r) => <FileLink url={r.file_url} /> },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<PayExtras entity={p.entity ?? "all"} q={p.q} placeholder="Type, supplier, invoice" />}>
      <Card title="Expenses">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="Spent" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/pay-expenses")} format={rupeesShort} />
      </Card>
    </FilterShell>
  );
}
