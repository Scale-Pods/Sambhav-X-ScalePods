import { Suspense } from "react";
import { q } from "@/lib/db";
import { date, kg } from "@/lib/format";
import { Badge, Card, PageHeader, Skeleton, Stat, td, th } from "@/components/ui";

type Line = { po_no: string; so_no: string | null; grade_raw: string | null; po_date_text: string | null; so_date_text: string | null; size_mm: string; ordered_kg: string | null; received_kg: string | null; pending_kg: string | null };
type Weight = { weigh_date: string | null; vehicle_no: string | null; weight_kg: string | null; photo_url: string | null };

export default function MillOrdersPage() {
  return (
    <>
      <PageHeader title="Mill orders and vehicle weights" hint="Two small tabs of the WB1 sheet, shown as they were typed. Mill orders track what was ordered from the mill against what has arrived. These are records, not stock: they do not change any plate balance." />
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const [lines, weights] = await Promise.all([
    q<Line>(`select po_no, so_no, grade_raw, po_date_text, so_date_text, size_mm, ordered_kg, received_kg, pending_kg from public.mill_po_lines order by source_row`),
    q<Weight>(`select weigh_date, vehicle_no, weight_kg, photo_url from public.vehicle_weight_log order by weigh_date, source_row`),
  ]);

  const pos = new Map<string, Line[]>();
  for (const l of lines) pos.set(l.po_no, [...(pos.get(l.po_no) ?? []), l]);
  const ordered = lines.reduce((a, l) => a + Number(l.ordered_kg ?? 0), 0);
  const received = lines.reduce((a, l) => a + Number(l.received_kg ?? 0), 0);
  const open = lines.filter((l) => Number(l.pending_kg ?? 0) > 0).reduce((a, l) => a + Number(l.pending_kg), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Purchase orders" value={String(pos.size)} sub={`${lines.length} size lines`} />
        <Stat label="Ordered" value={kg(ordered)} unit="kg" />
        <Stat label="Received" value={kg(received)} unit="kg" />
        <Stat label="Still to arrive" value={kg(open)} unit="kg" sub="lines not yet fully received" tone="accent" />
      </div>

      <Card title="Mill purchase orders">
        <p className="border-b border-line px-5 py-3 text-[0.88rem] text-muted">
          The sheet gives each PO date as day and month only, so no year is shown. The sheet also does not say which mill or which company each order is for.
        </p>
        <div className="divide-y divide-line">
          {[...pos.entries()].map(([po, ls]) => (
            <div key={po} className="px-5 py-4">
              <p className="font-display font-bold">
                PO {po} <span className="font-sans text-sm font-normal text-muted">· SO {ls[0].so_no ?? "-"} · {ls[0].grade_raw ?? "-"} · PO dated {ls[0].po_date_text ?? "-"} · SO dated {ls[0].so_date_text ?? "-"}</span>
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line">
                    <tr><th className={th}>Size</th><th className={th + " text-right"}>Ordered (kg)</th><th className={th + " text-right"}>Received (kg)</th><th className={th + " text-right"}>Pending (kg)</th><th className={th}></th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ls.map((l, i) => {
                      const p = Number(l.pending_kg ?? 0);
                      return (
                        <tr key={i}>
                          <td className={td}>{Number(l.size_mm)} mm</td>
                          <td className={td + " num text-right"}>{kg(l.ordered_kg)}</td>
                          <td className={td + " num text-right"}>{l.received_kg == null ? "-" : kg(l.received_kg)}</td>
                          <td className={td + " num text-right font-medium"}>{kg(Math.abs(p))}</td>
                          <td className={td}>{p < 0 ? <Badge tone="warning">Over by</Badge> : p > 0 ? <Badge tone="info">To arrive</Badge> : <Badge tone="ok">Complete</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Vehicle weights (Corten tab, June 2025)">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-surface/60">
              <tr><th className={th}>Date</th><th className={th}>Vehicle</th><th className={th + " text-right"}>Weight (kg)</th><th className={th}>Photo</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {weights.map((w, i) => (
                <tr key={i}>
                  <td className={td}>{date(w.weigh_date)}</td>
                  <td className={td + " font-medium"}>{w.vehicle_no ?? "-"}</td>
                  <td className={td + " num text-right"}>{kg(w.weight_kg)}</td>
                  <td className={td}>{w.photo_url && /^https?:\/\//.test(w.photo_url) ? <a href={w.photo_url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Open</a> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-sm text-muted">The sheet's own note under this log reads: "total material as on 03.07.2025 · 235 tons x 1.5 · 352000".</p>
      </Card>
    </div>
  );
}
