import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { payOverview, readPayParams } from "@/lib/payments";
import { periodLabel } from "@/lib/filters";
import { rupeesShort } from "@/lib/money";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { AgeingChart, MoneyHBar, SalesPurchaseChart } from "@/components/charts/MoneyCharts";
import { Card, Skeleton, Stat, StatsSkeleton } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default function PaymentsOverview({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<><StatsSkeleton /><div className="mt-6"><Card><Skeleton rows={8} /></Card></div></>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // the period depends on today's date
  const sp = await searchParams;
  const p = readPayParams(sp);
  const o = await payOverview(p);
  const keep = (path: string, extra: Record<string, string> = {}) => {
    const u = new URLSearchParams(extra);
    ["entity", "p", "from", "to"].forEach((k) => sp[k] && u.set(k, sp[k]!));
    return `${path}${u.toString() ? "?" + u : ""}`;
  };
  const diff = o.typed.debtors && !p.entity ? o.rec.total - o.typed.debtors : null;

  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<PayExtras entity={p.entity ?? "all"} />}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">
        Invoices and expenses for <span className="font-semibold text-ink">{periodLabel(p.f)}</span>{p.entity ? ` · ${p.entity === "SAI" ? "Sai" : "SPF"} only` : " · SPF and Sai together"}. Debtors and creditors are today&apos;s position, whatever the period.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href={keep("/payments/receivables")} className="block rounded-lg focus-visible:outline-2"><Stat label="Customers owe us" value={rupeesShort(o.rec.total)} sub={`${o.rec.n} open invoices`} tone="accent" /></Link>
        <Link href={keep("/payments/receivables", { show: "overdue" })} className="block rounded-lg focus-visible:outline-2"><Stat label="Past the due date" value={rupeesShort(o.rec.overdue)} sub={o.rec.total ? `${Math.round((o.rec.overdue / o.rec.total) * 100)}% of what is owed` : undefined} /></Link>
        <Link href={keep("/payments/payables")} className="block rounded-lg focus-visible:outline-2"><Stat label="We owe suppliers" value={rupeesShort(o.pay.total)} sub={`${rupeesShort(o.pay.overdue)} past the due date`} /></Link>
        <Stat label="Blocked debtors" value={rupeesShort(o.rec.blocked)} sub="marked Blocked in the sheet" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Link href={keep("/payments/sales")} className="block rounded-lg focus-visible:outline-2"><Stat label="Sales invoiced" value={rupeesShort(o.sales.s)} sub={`${o.sales.n.toLocaleString("en-IN")} invoices`} /></Link>
        <Link href={keep("/payments/purchases")} className="block rounded-lg focus-visible:outline-2"><Stat label="Purchases invoiced" value={rupeesShort(o.purchases.s)} sub={`${o.purchases.n.toLocaleString("en-IN")} invoices`} /></Link>
        <Link href={keep("/payments/expenses")} className="block rounded-lg focus-visible:outline-2"><Stat label="Expenses" value={rupeesShort(o.expenses.s)} sub={`${o.expenses.n.toLocaleString("en-IN")} bills`} /></Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3"><SalesPurchaseChart points={o.monthly} /></div>
        <div className="xl:col-span-2"><AgeingChart rows={o.ageing} /></div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <MoneyHBar title="Who owes us the most" subtitle="Open invoices, today" rows={o.topDebtors} tone="in" head="Customer" />
        <MoneyHBar title="Owed, by salesperson" subtitle="Open invoices, today" rows={o.byPerson} tone="in" head="Salesperson" />
        <MoneyHBar title="Who we owe the most" subtitle="Open supplier invoices, today" rows={o.topCreditors} tone="out" head="Supplier" />
        <MoneyHBar title="Expenses by type" subtitle={`${periodLabel(p.f)}, top 8`} rows={o.expByCat} tone="out" head="Type" />
      </div>

      <Card title="Checked against your sheets" className="mt-6">
        <div className="space-y-2 px-5 py-4 text-[0.9rem] text-muted">
          {diff != null ? (
            <p>The total owed by customers, worked out from every open invoice, is <span className="font-semibold text-ink">{rupeesShort(o.rec.total)}</span>. The sheet&apos;s own typed total is <span className="font-semibold text-ink">{rupeesShort(o.typed.debtors)}</span>{Math.abs(diff) < 1000 ? ": they agree." : `: a difference of ${rupeesShort(Math.abs(diff))}.`}</p>
          ) : <p>Choose SPF and Sai together to compare the total owed with the sheet&apos;s typed total.</p>}
          {o.dupSales > 0 && <p>{o.dupSales} sales invoice numbers were entered twice in the form. Each is counted once here.</p>}
          {(o.undatedSales > 0 || o.undatedPurchases > 0) && <p>{o.undatedSales} sales and {o.undatedPurchases} purchase invoices have a date that is missing or impossible. They are left out of period totals but still listed.</p>}
        </div>
      </Card>
    </FilterShell>
  );
}
