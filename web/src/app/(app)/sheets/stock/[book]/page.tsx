import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { stockBookTabs, stockSheetTab, type Section } from "@/lib/stockSheet";
import { Card, Skeleton } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;
type P = Promise<{ book: string }>;

const BOOKS: Record<string, string> = { WB1: "WB1 · SPF alloy plates", WB2: "WB2 · SPF and Ridhi Siddhi" };
const n0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const f = (v: number | null) => (v == null ? "" : n0.format(v));
const day = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).replace(/\//g, "-") : "");

export default function StockSheetPage({ params, searchParams }: { params: P; searchParams: SP }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={14} /></Card>}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ params, searchParams }: { params: P; searchParams: SP }) {
  const [{ book: raw }, sp] = await Promise.all([params, searchParams]);
  const book = raw.toUpperCase();
  if (!BOOKS[book]) notFound();
  const tabs = await stockBookTabs(book);
  if (tabs.length === 0) notFound();
  const tab = tabs.find((t) => t.tab === sp.tab)?.tab ?? tabs[0].tab;
  const search = (sp.q ?? "").trim().slice(0, 60);
  const data = await stockSheetTab(book, tab, search);
  const href = (changes: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ tab, q: search || undefined, ...changes }).forEach(([k, v]) => v && p.set(k, v));
    return `/sheets/stock/${book}?${p}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/sheets" className="mb-2 inline-flex items-center gap-1 text-[0.85rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> All sheets</Link>
          <h1 className="font-display text-[1.7rem] font-extrabold leading-tight tracking-[-0.02em]">{BOOKS[book]}</h1>
          <p className="mt-1 max-w-3xl text-[0.88rem] text-muted">
            Laid out like your sheet: purchase, sales and balance side by side, by thickness. This is built from the checked stock ledger, so the balance is calculated from the rows and cannot drift. Read-only; changes are made through the app.
          </p>
        </div>
        <form action={`/sheets/stock/${book}`} className="relative">
          <input type="hidden" name="tab" value={tab} />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={search} placeholder="Heat or plate number" className="w-64 rounded-md border border-line bg-field py-1.5 pl-9 pr-3 text-[0.9rem]" />
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[["Total purchase", data.totals.pur, "text-ink"], ["Total sold", data.totals.sale, "text-accent"], ["Balance in stock", data.totals.bal, "text-brand"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-lg border border-line bg-card p-4">
            <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">{l as string} · {tab}{search && ` · “${search}”`}</p>
            <p className={"num mt-1.5 font-display text-2xl font-extrabold " + c}>{f(v as number)}<span className="ml-1 font-sans text-sm font-medium text-muted">kg</span></p>
          </div>
        ))}
      </div>

      {data.sections.length > 1 && (
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Thickness">
          <span className="mr-1 text-[0.78rem] font-semibold uppercase tracking-wider text-muted">Jump to</span>
          {data.sections.map((s) => <a key={s.thk} href={`#t-${s.thk}`} className="rounded-md bg-field px-2 py-1 text-[0.8rem] font-medium text-muted ring-1 ring-inset ring-line hover:text-ink">{s.thk} mm</a>)}
        </nav>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(24,34,45,0.04)]">
        <div className="max-h-[72vh] overflow-auto">
          {data.sections.length === 0 && <p className="px-5 py-10 text-[0.92rem] text-muted">{search ? `Nothing in ${tab} matches “${search}”.` : "Nothing in this tab."}</p>}
          {data.sections.map((s) => <SectionView key={s.thk} s={s} />)}
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1.5" aria-label="Tabs">
          {tabs.map((t) => (
            <Link key={t.tab} href={href({ tab: t.tab, q: undefined })} aria-current={t.tab === tab ? "page" : undefined}
              className={"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[0.82rem] font-medium " + (t.tab === tab ? "bg-card text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-card/70 hover:text-ink")}>
              {t.tab} <span className="num text-[0.72rem] text-muted">{n0.format(Math.round(t.balance_kg / 1000))} t</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

const hd = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-2 py-1.5 text-left text-[0.68rem] font-semibold uppercase tracking-wider text-muted";
const cell = "whitespace-nowrap border-b border-line px-2 py-1 text-[0.8rem]";
const num = " num text-right";

function SectionView({ s }: { s: Section }) {
  return (
    <section id={`t-${s.thk}`} className="border-b-2 border-line">
      <h2 className="sticky left-0 bg-ink px-3 py-1.5 font-display text-[0.9rem] font-bold text-surface">{s.thk} MM</h2>
      <div className="flex min-w-max items-start">
        <table className="border-separate border-spacing-0">
          <caption className="sticky left-0 bg-ok-soft px-2 py-1 text-left text-[0.7rem] font-bold uppercase tracking-wider text-ok">Purchase stock</caption>
          <thead><tr>{["Date", "Thk", "Wid", "Len", "Nos", "Wt", "Heat no", "Plate no", "Cert", "HSN", "Rate"].map((h) => <th key={h} className={hd + (["Thk", "Wid", "Len", "Nos", "Wt", "Rate"].includes(h) ? " text-right" : "")}>{h}</th>)}</tr></thead>
          <tbody>
            {s.purchases.map((r, i) => (
              <tr key={i} className="hover:bg-surface/60">
                <td className={cell}>{day(r.date)}</td><td className={cell + num}>{r.thk}</td><td className={cell + num}>{f(r.wid)}</td><td className={cell + num}>{f(r.len)}</td>
                <td className={cell + num}>{r.nos}</td><td className={cell + num + " font-medium"}>{f(r.wt)}</td>
                <td className={cell}><Link prefetch={false} href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.heat ?? ""}</Link></td>
                <td className={cell}>{r.plate ?? (r.heat ? "" : <Link prefetch={false} href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">open</Link>)}</td>
                <td className={cell}>{r.links.map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="mr-1.5 font-medium text-brand hover:underline">{l.label}</a>)}</td>
                <td className={cell}>{r.hsn ?? ""}</td><td className={cell + num}>{r.rate == null ? "" : r.rate.toFixed(2)}</td>
              </tr>
            ))}
            <tr><td colSpan={5} className="bg-surface px-2 py-1 text-right text-[0.72rem] font-bold uppercase text-muted">Total purchase</td><td className="num bg-surface px-2 py-1 text-right text-[0.82rem] font-bold">{f(s.totals.pur)}</td><td colSpan={5} className="bg-surface" /></tr>
          </tbody>
        </table>
        <span className="w-4 shrink-0" />
        <table className="border-separate border-spacing-0">
          <caption className="sticky left-0 bg-warn-soft px-2 py-1 text-left text-[0.7rem] font-bold uppercase tracking-wider text-warn">Sales stock</caption>
          <thead><tr>{["Date", "Inv no", "V. no", "Thk", "Wid", "Len", "Nos", "Wt", "Plot", "Heat / plate", "Notes"].map((h) => <th key={h} className={hd + (["Thk", "Wid", "Len", "Nos", "Wt"].includes(h) ? " text-right" : "")}>{h}</th>)}</tr></thead>
          <tbody>
            {s.sales.map((r, i) => (
              <tr key={i} className={"hover:bg-surface/60 " + (r.adjustment ? "bg-info-soft/40" : "")}>
                <td className={cell}>{day(r.date)}</td><td className={cell}>{r.inv ?? ""}</td><td className={cell}>{r.vno ?? ""}</td>
                <td className={cell + num}>{r.thk}</td><td className={cell + num}>{f(r.wid)}</td><td className={cell + num}>{f(r.len)}</td>
                <td className={cell + num}>{r.nos}</td><td className={cell + num + " font-medium"}>{f(r.wt)}</td><td className={cell}>{r.plot ?? ""}</td>
                <td className={cell}><Link prefetch={false} href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident ?? ""}</Link></td>
                <td className={cell + " max-w-[16rem] truncate"} title={r.note ?? undefined}>{r.adjustment ? "Count adjustment" : r.note ?? ""}</td>
              </tr>
            ))}
            <tr><td colSpan={7} className="bg-surface px-2 py-1 text-right text-[0.72rem] font-bold uppercase text-muted">Total sale</td><td className="num bg-surface px-2 py-1 text-right text-[0.82rem] font-bold">{f(s.totals.sale)}</td><td colSpan={3} className="bg-surface" /></tr>
          </tbody>
        </table>
        <span className="w-4 shrink-0" />
        <table className="border-separate border-spacing-0">
          <caption className="sticky left-0 bg-info-soft px-2 py-1 text-left text-[0.7rem] font-bold uppercase tracking-wider text-brand-dark">Balance stock</caption>
          <thead><tr>{["Plot", "Thk", "Wid", "Len", "Nos", "Wt", "Heat / plate"].map((h) => <th key={h} className={hd + (["Thk", "Wid", "Len", "Nos", "Wt"].includes(h) ? " text-right" : "")}>{h}</th>)}</tr></thead>
          <tbody>
            {s.balance.map((r, i) => (
              <tr key={i} className="hover:bg-surface/60">
                <td className={cell}>{r.plot ?? ""}</td><td className={cell + num}>{r.thk}</td><td className={cell + num}>{f(r.wid)}</td><td className={cell + num}>{f(r.len)}</td>
                <td className={cell + num}>{r.nos}</td><td className={cell + num + " font-medium"}>{f(r.wt)}</td>
                <td className={cell}><Link prefetch={false} href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident ?? ""}</Link></td>
              </tr>
            ))}
            <tr><td colSpan={5} className="bg-surface px-2 py-1 text-right text-[0.72rem] font-bold uppercase text-muted">Total balance</td><td className="num bg-surface px-2 py-1 text-right text-[0.82rem] font-bold">{f(s.totals.bal)}</td><td className="bg-surface" /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
