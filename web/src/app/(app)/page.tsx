import Link from "next/link";
import { Suspense } from "react";
import { ageing, gradeOptions, heatmap, kpis, recentSales, stockByGrade, timeline, topSold } from "@/lib/analytics";
import { parseFilter, periodLabel, rangeLabel, todayIST, unitLabel, weight, type Filter } from "@/lib/filters";
import { date, num } from "@/lib/format";
import { Badge, Card, PageHeader, StatsSkeleton, Skeleton, Stat, td, th, type Delta } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { AgeChart, HBarChart, Heatmap, InOutChart, StockLevelChart } from "@/components/charts/Charts";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function Overview({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Stock overview" hint="What came in, what went out and what is left, worked out from every purchase and sale, never typed by hand." />
      <Suspense fallback={<><StatsSkeleton /><Card className="mt-6"><Skeleton rows={8} /></Card></>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function change(now: number, before: number | null, goodWhenUp: boolean | null, f: Filter): Delta | undefined {
  if (before == null) return undefined;
  if (before === 0) return { text: now ? "nothing in the previous period" : "no movement either period", tone: "neutral", up: null };
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  const tone = goodWhenUp === null || pct === 0 ? "neutral" : up === goodWhenUp ? "good" : "bad";
  return { text: `${Math.abs(pct)}% vs previous ${f.preset === "fy" || f.preset === "lastfy" ? "period" : "same length"}`, tone, up: pct === 0 ? null : up };
}

async function Body({ searchParams }: { searchParams: SP }) {
  const f = parseFilter(await searchParams, "fy");
  const [grades, k, tl, byGrade, ages, sold, heat, recent] = await Promise.all([
    gradeOptions(), kpis(f), timeline(f), stockByGrade(f), ageing(f), topSold(f), heatmap(f), recentSales(f),
  ]);
  const u = f.unit;
  const asOf = f.to ?? todayIST();
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (f.book) p.set("book", f.book);
    if (u === "kg") p.set("u", "kg");
    return `/stock?${p}`;
  };

  return (
    <FilterShell grades={grades}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">
        Showing <span className="font-semibold text-ink">{periodLabel(f)}</span> ({rangeLabel(f)}). Stock figures are as of <span className="font-semibold text-ink">{date(asOf)}</span>.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label={`Stock on ${date(asOf)}`} value={weight(k.stock, u)} unit={unitLabel(u)} sub={`${weight(k.stock, "kg")} kg`} />
        <Stat label="Received in period" value={weight(k.received, u)} unit={unitLabel(u)} delta={change(k.received, k.prevReceived, null, f)} />
        <Stat label="Sold in period" value={weight(k.sold, u)} unit={unitLabel(u)} delta={change(k.sold, k.prevSold, true, f)} />
        <Stat label="Plates in stock" value={new Intl.NumberFormat("en-IN").format(k.plates)} sub="each traceable to its heat / plate no." />
        <Link href="/review" className="block rounded-lg focus-visible:outline-2">
          <Stat label="Needs review" value={new Intl.NumberFormat("en-IN").format(k.review)} tone="accent" sub="items the sheets could not settle →" />
        </Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3"><InOutChart points={tl.points} bucket={tl.bucket} unit={u} note={tl.clipped ? "last 24 months shown" : undefined} /></div>
        <div className="xl:col-span-2"><StockLevelChart points={tl.points} bucket={tl.bucket} unit={u} /></div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <HBarChart
            title="Stock by grade"
            subtitle={`What is left on ${date(asOf)}; click a grade to see its plates`}
            rows={byGrade.map((r) => ({ label: r.grade, kg: r.kg, extra: `${r.plates} plates`, href: r.grade.startsWith("Other grades") ? null : keep({ g: r.grade }) }))}
            unit={u} tone="in" valueLabel="Stock"
          />
        </div>
        <div className="xl:col-span-2"><AgeChart rows={ages} unit={u} /></div>
      </div>

      <div className="mt-6">
        <Heatmap grades={heat.grades} thicknesses={heat.thicknesses} cells={heat.cells} unit={u} hrefs={Object.fromEntries(heat.grades.map((g) => [g, keep({ g })]))} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <HBarChart title="Fastest-moving grades" subtitle={`Sold in ${rangeLabel(f)}`} rows={sold.map((r) => ({ label: r.grade, kg: r.kg, href: keep({ g: r.grade }) }))} unit={u} tone="out" valueLabel="Sold" />
        </div>
        <Card title="Latest sales" className="xl:col-span-3">
          {recent.length === 0 ? <p className="px-5 py-12 text-center text-[0.9rem] text-muted">No sales in this period with these filters.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line">
                  <tr><th className={th}>Date</th><th className={th}>Grade</th><th className={th}>Plate / heat</th><th className={th + " text-right"}>Weight</th><th className={th}>Book</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recent.map((r, i) => (
                    <tr key={i} className="hover:bg-surface/60">
                      <td className={td + " num whitespace-nowrap"}>{date(r.movement_date)}</td>
                      <td className={td}>{r.grade}</td>
                      <td className={td}><Link href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident}</Link></td>
                      <td className={td + " num whitespace-nowrap text-right font-medium"}>{weight(-num(r.weight_kg), u)} {unitLabel(u)}</td>
                      <td className={td}><Badge>{r.book}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </FilterShell>
  );
}
