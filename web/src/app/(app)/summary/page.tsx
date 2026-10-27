import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Download } from "lucide-react";
import { gradeOptions, summary, type SummaryRow } from "@/lib/analytics";
import { canExport, currentStaff } from "@/lib/auth";
import { filterParams, parseFilter, rangeLabel, todayIST, unitLabel, weight, type Unit } from "@/lib/filters";
import { date, mm } from "@/lib/format";
import { Card, PageHeader, Skeleton, td, th, Th } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function SummaryPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Summary" hint="Grade and thickness, like your Summary sheet. Balances are calculated from every purchase and sale, never typed." help="Plates grouped by grade and thickness. The weight columns add up the plates; “Plates left” counts the separate plates that still have material." />
      <Suspense fallback={<Card><Skeleton rows={12} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // these pages work out today's date: render them at request time, never while the shell is prepared
  const sp = await searchParams;
  const f = parseFilter(sp, "fy");
  const view = sp.view === "period" ? "period" : "sheet";
  // sheet view = everything up to the end date (no opening line); period view = opening + movements in the period + closing
  const [grades, rows, me] = await Promise.all([gradeOptions(), summary(view === "sheet" ? { ...f, from: null } : f, null), currentStaff()]);
  const u = f.unit;
  const asOf = f.to ?? todayIST();
  const base = new URLSearchParams(filterParams(f, "fy"));
  const viewHref = (v: string) => { const p = new URLSearchParams(base); if (v === "period") p.set("view", "period"); return `/summary?${p}`; };
  const exportHref = (() => { const p = new URLSearchParams(base); p.set("view", view); return `/api/export/summary?${p}`; })();

  const byGrade = new Map<string, SummaryRow[]>();
  rows.forEach((r) => byGrade.set(r.grade, [...(byGrade.get(r.grade) ?? []), r]));
  const sum = (list: SummaryRow[]) => list.reduce((a, r) => ({ opening: a.opening + r.opening, received: a.received + r.received, sold: a.sold + r.sold, closing: a.closing + r.closing, plates: a.plates + r.plates }), { opening: 0, received: 0, sold: 0, closing: 0, plates: 0 });
  const total = sum(rows);
  const cols = view === "period"
    ? [["opening", f.from ? `Opening (${date(f.from)})` : "Opening"], ["received", "Received"], ["sold", "Sold"], ["closing", `Closing (${date(asOf)})`]] as const
    : [["received", "Purchased"], ["sold", "Sold"], ["closing", "Balance"]] as const;
  const val = (r: { opening: number; received: number; sold: number; closing: number }, k: string) => (r as Record<string, number>)[k];

  return (
    <FilterShell grades={grades}>
      <Card
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-line text-[0.85rem] font-medium">
              <Link href={viewHref("sheet")} className={"px-3 py-1.5 " + (view === "sheet" ? "bg-ink text-surface" : "bg-field text-muted hover:text-ink")}>Sheet view</Link>
              <Link href={viewHref("period")} className={"px-3 py-1.5 " + (view === "period" ? "bg-ink text-surface" : "bg-field text-muted hover:text-ink")}>Period view</Link>
            </div>
            {canExport(me?.role) && (
              <a href={exportHref} className="flex items-center gap-1.5 rounded-md border border-line bg-field px-3 py-1.5 text-[0.85rem] font-medium text-muted hover:text-ink">
                <Download className="h-4 w-4" /> Excel / CSV
              </a>
            )}
          </div>
        }
        title={view === "period" ? `Stock statement, ${rangeLabel(f)}` : `Position on ${date(asOf)}`}
      >
        {rows.length === 0 ? <p className="px-5 py-14 text-center text-muted">Nothing matches these filters.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-surface/60">
                <tr>
                  <Th>Grade</Th><Th>Thickness</Th>
                  {cols.map(([k, l]) => <th key={k} className={th + " whitespace-nowrap text-right"}>{l} ({unitLabel(u)})</th>)}
                  <Th right>Plates left</Th>
                </tr>
              </thead>
              <tbody>
                {[...byGrade.entries()].map(([g, list]) => {
                  const s = sum(list);
                  return (
                    <GradeBlock key={g} grade={g} list={list} sub={s} cols={cols.map((c) => c[0])} val={val} unit={u} />
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-line bg-accent-soft/50">
                <tr>
                  <td className={td + " font-display font-bold"} colSpan={2}>Total</td>
                  {cols.map(([k]) => <td key={k} className={td + " num text-right font-bold"}>{weight(val(total, k), u)}</td>)}
                  <td className={td + " num text-right font-bold"}>{total.plates}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </FilterShell>
  );
}

function GradeBlock({ grade, list, sub, cols, val, unit }: {
  grade: string; list: SummaryRow[]; sub: { opening: number; received: number; sold: number; closing: number; plates: number };
  cols: readonly string[]; val: (r: { opening: number; received: number; sold: number; closing: number }, k: string) => number; unit: Unit;
}) {
  return (
    <>
      <tr className="border-t border-line bg-surface/70">
        <td className={td + " font-semibold"} colSpan={2}><Link href={`/stock?g=${encodeURIComponent(grade)}`} className="hover:text-brand hover:underline">{grade}</Link></td>
        {cols.map((k) => <td key={k} className={td + " num text-right font-semibold"}>{weight(val(sub, k), unit)}</td>)}
        <td className={td + " num text-right font-semibold"}>{sub.plates}</td>
      </tr>
      {list.map((r) => (
        <tr key={r.thk} className="border-t border-line/70 hover:bg-brand-soft/30">
          <td className={td}></td>
          <td className={td + " num"}>{mm(r.thk)} mm</td>
          {cols.map((k) => <td key={k} className={td + " num text-right " + (k === "closing" && r.closing < -0.5 ? "font-semibold text-bad" : "")}>{weight(val(r, k), unit)}</td>)}
          <td className={td + " num text-right text-muted"}>{r.plates}</td>
        </tr>
      ))}
    </>
  );
}
