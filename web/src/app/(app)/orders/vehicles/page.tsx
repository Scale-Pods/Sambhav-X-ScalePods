import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton, Stat, StatsSkeleton, td, th } from "@/components/ui";
import { FilterShell, ParamSelect } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { CountHBar, TonnesByMonthChart } from "@/components/charts/OrderCharts";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { periodLabel } from "@/lib/filters";
import { readOrderParams, tripsList, vehiclesOverview, type TripRow } from "@/lib/orders";
import { PAGE_SIZE } from "@/lib/payments";

type SP = Promise<Record<string, string | undefined>>;
const t1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export default function VehiclesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<><StatsSkeleton /><div className="mt-6"><Card><Skeleton rows={8} /></Card></div></>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readOrderParams(sp);
  const [o, d] = await Promise.all([vehiclesOverview(p), tripsList(p)]);
  const link = linker("/orders/vehicles", sp);
  const cols: Col<TripRow>[] = [
    { label: "Date", cell: (r) => day(r.dispatch_date) },
    { label: "Vehicle", cell: (r) => <span className="font-semibold">{r.vehicle_no}</span> },
    { label: "Yard", cell: (r) => (r.plot === "D15" ? "Plot D-15" : "Plot 753") },
    { label: "Grade", cell: (r) => r.grade },
    { label: "Invoice", cell: (r) => r.invoice_no },
    { label: "For", cell: (r) => r.entity },
    { label: "Weight (kg)", right: true, cell: (r) => (r.weight_kg ? Math.round(Number(r.weight_kg)).toLocaleString("en-IN") : "") },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]}
      extra={<><PayExtras entity={p.company ?? "all"} q={p.q} placeholder="Vehicle, grade, invoice" />
        <ParamSelect name="plot" label="Yard" value={p.plot} options={[{ value: "all", label: "Both yards" }, { value: "D15", label: "Plot D-15" }, { value: "753", label: "Plot 753" }]} /></>}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">Trips from the <span className="font-semibold text-ink">DISPATCH 26-27</span> register, {periodLabel(p.f)}. Weights are as typed in the register.</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Trips" value={o.trips.toLocaleString("en-IN")} tone="accent" />
        <Stat label="Sent out" value={t1.format(o.kg / 1000)} unit="t" sub={`${Math.round(o.kg).toLocaleString("en-IN")} kg`} />
        <Stat label="Without a readable date" value={String(o.undated)} sub="trips left out of the months below" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3"><TonnesByMonthChart points={o.monthly} /></div>
        <div className="space-y-6 xl:col-span-2">
          <CountHBar title="For whom" subtitle="Tonnes sent out, by company" rows={o.byEntity.map((r) => ({ label: r.label, value: r.kg / 1000, extra: `${r.n} trips` }))} tone="in" head="Company" unit="t" />
        </div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <CountHBar title="Grades sent out" subtitle="Top 10 by tonnes" rows={o.byGrade.map((r) => ({ label: r.label, value: r.kg / 1000, extra: `${r.n} trips` }))} tone="out" head="Grade" unit="t" />
        <Card title="Checked against the register's own monthly totals">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-surface/60"><tr><th className={th}>Month</th><th className={th + " text-right"}>Plot 753 (t)</th><th className={th + " text-right"}>Plot D-15 (t)</th><th className={th + " text-right"}>RS + SAM (t)</th></tr></thead>
              <tbody className="divide-y divide-line">
                {o.typed.map((r) => (
                  <tr key={r.month}><td className={td + " font-medium"}>{r.month}</td><td className={td + " num text-right"}>{t1.format(r.p753 / 1000)}</td><td className={td + " num text-right"}>{t1.format(r.d15 / 1000)}</td><td className={td + " num text-right"}>{t1.format(r.rs / 1000)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3 text-[0.82rem] text-muted">These are the totals typed on the sheet&apos;s summary tab, for comparison with the trips listed below.</p>
        </Card>
      </div>

      <Card title="Trips" className="mt-6">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="Weight" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} format={(v) => `${t1.format(v / 1000)} t`} />
      </Card>
    </FilterShell>
  );
}
