import Link from "next/link";
import { Download } from "lucide-react";
import { reconciliation } from "@/lib/queries";
import { Badge, Card, td, Th } from "@/components/ui";

const kg = (v: number | string | null) => (v == null ? "-" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(v)));
const signed = (v: number) => (v > 0.5 ? "+" : v < -0.5 ? "−" : "") + kg(Math.abs(v));
const STATUS: Record<string, { label: string; tone: "ok" | "error" | "warning" | "neutral" }> = {
  matched: { label: "Matches", tone: "ok" }, short: { label: "Short", tone: "error" }, excess: { label: "Excess", tone: "warning" }, not_counted: { label: "Not counted yet", tone: "neutral" },
};

/** The count, plate by plate, worked back to the moment the window opened. */
export async function Reconciliation({ sessionId, filter, canExport, startedLabel }: { sessionId: string; filter: string; canExport: boolean; startedLabel: string }) {
  const { rows, unknownCounted, unknownMoves, totals: t } = await reconciliation(sessionId);
  const shown = (filter === "all" ? rows : rows.filter((r) => r.status === filter)).slice(0, 300);
  const tabs = [["all", `All (${rows.length})`], ["short", `Short (${t.short})`], ["excess", `Excess (${t.excess})`], ["matched", `Matches (${t.matched})`], ["not_counted", `Not counted (${t.notCounted})`]];
  const chip = (on: boolean) => "rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset " + (on ? "bg-ink text-surface ring-ink" : "bg-field text-muted ring-line hover:text-ink");
  const tile = "rounded-lg border border-line bg-card p-4";

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Plates in books</p><p className="mt-1.5 font-display text-2xl font-extrabold">{t.inBooks}</p><p className="text-[0.78rem] text-muted">when the window opened</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Counted</p><p className="mt-1.5 font-display text-2xl font-extrabold">{t.counted}</p><p className="text-[0.78rem] text-muted">{t.notCounted} still to count</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Match</p><p className="mt-1.5 font-display text-2xl font-extrabold text-ok">{t.matched}</p><p className="text-[0.78rem] text-muted">within tolerance</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Short / excess</p><p className="mt-1.5 font-display text-2xl font-extrabold"><span className="text-bad">{t.short}</span> <span className="text-muted">/</span> <span className="text-warn">{t.excess}</span></p><p className="text-[0.78rem] text-muted">go to review</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Counted plates</p><p className="mt-1.5 font-display text-2xl font-extrabold">{kg(t.openingKg)}<span className="ml-1 font-sans text-sm font-medium text-muted">kg</span></p><p className="text-[0.78rem] text-muted">books said {kg(t.countedBooksKg)} kg</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Net difference</p><p className={"mt-1.5 font-display text-2xl font-extrabold " + (t.diffKg < -0.5 ? "text-bad" : t.diffKg > 0.5 ? "text-warn" : "text-ok")}>{signed(t.diffKg)}<span className="ml-1 font-sans text-sm font-medium text-muted">kg</span></p><p className="text-[0.78rem] text-muted">on counted plates</p></div>
      </div>

      <Card
        title="Plate by plate"
        aside={canExport ? <a href={`/api/export/count?session=${sessionId}`} className="flex items-center gap-1.5 rounded-md border border-line bg-field px-3 py-1.5 text-[0.85rem] font-medium text-muted hover:text-ink"><Download className="h-4 w-4" /> CSV</a> : undefined}
      >
        <p className="border-b border-line px-5 py-3 text-[0.88rem] text-muted">
          <span className="font-semibold text-ink">How it is worked out:</span> opening stock = what was counted + anything that went out after the window opened ({startedLabel}) but before that plate was counted − anything that came in during that time. Then it is compared with the books at the moment the window opened.
        </p>
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          {tabs.map(([k, l]) => <Link key={k} href={`/count?tab=reconcile&s=${sessionId}&rs=${k}`} className={chip(filter === k)}>{l}</Link>)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-surface/60">
              <tr>
                <Th>Plate</Th><Th>Grade</Th><Th right>Books at start</Th><Th right info="What the people counting found on the floor.">Counted</Th>
                <Th right>Moved before count</Th><Th right>Opening (worked back)</Th><Th right info="Counted minus what the books say. Zero is perfect; a minus means less on the floor than in the books.">Difference</Th><Th>Result</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">Nothing here.</td></tr>}
              {shown.map((r) => {
                const out = Number(r.out_before_kg), inn = Number(r.in_before_kg), diff = r.diff_kg == null ? null : Number(r.diff_kg);
                return (
                  <tr key={r.lot_id} className="hover:bg-surface/60">
                    <td className={td}><Link href={`/plates/${r.lot_no}`} className="font-semibold text-brand hover:underline">{r.ident}</Link>{r.count_lines > 1 && <div className="text-[0.75rem] text-warn">counted {r.count_lines} times: check</div>}</td>
                    <td className={td}>{r.grade} <span className="text-muted">· {Number(r.thickness_mm)} mm</span></td>
                    <td className={td + " num text-right"}>{kg(r.books_kg)}</td>
                    <td className={td + " num text-right"}>{kg(r.counted_kg)}</td>
                    <td className={td + " num text-right text-muted"}>{out || inn ? `${out ? `+${kg(out)} out` : ""}${out && inn ? ", " : ""}${inn ? `−${kg(inn)} in` : ""}` : "-"}</td>
                    <td className={td + " num text-right font-medium"}>{kg(r.opening_kg)}</td>
                    <td className={td + " num text-right font-semibold " + (diff == null ? "" : diff < -0.5 ? "text-bad" : diff > 0.5 ? "text-warn" : "text-ok")}>{diff == null ? "-" : signed(diff)}</td>
                    <td className={td}><Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 300 && <p className="border-t border-line px-5 py-3 text-sm text-muted">Showing the 300 biggest differences. The CSV has every plate.</p>}
      </Card>

      {(unknownCounted.length > 0 || unknownMoves.length > 0) && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title={`Counted but not in the books (${unknownCounted.length})`}>
            <ul className="divide-y divide-line">
              {unknownCounted.length === 0 && <li className="px-5 py-6 text-sm text-muted">None.</li>}
              {unknownCounted.map((u, i) => <li key={i} className="flex justify-between gap-3 px-5 py-2.5 text-[0.9rem]"><span className="font-semibold">{u.ident} <span className="font-normal text-muted">· {u.yard ?? "-"} · {u.who ?? "-"}</span></span><span className="num">{kg(u.weight_kg)} kg</span></li>)}
            </ul>
          </Card>
          <Card title={`Movements without a known plate (${unknownMoves.length})`}>
            <ul className="divide-y divide-line">
              {unknownMoves.length === 0 && <li className="px-5 py-6 text-sm text-muted">None.</li>}
              {unknownMoves.map((u, i) => <li key={i} className="flex justify-between gap-3 px-5 py-2.5 text-[0.9rem]"><span className="font-semibold">{u.ident} <span className="font-normal text-muted">· {u.direction} {u.reference ? `· ${u.reference}` : ""}</span></span><span className="num">{kg(u.weight_kg)} kg</span></li>)}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
