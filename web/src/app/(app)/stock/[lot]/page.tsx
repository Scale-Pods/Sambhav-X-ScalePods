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
  const sheet: Record<string, string | null | undefined> = ref?.raw ?? {};
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="rounded-lg border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[0.8rem] font-medium uppercase tracking-wide text-muted">{lot.grade}</p>
              <h1 className="mt-1 text-[1.9rem] font-semibold tracking-tight">{lot.plate_no ?? lot.heat_no}</h1>
              {lot.plate_no && lot.heat_no && <p className="text-muted">Heat number {lot.heat_no}</p>}
            </div>
            <div className="text-right">
              <p className="text-[0.8rem] font-medium uppercase tracking-wide text-muted">Left in stock</p>
              <p className={"num text-[2rem] font-semibold leading-tight " + (left < -0.5 ? "text-bad" : left > 0.5 ? "text-brand-dark" : "text-muted")}>{kg(left)} <span className="text-base font-medium text-muted">kg</span></p>
              <Badge tone={left > 0.5 ? "ok" : left < -0.5 ? "error" : "neutral"} info={left > 0.5 ? "Material is still left on this plate: received minus everything sold or cut." : left < -0.5 ? "The sheets record more sold from this plate than was received. One of the entries is probably wrong: see the flags below." : "Everything received has been sold or cut: nothing is left."}>{left > 0.5 ? "In stock" : left < -0.5 ? "Sold more than received" : "Sold out"}</Badge>
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
            <CertRow label="Mill certificate" url={sheet.link || sheet.tc_link} name={sheet.link_name} />
            <CertRow label="Consignment certificate" url={sheet.con_link} name={sheet.con_link_name} />
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

/** Only real web addresses become links. A file name or a person's name typed in the link column is shown as text. */
function CertRow({ label, url, name }: { label: string; url?: string | null; name?: string | null }) {
  const isWeb = !!url && /^https?:\/\//i.test(url);
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right">
        {isWeb ? (
          <a href={url!} target="_blank" rel="noopener noreferrer" title={name ?? undefined} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
            Open <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : url ? (
          <span className="break-words text-muted" title="Written on the sheet, but there is no link behind it">{url}</span>
        ) : (
          <span className="text-muted">none on the sheet</span>
        )}
      </dd>
    </div>
  );
}
