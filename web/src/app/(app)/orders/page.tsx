import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { orderOverview, readOrderParams } from "@/lib/orders";
import { periodLabel } from "@/lib/filters";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { CountHBar, OrdersByMonthChart } from "@/components/charts/OrderCharts";
import { day } from "@/components/PayList";
import { Card, Skeleton, Stat, StatsSkeleton, td, th } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default function OrdersOverview({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<><StatsSkeleton /><div className="mt-6"><Card><Skeleton rows={8} /></Card></div></>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // the period and "late" depend on today's date
  const sp = await searchParams;
  const p = readOrderParams(sp);
  const o = await orderOverview(p);
  const keep = (path: string, extra: Record<string, string> = {}) => {
    const u = new URLSearchParams(extra);
    ["entity", "p", "from", "to"].forEach((k) => sp[k] && u.set(k, sp[k]!));
    return `${path}${u.toString() ? "?" + u : ""}`;
  };
  const matTotal = o.material.reduce((a, m) => a + m.value, 0) || 1;
  const pct = (label: string) => Math.round(((o.material.find((m) => m.label === label)?.value ?? 0) / matTotal) * 100);

  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]} extra={<PayExtras entity={p.company ?? "all"} />}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">
        Orders received in <span className="font-semibold text-ink">{periodLabel(p.f)}</span>{p.company ? ` · ${p.company === "SAI" ? "Sai" : "SPF"} only` : " · SPF and Sai together"}. Open orders are today&apos;s position, whatever the period.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href={keep("/orders/list", { show: "open" })} className="block rounded-lg focus-visible:outline-2"><Stat label="Open orders" value={String(o.open.n)} sub={`${o.open.lines} lines still to send`} tone="accent" /></Link>
        <Link href={keep("/orders/list", { show: "late" })} className="block rounded-lg focus-visible:outline-2"><Stat label="Past the delivery date" value={String(o.open.late)} sub="open, and the promised date has gone" /></Link>
        <Link href={keep("/orders/list")} className="block rounded-lg focus-visible:outline-2"><Stat label="Orders received" value={String(o.period.n)} sub={`${o.period.lines.toLocaleString("en-IN")} lines · ${o.period.done} completed`} /></Link>
        <Stat label="From stock / bought for it" value={`${pct("stock")}% / ${pct("purchase")}%`} sub="share of order lines" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3"><OrdersByMonthChart points={o.monthly} /></div>
        <div className="xl:col-span-2">
          <Card title="Open orders, oldest delivery date first">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-surface/60"><tr><th className={th}>Order</th><th className={th}>Customer</th><th className={th}>Due</th><th className={th + " text-right"}>Lines</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {o.openOldest.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">No open orders.</td></tr>}
                  {o.openOldest.map((r) => (
                    <tr key={r.order_no} className="hover:bg-surface/60">
                      <td className={td}><Link href={`/orders/${r.order_no}`} className="font-semibold text-brand hover:underline">{r.order_no}</Link></td>
                      <td className={td + " max-w-[12rem] truncate"} title={r.client ?? ""}>{r.client}</td>
                      <td className={td + " whitespace-nowrap"}>{day(r.etd)}</td>
                      <td className={td + " num text-right"}>{r.done_lines}/{r.lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <CountHBar title="Who orders the most" subtitle={periodLabel(p.f) + ", top 10 customers"} rows={o.topClients} tone="in" head="Customer" unit="orders" />
        <CountHBar title="Orders by salesperson" subtitle={periodLabel(p.f)} rows={o.bySales} tone="in" head="Salesperson" unit="orders" />
        <CountHBar title="Most ordered grades" subtitle={periodLabel(p.f) + ", top 10"} rows={o.grades} tone="out" head="Grade" unit="orders" />
        <CountHBar title="Transporters used" subtitle={periodLabel(p.f) + ", top 8"} rows={o.transport} tone="out" head="Transporter" unit="orders" />
      </div>
    </FilterShell>
  );
}
