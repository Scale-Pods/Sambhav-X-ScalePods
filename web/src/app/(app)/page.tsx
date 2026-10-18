import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { bookTotals, recentSales, reviewCounts, stockByGrade } from "@/lib/queries";
import { date, kg, num, tonnes } from "@/lib/format";
import { Badge, Card, PageHeader, Skeleton, Stat, td, th } from "@/components/ui";

export default function Overview() {
  return (
    <>
      <PageHeader title="Stock overview" hint="What is in the yard right now, worked out from every purchase and sale, not typed by hand." />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Totals />
      </Suspense>
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card title="Stock by grade" aside={<Link href="/summary" className="flex items-center gap-1 text-sm font-medium text-brand">Full summary <ArrowRight className="h-4 w-4" /></Link>} className="xl:col-span-3">
          <Suspense fallback={<Skeleton />}>
            <Grades />
          </Suspense>
        </Card>
        <Card title="Needs your review" aside={<Link href="/review" className="flex items-center gap-1 text-sm font-medium text-brand">Open list <ArrowRight className="h-4 w-4" /></Link>} className="xl:col-span-2">
          <Suspense fallback={<Skeleton rows={3} />}>
            <Review />
          </Suspense>
        </Card>
      </div>
      <Card title="Latest sales entered" className="mt-6">
        <Suspense fallback={<Skeleton />}>
          <Recent />
        </Suspense>
      </Card>
    </>
  );
}

async function Totals() {
  const books = await bookTotals();
  const total = books.reduce((s, b) => s + num(b.kg), 0);
  const plates = books.reduce((s, b) => s + num(b.in_stock), 0);
  const sold = books.reduce((s, b) => s + num(b.sold), 0);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Total stock" value={tonnes(total)} unit="tonnes" sub={`${kg(total)} kg across both books`} tone="brand" />
      <Stat label="Plates in stock" value={kg(plates)} sub="each one traceable to its heat / plate number" />
      <Stat label="Sold so far" value={tonnes(sold)} unit="tonnes" sub="from the sales columns of both sheets" />
      <div className="rounded-xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
        <p className="text-[0.8rem] font-medium uppercase tracking-wide text-muted">By stock book</p>
        <div className="mt-3 space-y-3">
          {books.map((b) => (
            <div key={b.book}>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{b.book}</span>
                <span className="num text-[1.15rem] font-semibold">{tonnes(b.kg)} <span className="text-sm font-medium text-muted">t</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(4, (num(b.kg) / total) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[0.78rem] text-muted">{b.name}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function Grades() {
  const rows = await stockByGrade(9);
  const max = Math.max(...rows.map((r) => num(r.kg)), 1);
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.grade} className="flex items-center gap-4 px-5 py-3">
          <span className="w-44 shrink-0 truncate text-[0.93rem] font-medium">{r.grade}</span>
          <div className="h-2.5 flex-1 rounded-full bg-surface">
            <div className="h-2.5 rounded-full bg-brand" style={{ width: `${(num(r.kg) / max) * 100}%` }} />
          </div>
          <span className="num w-24 shrink-0 text-right font-semibold">{tonnes(r.kg)} t</span>
          <span className="num hidden w-20 shrink-0 text-right text-sm text-muted sm:block">{kg(r.lots)} plates</span>
        </li>
      ))}
    </ul>
  );
}

async function Review() {
  const rows = await reviewCounts();
  const by = Object.fromEntries(rows.map((r) => [r.severity, num(r.n)]));
  const total = rows.reduce((s, r) => s + num(r.n), 0);
  return (
    <div className="p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-amber-50 text-warn"><ShieldAlert className="h-5 w-5" /></span>
        <div>
          <p className="num text-2xl font-semibold leading-none">{kg(total)}</p>
          <p className="text-sm text-muted">items the sheets could not settle</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-red-50 py-2"><p className="num text-lg font-semibold text-bad">{by.error ?? 0}</p><p className="text-[0.72rem] font-semibold uppercase text-bad">Serious</p></div>
        <div className="rounded-lg bg-amber-50 py-2"><p className="num text-lg font-semibold text-warn">{by.warning ?? 0}</p><p className="text-[0.72rem] font-semibold uppercase text-warn">Check</p></div>
        <div className="rounded-lg bg-sky-50 py-2"><p className="num text-lg font-semibold text-brand-dark">{by.info ?? 0}</p><p className="text-[0.72rem] font-semibold uppercase text-brand-dark">Note</p></div>
      </div>
      <p className="mt-4 text-[0.88rem] leading-relaxed text-muted">
        Examples: sales with no date, plates sold for more than was received, purchases with no heat number. Nothing is changed silently; each item waits for a person to fix or approve it.
      </p>
    </div>
  );
}

async function Recent() {
  const rows = await recentSales(8);
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-line">
          <tr><th className={th}>Date</th><th className={th}>Grade</th><th className={th}>Plate / heat</th><th className={th + " text-right"}>Weight</th><th className={th}>Book</th><th className={th}>Where it came from</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-surface/60">
              <td className={td + " num whitespace-nowrap"}>{date(r.movement_date)}</td>
              <td className={td}>{r.grade}</td>
              <td className={td}><Link href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident}</Link></td>
              <td className={td + " num text-right font-medium"}>{kg(-num(r.weight_kg))} kg</td>
              <td className={td}><Badge>{r.book}</Badge></td>
              <td className={td + " max-w-md truncate text-muted"}>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
