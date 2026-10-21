import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, ExternalLink, Lock, Search } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { sheetSource, sheetTab, tabCounts, type SheetRow } from "@/lib/sheets";
import { Card, Skeleton } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;
type P = Promise<{ key: string }>;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "-";

/** A, B, ... Z, AA, AB ... like the sheet's column letters */
const letter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const URL_RE = /^https?:\/\/\S+$/i;

export default function SheetPage({ params, searchParams }: { params: P; searchParams: SP }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={14} /></Card>}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ params, searchParams }: { params: P; searchParams: SP }) {
  const [{ key }, sp, me] = await Promise.all([params, searchParams, currentStaff()]);
  if (!canExport(me?.role)) {
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-muted"><Lock className="h-4 w-4" /> The sheet view is open to the owner and administrators for now.</p></Card>;
  }
  const src = await sheetSource(key);
  if (!src || !src.tabs?.length) notFound();
  const visible = src.tabs.filter((t) => !t.hidden);
  const tab = src.tabs.find((t) => t.title === sp.tab)?.title ?? (visible[0] ?? src.tabs[0]).title;
  const search = (sp.q ?? "").trim().slice(0, 100);
  const [data, counts] = await Promise.all([sheetTab(key, tab, Number(sp.page) || 1, search), tabCounts(key)]);
  const href = (changes: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tab, q: search || undefined, page: undefined as string | number | undefined, ...changes };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && p.set(k, String(v)));
    return `/sheets/${key}?${p}`;
  };
  const cols = Array.from({ length: Math.max(data.width, 1) }, (_, i) => i);
  const first = (data.page - 1) * data.size + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/sheets" className="mb-2 inline-flex items-center gap-1 text-[0.85rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> All sheets</Link>
          <h1 className="font-display text-[1.7rem] font-extrabold leading-tight tracking-[-0.02em]">{src.name}</h1>
          <p className="mt-1 text-[0.88rem] text-muted">
            Read-only copy · last change in the sheet {when(src.last_modified_at)} · checked {when(src.last_synced_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={`/sheets/${key}`} className="relative">
            <input type="hidden" name="tab" value={tab} />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={search} placeholder={`Search in ${tab}`} className="w-64 rounded-md border border-line bg-field py-1.5 pl-9 pr-3 text-[0.9rem]" />
          </form>
          <a href={`https://docs.google.com/spreadsheets/d/${src.spreadsheet_id}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-line bg-field px-3 py-1.5 text-[0.85rem] font-medium text-muted hover:text-ink">
            <ExternalLink className="h-4 w-4" /> Open in Google Sheets
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(24,34,45,0.04)]">
        <div className="max-h-[68vh] overflow-auto">
          <table className="border-separate border-spacing-0 text-[0.84rem]">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-7 min-w-11 border-b border-r border-line bg-surface" />
                {cols.map((c) => (
                  <th key={c} className="sticky top-0 z-20 h-7 border-b border-r border-line bg-surface px-2 text-center text-[0.72rem] font-semibold text-muted">{letter(c)}</th>
                ))}
              </tr>
              {data.frozen.map((fr, i) => {
                const isHeader = fr.row_no === data.header?.row_no;
                const top = 28 + i * 30;
                return (
                  <tr key={fr.row_no}>
                    <th style={{ top }} className={"sticky left-0 z-30 h-[30px] border-r border-line bg-surface px-2 text-right text-[0.72rem] font-medium text-muted " + (isHeader ? "border-b-2" : "border-b")}>{fr.row_no}</th>
                    {cols.map((c) => (
                      <th key={c} style={{ top }} title={fr.cells[c] ?? ""}
                        className={"sticky z-20 h-[30px] max-w-[18rem] truncate border-r border-line px-2 text-left " + (isHeader ? "border-b-2 bg-card font-semibold" : "border-b bg-surface text-[0.78rem] font-medium text-muted")}>
                        {fr.cells[c] ?? ""}
                      </th>
                    ))}
                  </tr>
                );
              })}
            </thead>
            <tbody>
              {data.rows.map((r) => <Row key={r.row_no} r={r} cols={cols} />)}
            </tbody>
          </table>
          {data.rows.length === 0 && (
            <p className="sticky left-0 px-5 py-10 text-[0.92rem] text-muted">{search ? `Nothing in ${tab} matches “${search}”.` : "This tab has no rows below the header."}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[0.82rem] text-muted">
          <span>{data.total === 0 ? "No rows" : `Rows ${first.toLocaleString("en-IN")}–${(first + data.rows.length - 1).toLocaleString("en-IN")} of ${data.total.toLocaleString("en-IN")}`}{search && ` matching “${search}”`}</span>
          {data.pages > 1 && (
            <span className="flex items-center gap-1">
              {data.page > 1 ? <Link href={href({ page: data.page - 1 })} className="rounded p-1 hover:bg-surface hover:text-ink" aria-label="Previous rows"><ChevronLeft className="h-4 w-4" /></Link> : <span className="p-1 opacity-30"><ChevronLeft className="h-4 w-4" /></span>}
              <span className="num">Page {data.page} of {data.pages}</span>
              {data.page < data.pages ? <Link href={href({ page: data.page + 1 })} className="rounded p-1 hover:bg-surface hover:text-ink" aria-label="Next rows"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-1 opacity-30"><ChevronRight className="h-4 w-4" /></span>}
            </span>
          )}
        </div>

        {/* tabs along the bottom, like Google Sheets */}
        <nav className="flex gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1.5" aria-label="Tabs">
          {src.tabs.map((t) => {
            const on = t.title === tab;
            return (
              <Link key={t.title} href={href({ tab: t.title, q: undefined })} aria-current={on ? "page" : undefined}
                className={"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[0.82rem] font-medium " +
                  (on ? "bg-card text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-card/70 hover:text-ink") + (t.hidden ? " italic opacity-70" : "")}
                title={t.hidden ? "Hidden in the sheet" : undefined}>
                {t.hidden && <EyeOff className="h-3.5 w-3.5" />}
                {t.title}
                <span className="num text-[0.72rem] text-muted">{(counts[t.title] ?? 0).toLocaleString("en-IN")}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function Row({ r, cols }: { r: SheetRow; cols: number[] }) {
  return (
    <tr className="hover:bg-surface/60">
      <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-2 py-1 text-right text-[0.72rem] text-muted">{r.row_no}</td>
      {cols.map((c) => {
        const text = r.cells[c] ?? "";
        const link = r.links?.[String(c)] ?? (URL_RE.test(text) ? text : null);
        const safe = link && /^https?:\/\//i.test(link) ? link : null;
        return (
          <td key={c} className="max-w-[18rem] truncate border-b border-r border-line px-2 py-1" title={text.length > 30 ? text : undefined}>
            {safe ? (
              <a href={safe} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">{URL_RE.test(text) ? "Open ↗" : text || "Open ↗"}</a>
            ) : text}
          </td>
        );
      })}
    </tr>
  );
}
