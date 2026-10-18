import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { stockList } from "@/lib/queries";
import { date, kg, mm, num } from "@/lib/format";
import { Badge, Card, PageHeader, Skeleton, td, th } from "@/components/ui";

type SP = Promise<{ q?: string; book?: string; all?: string; page?: string }>;

export default function StockPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Plates" hint="Every plate with its heat or plate number. Search, filter, and open any plate to see its full history." />
      <Suspense fallback={<Card><Skeleton rows={12} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function href(p: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => v && u.set(k, v));
  const s = u.toString();
  return "/stock" + (s ? "?" + s : "");
}

async function Body({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const { rows, total, pageSize } = await stockList({ q: sp.q, book: sp.book, all: sp.all === "1", page });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const base = { q: sp.q, book: sp.book, all: sp.all };
  const chip = (on: boolean) => "rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset " + (on ? "bg-brand text-white ring-brand" : "bg-white text-muted ring-line hover:text-ink");
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <form action="/stock" className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder="Plate no, heat no or grade" className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3" />
          {sp.book && <input type="hidden" name="book" value={sp.book} />}
          {sp.all && <input type="hidden" name="all" value={sp.all} />}
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href={href({ ...base, book: undefined })} className={chip(!sp.book)}>Both books</Link>
          <Link href={href({ ...base, book: "WB1" })} className={chip(sp.book === "WB1")}>WB1</Link>
          <Link href={href({ ...base, book: "WB2" })} className={chip(sp.book === "WB2")}>WB2</Link>
          <Link href={href({ ...base, all: sp.all === "1" ? undefined : "1" })} className={chip(sp.all === "1")}>Include sold-out</Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-surface/60">
            <tr>
              <th className={th}>Plate / heat no</th><th className={th}>Grade</th><th className={th + " text-right"}>Size (mm)</th>
              <th className={th + " text-right"}>Pcs</th><th className={th + " text-right"}>Left (kg)</th><th className={th}>Received</th><th className={th}>Book</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-muted">Nothing matches. Try a shorter search.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.lot_no} className="hover:bg-brand-soft/30">
                <td className={td}>
                  <Link href={`/stock/${r.lot_no}`} className="font-semibold text-brand hover:underline">{r.plate_no ?? r.heat_no}</Link>
                  {r.plate_no && r.heat_no && <div className="text-[0.78rem] text-muted">heat {r.heat_no}</div>}
                </td>
                <td className={td}>{r.grade}</td>
                <td className={td + " num text-right whitespace-nowrap"}>{mm(r.thk)} × {mm(r.wid)} × {mm(r.len)}</td>
                <td className={td + " num text-right"}>{r.pcs}</td>
                <td className={td + " num text-right font-semibold " + (num(r.kg) < -0.5 ? "text-bad" : "")}>{kg(r.kg)}</td>
                <td className={td + " whitespace-nowrap text-muted"}>{date(r.receipt_date)}</td>
                <td className={td}><Badge>{r.book}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
        <span>{kg(total)} plates · page {page} of {pages}</span>
        <div className="flex gap-2">
          {page > 1 && <Link href={href({ ...base, page: String(page - 1) })} className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface">Previous</Link>}
          {page < pages && <Link href={href({ ...base, page: String(page + 1) })} className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface">Next</Link>}
        </div>
      </div>
    </Card>
  );
}
