import Link from "next/link";
import type { Section } from "@/lib/stockSheet";
import { ROW_TONE, type Hl, type Tone } from "@/lib/highlight";

const n0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const f = (v: number | null) => (v == null ? "" : n0.format(v));
const day = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).replace(/\//g, "-") : "");

const hd = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-2 py-1.5 text-left text-[0.68rem] font-semibold uppercase tracking-wider text-muted";
const cell = "whitespace-nowrap border-b border-line px-2 py-1 text-[0.8rem]";
const num = " num text-right";

export function SectionView({ s, hl }: { s: Section; hl: Hl }) {
  const tone = (seq: number, lot: number): Tone | undefined => hl.moves.get(seq) ?? (hl.lots.has(lot) ? "see" : undefined);
  // a plate's balance row takes the colour of its marked rows (green and red together: just "shown")
  const lotTone = new Map<number, Tone>();
  for (const r of [...s.purchases, ...s.sales]) {
    const t = hl.moves.get(r.seq);
    if (t) lotTone.set(r.lot_no, lotTone.has(r.lot_no) && lotTone.get(r.lot_no) !== t ? "see" : t);
  }
  const hit = (t: Tone | undefined) => (t ? { className: ROW_TONE[t], "data-hl": t } : { className: "hover:bg-surface/60" });
  return (
    <section id={`t-${s.thk}`} className="border-b-2 border-line">
      <h2 className="sticky left-0 bg-steel px-3 py-1.5 font-display text-[0.9rem] font-bold tracking-wide text-steel-ink">{s.thk} MM</h2>
      <div className="flex min-w-max items-start gap-4 px-0 pb-3">
        <table className="border-separate border-spacing-0">
          <caption className="sticky left-0 bg-ok-soft px-2 py-1 text-left text-[0.7rem] font-bold uppercase tracking-wider text-ok">Purchase stock</caption>
          <thead><tr>{["Date", "Thk", "Wid", "Len", "Nos", "Wt", "Heat no", "Plate no", "Cert", "HSN", "Rate"].map((h) => <th key={h} className={hd + (["Thk", "Wid", "Len", "Nos", "Wt", "Rate"].includes(h) ? " text-right" : "")}>{h}</th>)}</tr></thead>
          <tbody>
            {s.purchases.map((r, i) => (
              <tr key={i} {...hit(tone(r.seq, r.lot_no))}>
                <td className={cell}>{day(r.date)}</td><td className={cell + num}>{r.thk}</td><td className={cell + num}>{f(r.wid)}</td><td className={cell + num}>{f(r.len)}</td>
                <td className={cell + num}>{r.nos}</td><td className={cell + num + " font-medium"}>{f(r.wt)}</td>
                <td className={cell}><Link prefetch={false} href={`/plates/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.heat ?? ""}</Link></td>
                <td className={cell}>{r.plate ?? (r.heat ? "" : <Link prefetch={false} href={`/plates/${r.lot_no}`} className="font-medium text-brand hover:underline">open</Link>)}</td>
                <td className={cell}>{r.links.map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="mr-1.5 font-medium text-brand hover:underline">{l.label}</a>)}</td>
                <td className={cell}>{r.hsn ?? ""}</td><td className={cell + num}>{r.rate == null ? "" : r.rate.toFixed(2)}</td>
              </tr>
            ))}
            <tr><td colSpan={5} className="bg-surface px-2 py-1 text-right text-[0.72rem] font-bold uppercase text-muted">Total purchase</td><td className="num bg-surface px-2 py-1 text-right text-[0.82rem] font-bold">{f(s.totals.pur)}</td><td colSpan={5} className="bg-surface" /></tr>
          </tbody>
        </table>
        <table className="border-separate border-spacing-0">
          <caption className="sticky left-0 bg-warn-soft px-2 py-1 text-left text-[0.7rem] font-bold uppercase tracking-wider text-warn">Sales stock</caption>
          <thead><tr>{["Date", "Inv no", "V. no", "Thk", "Wid", "Len", "Nos", "Wt", "Plot", "Heat / plate", "Notes"].map((h) => <th key={h} className={hd + (["Thk", "Wid", "Len", "Nos", "Wt"].includes(h) ? " text-right" : "")}>{h}</th>)}</tr></thead>
          <tbody>
            {s.sales.map((r, i) => (
              <tr key={i} {...(tone(r.seq, r.lot_no) ? hit(tone(r.seq, r.lot_no)) : { className: "hover:bg-surface/60 " + (r.adjustment ? "bg-info-soft/40" : "") })}>
                <td className={cell}>{day(r.date)}</td><td className={cell}>{r.inv ?? ""}</td><td className={cell}>{r.vno ?? ""}</td>
                <td className={cell + num}>{r.thk}</td><td className={cell + num}>{f(r.wid)}</td><td className={cell + num}>{f(r.len)}</td>
                <td className={cell + num}>{r.nos}</td><td className={cell + num + " font-medium"}>{f(r.wt)}</td><td className={cell}>{r.plot ?? ""}</td>
                <td className={cell}><Link prefetch={false} href={`/plates/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident ?? ""}</Link></td>
                <td className={cell + " max-w-[16rem] truncate"} title={r.note ?? undefined}>{r.adjustment ? "Count adjustment" : r.note ?? ""}</td>
              </tr>
            ))}
            <tr><td colSpan={7} className="bg-surface px-2 py-1 text-right text-[0.72rem] font-bold uppercase text-muted">Total sale</td><td className="num bg-surface px-2 py-1 text-right text-[0.82rem] font-bold">{f(s.totals.sale)}</td><td colSpan={3} className="bg-surface" /></tr>
          </tbody>
        </table>
        <table className="border-separate border-spacing-0">
          <caption className="sticky left-0 bg-info-soft px-2 py-1 text-left text-[0.7rem] font-bold uppercase tracking-wider text-brand-dark">Balance stock</caption>
          <thead><tr>{["Plot", "Thk", "Wid", "Len", "Nos", "Wt", "Heat / plate"].map((h) => <th key={h} className={hd + (["Thk", "Wid", "Len", "Nos", "Wt"].includes(h) ? " text-right" : "")}>{h}</th>)}</tr></thead>
          <tbody>
            {s.balance.map((r, i) => (
              <tr key={i} {...hit(lotTone.get(r.lot_no) ?? (hl.lots.has(r.lot_no) ? "see" : undefined))}>
                <td className={cell}>{r.plot ?? ""}</td><td className={cell + num}>{r.thk}</td><td className={cell + num}>{f(r.wid)}</td><td className={cell + num}>{f(r.len)}</td>
                <td className={cell + num}>{r.nos}</td><td className={cell + num + " font-medium"}>{f(r.wt)}</td>
                <td className={cell}><Link prefetch={false} href={`/plates/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident ?? ""}</Link></td>
              </tr>
            ))}
            <tr><td colSpan={5} className="bg-surface px-2 py-1 text-right text-[0.72rem] font-bold uppercase text-muted">Total balance</td><td className="num bg-surface px-2 py-1 text-right text-[0.82rem] font-bold">{f(s.totals.bal)}</td><td className="bg-surface" /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
