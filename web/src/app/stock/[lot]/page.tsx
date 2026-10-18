import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { lotDetail } from "@/lib/queries";
import { date, kg, mm, num } from "@/lib/format";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";

export default function LotPage({ params }: { params: Promise<{ lot: string }> }) {
  return (
    <>
      <Link href="/stock" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> All plates</Link>
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body params={params} />
      </Suspense>
    </>
  );
}

const sev = { error: "error", warning: "warning", info: "info" } as const;

async function Body({ params }: { params: Promise<{ lot: string }> }) {
  const { lot: raw } = await params;
  const lotNo = Number(raw);
  if (!Number.isInteger(lotNo)) notFound();
  const d = await lotDetail(lotNo);
  if (!d) notFound();
  const { lot, moves, issues, ref } = d;
  const left = num(lot.kg);
  const link = ref?.raw?.link;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[0.8rem] font-medium uppercase tracking-wide text-muted">{lot.grade}</p>
              <h1 className="mt-1 text-[1.9rem] font-semibold tracking-tight">{lot.plate_no ?? lot.heat_no}</h1>
              {lot.plate_no && lot.heat_no && <p className="text-muted">Heat number {lot.heat_no}</p>}
            </div>
            <div className="text-right">
              <p className="text-[0.8rem] font-medium uppercase tracking-wide text-muted">Left in stock</p>
              <p className={"num text-[2rem] font-semibold leading-tight " + (left < -0.5 ? "text-bad" : left > 0.5 ? "text-brand-dark" : "text-muted")}>{kg(left)} <span className="text-base font-medium text-muted">kg</span></p>
              <Badge tone={left > 0.5 ? "ok" : left < -0.5 ? "error" : "neutral"}>{left > 0.5 ? "In stock" : left < -0.5 ? "Sold more than received" : "Sold out"}</Badge>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
            {[
              ["Thickness", `${mm(lot.thk)} mm`], ["Width", `${mm(lot.wid)} mm`], ["Length", `${mm(lot.len)} mm`], ["Pieces received", lot.pieces_received ?? "-"],
              ["Received on", date(lot.receipt_date)], ["Weight received", `${kg(lot.recv)} kg`], ["Weight sold", `${kg(lot.sold)} kg`], ["Stock book", lot.book],
            ].map(([k, v]) => (
              <div key={String(k)}><dt className="text-[0.75rem] font-medium uppercase tracking-wide text-muted">{k}</dt><dd className="num mt-0.5 font-medium">{v}</dd></div>
            ))}
          </dl>
        </div>

        <Card title="History of this plate">
          <ol className="divide-y divide-line">
            {moves.map((m, i) => {
              const out = num(m.weight_kg) < 0;
              return (
                <li key={i} className="flex items-start gap-4 px-5 py-3.5">
                  <span className={"mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " + (out ? "bg-accent" : "bg-brand")} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{out ? "Sold" : "Received"} <span className="text-muted">· {date(m.movement_date)}</span></p>
                    {m.note && <p className="mt-0.5 break-words text-[0.85rem] text-muted">{m.note}</p>}
                  </div>
                  <p className={"num shrink-0 text-right font-semibold " + (out ? "text-accent" : "text-brand-dark")}>{out ? "−" : "+"}{kg(Math.abs(num(m.weight_kg)))} kg</p>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Certificates and source">
          <dl className="space-y-3 px-5 py-4 text-[0.92rem]">
            <div className="flex justify-between gap-4"><dt className="text-muted">Certificate link</dt><dd>{link ? <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Open <ExternalLink className="h-3.5 w-3.5" /></a> : <span className="text-muted">none on the sheet</span>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Consignment certificate</dt><dd className="text-right">{ref?.raw?.con_link ? <a href={ref.raw.con_link} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Open</a> : <span className="text-muted">none</span>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Weight on sheet</dt><dd className="font-medium">{lot.invoice_weight_kg ? "typed" : "formula"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Taken from</dt><dd className="text-right font-medium">{ref ? `sheet tab “${ref.source_tab}”, row ${ref.source_row}` : "-"}</dd></div>
          </dl>
        </Card>

        <Card title="Flags on this plate" aside={issues.length ? <Badge tone="warning">{issues.length}</Badge> : undefined}>
          {issues.length === 0 ? (
            <p className="px-5 py-6 text-[0.92rem] text-muted">Nothing flagged. The sheet rows for this plate were clean.</p>
          ) : (
            <ul className="divide-y divide-line">
              {issues.map((i, n) => (
                <li key={n} className="space-y-1.5 px-5 py-3.5">
                  <Badge tone={sev[i.severity as keyof typeof sev] ?? "neutral"}>{i.severity === "error" ? "Serious" : i.severity === "warning" ? "Check" : "Note"}</Badge>
                  <p className="text-[0.9rem] leading-snug">{i.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
