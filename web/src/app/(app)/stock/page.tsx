import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Download, Search } from "lucide-react";
import { gradeOptions, plates } from "@/lib/analytics";
import { readPlateQuery } from "@/lib/plateQuery";
import { canExport, currentStaff } from "@/lib/auth";
import { unitLabel, weight } from "@/lib/filters";
import { date, mm, num } from "@/lib/format";
import { Badge, Card, PageHeader, Skeleton, td, th } from "@/components/ui";
import { FilterShell, ParamSelect } from "@/components/FilterBar";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function StockPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Plates" hint="Every plate with its heat or plate number. Filter, sort, and open any plate to see its full history." />
      <Suspense fallback={<Card><Skeleton rows={12} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // these pages work out today's date: render them at request time, never while the shell is prepared
  const sp = await searchParams;
  const pq = readPlateQuery(sp);
  const [grades, { rows, total, page, size }, me] = await Promise.all([gradeOptions(), plates(pq), currentStaff()]);
  const pages = Math.max(1, Math.ceil(total / size));
  const u = pq.f.unit;
  const raw = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v) ?? ""]).filter(([, v]) => v));
  const at = (changes: Record<string, string | undefined>) => {
    const p = new URLSearchParams(raw);
    Object.entries(changes).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    return `/stock?${p}`;
  };
  const exportHref = `/api/export/plates?${new URLSearchParams(raw)}`;
  const admin = canExport(me?.role);

  const extra = (
    <>
      {(pq.f.from || pq.f.to) && (
        <ParamSelect name="on" label="Dates apply to" value={pq.dateOn} options={[{ value: "received", label: "Received" }, { value: "sold", label: "Sold" }]} />
      )}
      <ParamSelect name="status" label="Show" value={pq.status} options={[
        { value: "instock", label: "In stock" }, { value: "soldout", label: "Sold out" }, { value: "oversold", label: "Sold more than received" }, { value: "all", label: "All plates" },
      ]} />
      {admin && (
        <ParamSelect name="cert" label="Certificate" value={pq.cert ?? ""} options={[{ value: "", label: "Any" }, { value: "has", label: "Has a link" }, { value: "none", label: "No link" }]} />
      )}
    </>
  );

  return (
    <FilterShell grades={grades} extra={extra}>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <form action="/stock" className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={pq.search} placeholder="Plate no, heat no or grade" className="w-full rounded-md border border-line bg-field py-2 pl-9 pr-3" />
            {Object.entries(raw).filter(([k]) => !["q", "page"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
          </form>
          <ParamSelect name="sort" label="Sort" value={pq.sort} options={[
            { value: "received_desc", label: "Newest received" }, { value: "received_asc", label: "Oldest received" },
            { value: "left_desc", label: "Most weight left" }, { value: "left_asc", label: "Least weight left" },
            { value: "thk_asc", label: "Thinnest first" }, { value: "thk_desc", label: "Thickest first" }, { value: "grade", label: "Grade A–Z" },
          ]} />
          <ParamSelect name="size" label="Rows" value={String(size)} options={[{ value: "25", label: "25" }, { value: "50", label: "50" }, { value: "100", label: "100" }]} />
          {admin && (
            <a href={exportHref} className="flex items-center gap-1.5 rounded-md border border-line bg-field px-3 py-1.5 text-[0.85rem] font-medium text-muted hover:text-ink">
              <Download className="h-4 w-4" /> CSV
            </a>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-surface/60">
              <tr>
                <th className={th}>Plate / heat no</th><th className={th}>Grade</th><th className={th + " text-right"}>Size (mm)</th>
                <th className={th + " text-right"}>Pcs</th><th className={th + " text-right"}>Left ({unitLabel(u)})</th><th className={th}>Received</th><th className={th}>Book</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-muted">Nothing matches. Try fewer filters or a shorter search.</td></tr>}
              {rows.map((r) => (
                <tr key={r.lot_no} className="hover:bg-brand-soft/30">
                  <td className={td}>
                    <Link href={`/stock/${r.lot_no}`} className="font-semibold text-brand hover:underline">{r.plate_no ?? r.heat_no}</Link>
                    {r.plate_no && r.heat_no && <div className="text-[0.78rem] text-muted">heat {r.heat_no}</div>}
                  </td>
                  <td className={td}>{r.grade}</td>
                  <td className={td + " num whitespace-nowrap text-right"}>{mm(r.thk)} × {mm(r.wid)} × {mm(r.len)}</td>
                  <td className={td + " num text-right"}>{r.pcs}</td>
                  <td className={td + " num text-right font-semibold " + (num(r.kg) < -0.5 ? "text-bad" : "")}>{weight(r.kg, u)}</td>
                  <td className={td + " whitespace-nowrap text-muted"}>{date(r.receipt_date)}</td>
                  <td className={td}><Badge>{r.book}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
          <span>{new Intl.NumberFormat("en-IN").format(total)} plates · page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={at({ page: String(page - 1) })} className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface">Previous</Link>}
            {page < pages && <Link href={at({ page: String(page + 1) })} className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-surface">Next</Link>}
          </div>
        </div>
      </Card>
    </FilterShell>
  );
}
