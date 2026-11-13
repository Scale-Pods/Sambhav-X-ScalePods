import type { Fmt } from "@/lib/summaryFormat";

const n0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const f = (v: number | null) => (v == null ? "" : n0.format(Math.round(v)));
const f2 = (v: number | null) => (v == null ? "" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v));
const dmy = (iso: string) => iso.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("-");

const hd = "whitespace-nowrap bg-steel px-2.5 py-2 text-[0.72rem] font-bold uppercase tracking-wide text-steel-ink";
const td = "whitespace-nowrap border-t border-line px-2.5 py-1.5 text-[0.84rem]";

/** One book's Summary, laid out like the Summary tab of its stock sheet. */
export function SheetFormat({ d, asOf }: { d: Fmt; asOf: string }) {
  return (
    <div className="space-y-2">
      <h3 className="font-display text-[0.95rem] font-bold">{d.title}</h3>
      <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "max(22rem, calc(100dvh - 16rem))" }}>
        <table className="w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={hd + " text-left"}>Grade</th><th className={hd + " text-left"}>Thk</th>
              {d.withPur ? <><th className={hd + " text-right"}>Avg rate</th><th className={hd + " text-right"}>Total pur</th><th className={hd + " text-right"}>Total sale</th></>
                : <><th className={hd + " text-right"}>Avg rate</th><th className={hd + " text-right"}>Total sale</th></>}
              {d.withPur && <th className={hd + " text-right"}>{dmy(asOf)}</th>}
              {d.quarters.map((qq) => <th key={qq.label} className={hd + " text-right"}>{qq.label}<span className="block text-[0.62rem] font-medium normal-case tracking-normal opacity-75">{qq.range}</span></th>)}
              {!d.withPur && <th className={hd + " text-right"}>{dmy(asOf)}</th>}
              {d.withTargets && <><th className={hd + " text-right"}>Conservative</th><th className={hd + " text-right"}>Aggressive</th><th className={hd + " text-right"}>Short (−) / extra</th></>}
            </tr>
            <tr className="bg-surface font-bold">
              <td className={td + " text-brand"}>Total</td><td className={td} />
              <td className={td} />
              {d.withPur && <td className={td + " num text-right text-accent"}>{f(d.totals.pur)}</td>}
              <td className={td + " num text-right text-accent"}>{f(d.totals.sale)}</td>
              {d.withPur && <td className={td + " num text-right text-brand"}>{f(d.totals.bal)}</td>}
              {d.totals.q.map((v, i) => <td key={i} className={td + " num text-right text-brand"}>{f(v)}</td>)}
              {!d.withPur && <td className={td + " num text-right text-brand"}>{f(d.totals.bal)}</td>}
              {d.withTargets && <><td className={td + " num text-right"}>{f2(d.totals.cons)}</td><td className={td + " num text-right"}>{f2(d.totals.aggr)}</td><td className={td + " num text-right " + (d.totals.gap < 0 ? "text-bad" : "text-ok")}>{f(d.totals.gap)}</td></>}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i} className={"hover:bg-brand-soft/30 " + (i > 0 && d.rows[i - 1].grade !== r.grade ? "[&>td]:border-t-2" : "")}>
                <td className={td + " font-medium"}>{r.grade}</td><td className={td}>{r.band}</td>
                <td className={td + " num text-right"}>{r.rateText}</td>
                {d.withPur && <td className={td + " num text-right"}>{f(r.pur)}</td>}
                <td className={td + " num text-right"}>{f(r.sale)}</td>
                {d.withPur && <td className={td + " num text-right font-semibold" + (r.bal < -0.5 ? " text-bad" : "")}>{f(r.bal)}</td>}
                {r.q.map((v, j) => <td key={j} className={td + " num text-right"}>{f(v)}</td>)}
                {!d.withPur && <td className={td + " num text-right font-semibold" + (r.bal < -0.5 ? " text-bad" : "")}>{f(r.bal)}</td>}
                {d.withTargets && <><td className={td + " num text-right"}>{f2(r.cons)}</td><td className={td + " num text-right"}>{f2(r.aggr)}</td>
                  <td className={td + " num text-right font-medium " + ((r.gap ?? 0) < -0.5 ? "text-bad" : "text-ok")}>{f(r.gap)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.withTargets && <p className="text-[0.78rem] text-muted">Conservative is two months of last year&apos;s purchase, Aggressive is two months of the 4-year average purchase. The last column is today&apos;s balance minus Conservative: red means the stock is below that.</p>}
      {d.leftOut && <p className="text-[0.78rem] text-warn">Not in any row above: {f(d.leftOut.kg)} kg{d.leftOut.where ? ` (${d.leftOut.where})` : ""}. Your sheet&apos;s Summary has no row for it.</p>}
    </div>
  );
}
