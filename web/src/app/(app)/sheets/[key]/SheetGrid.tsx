"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, EyeOff, Search } from "lucide-react";
import type { SheetRow, TabData } from "@/lib/sheets";

type Tab = { title: string; hidden: boolean; n: number };

/** A, B, ... Z, AA, AB ... like the sheet's column letters */
const letter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const URL_RE = /^https?:\/\/\S+$/i;

/**
 * The tab bar and the grid. Tabs are fetched as small JSON and kept in memory, and the other tabs of the sheet are fetched quietly
 * in the background, so switching tabs or pages shows the rows at once, the way Google Sheets does.
 */
const idOf = (tab: string, page: number, q: string) => `${tab}\u0000${page}\u0000${q}`;

export function SheetGrid({ sheetKey, tabs, initialTab, initialSearch, initial }: {
  sheetKey: string; tabs: Tab[]; initialTab: string; initialSearch: string; initial: TabData;
}) {
  // the tabs already fetched (kept for as long as the sheet is open) and the fetches still running
  const [cache] = useState(() => new Map<string, TabData>([[idOf(initialTab, initial.page, initialSearch), initial]]));
  const [inflight] = useState(() => new Map<string, Promise<TabData | null>>());

  const [tab, setTab] = useState(initialTab);
  const [page, setPage] = useState(initial.page);
  const [q, setQ] = useState(initialSearch);
  const [draft, setDraft] = useState(initialSearch);
  const [data, setData] = useState<TabData>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchTab = useCallback((t: string, p: number, s: string): Promise<TabData | null> => {
    const id = idOf(t, p, s);
    const hit = cache.get(id);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(id);
    if (running) return running;
    const url = `/api/sheets/data?key=${encodeURIComponent(sheetKey)}&tab=${encodeURIComponent(t)}&page=${p}${s ? `&q=${encodeURIComponent(s)}` : ""}`;
    const job = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<TabData>) : null))
      .then((d) => { if (d) cache.set(id, d); return d; })
      .catch(() => null)
      .finally(() => inflight.delete(id));
    inflight.set(id, job);
    return job;
  }, [sheetKey, cache, inflight]);

  const show = useCallback(async (t: string, p: number, s: string) => {
    setTab(t); setPage(p); setQ(s); setFailed(false);
    const hit = cache.get(idOf(t, p, s));
    if (hit) { setData(hit); setBusy(false); } else setBusy(true);
    const d = hit ?? (await fetchTab(t, p, s));
    // ignore the answer if the person has already moved on
    if (!hit) {
      setBusy(false);
      if (d) setData(d); else setFailed(true);
    }
    const u = new URLSearchParams({ tab: t });
    if (s) u.set("q", s);
    if (d && d.page > 1) u.set("page", String(d.page));
    window.history.replaceState(null, "", `/sheets/${sheetKey}?${u}`);
    if (d && d.page < d.pages) void fetchTab(t, d.page + 1, s); // the next page, quietly
  }, [fetchTab, sheetKey, cache]);

  // after the first tab is on screen, fetch the first page of every other tab in the background (two at a time)
  useEffect(() => {
    let stop = false;
    const todo = [...tabs.filter((t) => !t.hidden && t.title !== initialTab), ...tabs.filter((t) => t.hidden && t.title !== initialTab)].map((t) => t.title);
    const worker = async () => { while (!stop && todo.length) { const t = todo.shift()!; await fetchTab(t, 1, ""); } };
    const start = window.setTimeout(() => { void worker(); void worker(); }, 400);
    return () => { stop = true; window.clearTimeout(start); };
  }, [tabs, initialTab, fetchTab]);

  // a tab's next page is fetched as soon as its first is shown
  useEffect(() => { if (initial.page < initial.pages) void fetchTab(initialTab, initial.page + 1, initialSearch); }, [initial, initialTab, initialSearch, fetchTab]);

  const cols = Array.from({ length: Math.max(data.width, 1) }, (_, i) => i);
  const first = (data.page - 1) * data.size + 1;

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); void show(tab, 1, draft.trim().slice(0, 100)); }} className="relative -mt-12 mb-3 ml-auto w-64 max-sm:mt-0 max-sm:w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Search in ${tab}`} className="w-full rounded-md border border-line bg-field py-1.5 pl-9 pr-3 text-[0.9rem]" />
      </form>

      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(24,34,45,0.04)]">
        <div className="relative max-h-[68vh] overflow-auto">
          {busy && <div className="sticky left-0 top-0 z-40 flex h-0 items-start"><span className="m-3 rounded-md bg-ink px-3 py-1.5 text-[0.8rem] font-medium text-surface shadow">Loading {tab}…</span></div>}
          {failed && <p className="sticky left-0 px-5 py-4 text-[0.9rem] text-bad">This tab could not be loaded. Click it again to retry.</p>}
          <table className={"border-separate border-spacing-0 text-[0.84rem] transition-opacity " + (busy ? "opacity-40" : "")}>
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
          {data.rows.length === 0 && !busy && (
            <p className="sticky left-0 px-5 py-10 text-[0.92rem] text-muted">{q ? `Nothing in ${tab} matches “${q}”.` : "This tab has no rows below the header."}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[0.82rem] text-muted">
          <span>{data.total === 0 ? "No rows" : `Rows ${first.toLocaleString("en-IN")}–${(first + data.rows.length - 1).toLocaleString("en-IN")} of ${data.total.toLocaleString("en-IN")}`}{q && ` matching “${q}”`}</span>
          {data.pages > 1 && (
            <span className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => void show(tab, page - 1, q)} className="rounded p-1 hover:bg-surface hover:text-ink disabled:opacity-30" aria-label="Previous rows"><ChevronLeft className="h-4 w-4" /></button>
              <span className="num">Page {data.page} of {data.pages}</span>
              <button disabled={page >= data.pages} onClick={() => void show(tab, page + 1, q)} className="rounded p-1 hover:bg-surface hover:text-ink disabled:opacity-30" aria-label="Next rows"><ChevronRight className="h-4 w-4" /></button>
            </span>
          )}
        </div>

        {/* tabs along the bottom, like Google Sheets */}
        <nav className="flex gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1.5" aria-label="Tabs">
          {tabs.map((t) => {
            const on = t.title === tab;
            return (
              <button key={t.title} type="button" onClick={() => { setDraft(""); void show(t.title, 1, ""); }} aria-current={on ? "page" : undefined}
                className={"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[0.82rem] font-medium " +
                  (on ? "bg-card text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-card/70 hover:text-ink") + (t.hidden ? " italic opacity-70" : "")}
                title={t.hidden ? "Hidden in the sheet" : undefined}>
                {t.hidden && <EyeOff className="h-3.5 w-3.5" />}
                {t.title}
                <span className="num text-[0.72rem] text-muted">{t.n.toLocaleString("en-IN")}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
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
