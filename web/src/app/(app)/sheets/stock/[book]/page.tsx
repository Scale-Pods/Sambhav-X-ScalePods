import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { stockBookTabs, stockSheetTab } from "@/lib/stockSheet";
import { Card, Skeleton } from "@/components/ui";
import { Info } from "@/components/Info";
import { SectionView } from "./SectionView";

type SP = Promise<Record<string, string | undefined>>;
type P = Promise<{ book: string }>;

const BOOKS: Record<string, string> = { WB1: "WB1 · SPF alloy plates", WB2: "WB2 · SPF and Ridhi Siddhi" };
const n0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const f = (v: number | null) => (v == null ? "" : n0.format(v));

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/sheets" className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[0.8rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> All sheets</Link>
          <h1 className="font-display text-[1.35rem] font-extrabold leading-tight tracking-[-0.02em]">{BOOKS[book]}</h1>
          <span className="text-[0.84rem] text-muted">Purchase, sales and balance side by side, by thickness
            <Info>Laid out like your sheet. This is built from the checked stock ledger, so the balance is calculated from the rows and cannot drift. Read-only; changes are made through the app.</Info>
          </span>
        </div>
        <form action={`/sheets/stock/${book}`} className="relative">
          <input type="hidden" name="tab" value={tab} />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={search} placeholder="Heat or plate number" className="w-60 rounded-lg border border-line bg-field py-1.5 pl-9 pr-3 text-[0.9rem]" />
        </form>
      </div>

      <nav className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Grades">
        {tabs.map((t) => (
          <Link key={t.tab} href={href({ tab: t.tab, q: undefined })} aria-current={t.tab === tab ? "page" : undefined}
            className={"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[0.82rem] font-medium transition-colors " + (t.tab === tab ? "border-brand bg-brand text-white shadow-sm" : "border-line bg-card text-muted hover:border-grid hover:text-ink")}>
            {t.tab} <span className={"num text-[0.72rem] " + (t.tab === tab ? "text-white/80" : "text-muted")}>{n0.format(Math.round(t.balance_kg / 1000))} t</span>
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-3 gap-2.5">
        {[["Total purchase", data.totals.pur, "text-ink"], ["Total sold", data.totals.sale, "text-accent"], ["Balance in stock", data.totals.bal, "text-brand"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-lg border border-line bg-card px-3.5 py-2">
            <p className="truncate text-[0.68rem] font-semibold uppercase tracking-wider text-muted">{l as string} · {tab}{search && ` · “${search}”`}</p>
            <p className={"num font-display text-[1.35rem] font-extrabold leading-tight " + c}>{f(v as number)}<span className="ml-1 font-sans text-[0.8rem] font-medium text-muted">kg</span></p>
          </div>
        ))}
      </div>

      {data.sections.length > 1 && (
        <nav className="flex items-center gap-1.5 overflow-x-auto pb-0.5" aria-label="Thickness">
          <span className="mr-1 shrink-0 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Jump to</span>
          {data.sections.map((s) => <a key={s.thk} href={`#t-${s.thk}`} className="shrink-0 rounded-md border border-line bg-card px-2 py-0.5 text-[0.78rem] font-medium text-muted hover:border-grid hover:text-ink">{s.thk} mm</a>)}
        </nav>
      )}

      <div className="overflow-hidden rounded-xl border border-grid bg-card shadow-[0_1px_2px_rgba(24,34,45,0.05)]">
        <div className="max-h-[max(20rem,calc(100dvh-21rem))] overflow-auto">
          {data.sections.length === 0 && <p className="px-5 py-10 text-[0.92rem] text-muted">{search ? `Nothing in ${tab} matches “${search}”.` : "Nothing in this tab."}</p>}
          {data.sections.map((s) => <SectionView key={s.thk} s={s} />)}
        </div>
      </div>
    </div>
  );
}
