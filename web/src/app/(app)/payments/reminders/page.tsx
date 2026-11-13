import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { PayTable, type Col } from "@/components/PayList";
import { overdueDebtors, type Debtor } from "@/lib/reminders";
import { rupees } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function RemindersPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={10} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // "overdue" depends on today's date
  const sp = await searchParams;
  const entity = sp.entity === "SPF" || sp.entity === "SAI" ? sp.entity : null;
  const rows = await overdueDebtors(entity);
  const total = rows.reduce((a, r) => a + r.pending, 0);
  const cols: Col<Debtor>[] = [
    { label: "Customer", cell: (r) => <span className="font-semibold">{r.party}</span>, nowrap: false },
    { label: "Company", info: "The business the entry belongs to: SPF is Sambhav Pipes & Fittings, Sai is Sai Steel & Engineering.", cell: (r) => (r.entity === "SAI" ? "Sai" : "SPF") },
    { label: "Overdue invoices", right: true, cell: (r) => r.invoices },
    { label: "Overdue amount (₹)", right: true, cell: (r) => <span className="font-semibold">{rupees(r.pending)}</span> },
    { label: "Oldest overdue", info: "Days since the oldest unpaid invoice passed its due date.", right: true, cell: (r) => <span className={r.oldest_days > 90 ? "font-semibold text-bad" : r.oldest_days > 30 ? "text-warn" : ""}>{r.oldest_days} d</span> },
    { label: "", cell: (r) => <Link href={`/payments/reminders/prepare?${new URLSearchParams({ party: r.party, entity: r.entity })}`} className="rounded-md border border-line bg-field px-2.5 py-1 text-[0.82rem] font-medium text-brand hover:border-brand">Prepare reminder</Link> },
  ];
  return (
    <>
      <p className="-mt-2 mb-5 max-w-3xl text-[0.92rem] text-muted">Customers with unpaid invoices past their due date. Open one to see the reminder e-mail the app has prepared from the Debtors list: a statement of what is pending and what is falling due, ready to check, adjust and send.</p>
      <Card title="Customers to remind" aside={<span className="text-[0.85rem] text-muted">{rows.length} customers · {rupees(total)} overdue</span>}>
        <PayTable cols={cols} rows={rows} empty="No customer has an overdue invoice." />
      </Card>
    </>
  );
}
