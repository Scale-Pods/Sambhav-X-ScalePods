import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import { td, th } from "./ui";
import { isoDay } from "@/lib/money";

export type Col<T> = { label: string; right?: boolean; cell: (r: T) => ReactNode; nowrap?: boolean };

const day = (v: unknown) => {
  const iso = isoDay(v);
  return iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }) : "";
};
export { day };

/** A plain, dense register: one row per entry, numbers right-aligned. */
export function PayTable<T>({ cols, rows, empty = "Nothing matches." }: { cols: Col<T>[]; rows: T[]; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-line bg-surface/60">
          <tr>{cols.map((c) => <th key={c.label} className={th + (c.right ? " text-right" : "") + " whitespace-nowrap"}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && <tr><td colSpan={cols.length} className="px-5 py-10 text-center text-muted">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-surface/60">
              {cols.map((c) => <td key={c.label} className={td + (c.right ? " num text-right" : "") + (c.nowrap === false ? "" : " whitespace-nowrap")}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Open" link to the invoice file in Drive, when there is one. */
export function FileLink({ url }: { url: string | null | undefined }) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><FileText className="h-3.5 w-3.5" /> Open</a>;
}

/** Row count, total, paging and the CSV link under a register. */
export function ListFooter({ total, sum, sumLabel, page, pages, size, hrefFor, exportHref, format }: {
  total: number; sum?: number; sumLabel?: string; page: number; pages: number; size: number; hrefFor: (page: number) => string; exportHref?: string; format: (n: number) => string;
}) {
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[0.85rem] text-muted">
      <span>
        {total === 0 ? "No rows" : `${first.toLocaleString("en-IN")}–${last.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
        {sum != null && total > 0 && <> · <span className="font-semibold text-ink">{sumLabel ?? "Total"} {format(sum)}</span></>}
      </span>
      <span className="flex items-center gap-3">
        {exportHref && <a href={exportHref} className="flex items-center gap-1.5 rounded-md border border-line bg-field px-2.5 py-1 font-medium hover:text-ink"><Download className="h-3.5 w-3.5" /> CSV</a>}
        {pages > 1 && (
          <span className="flex items-center gap-1">
            {page > 1 ? <Link href={hrefFor(page - 1)} className="rounded p-1 hover:bg-surface hover:text-ink" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Link> : <span className="p-1 opacity-30"><ChevronLeft className="h-4 w-4" /></span>}
            <span className="num">Page {page} of {pages}</span>
            {page < pages ? <Link href={hrefFor(page + 1)} className="rounded p-1 hover:bg-surface hover:text-ink" aria-label="Next"><ChevronRight className="h-4 w-4" /></Link> : <span className="p-1 opacity-30"><ChevronRight className="h-4 w-4" /></span>}
          </span>
        )}
      </span>
    </div>
  );
}

/** Builds paging / export links that keep the current filters. */
export function linker(base: string, sp: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v)) as Record<string, string>;
  return (changes: Record<string, string | number | undefined> = {}, path = base) => {
    const u = new URLSearchParams(flat);
    Object.entries(changes).forEach(([k, v]) => (v === undefined || v === "" ? u.delete(k) : u.set(k, String(v))));
    return u.toString() ? `${path}?${u}` : path;
  };
}
