import Link from "next/link";
import { Badge } from "@/components/ui";
import type { Fit, FitLot } from "@/lib/stockfit";

const kgFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const size = (l: FitLot) => `${l.thickness_mm} × ${l.width_mm} × ${l.length_mm}`;

function LotList({ lots, label }: { lots: FitLot[]; label?: string }) {
  if (lots.length === 0) return null;
  return (
    <div className="mt-1.5">
      {label && <p className="mb-0.5 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">{label}</p>}
      <ul className="space-y-0.5 text-[0.85rem]">
        {lots.map((l) => (
          <li key={l.lot_no} className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/stock/${l.lot_no}`} className="font-medium text-brand hover:underline">Plate {l.lot_no}</Link>
            <span className="num">{size(l)} mm</span>
            <span className="text-muted">{kgFmt.format(l.balance_kg)} kg{l.balance_pieces ? ` · ${l.balance_pieces} pc` : ""}</span>
            {l.part && <Badge tone="warning" info="This plate has been partly cut. The length shown is what is left (worked out from its weight); it arrived this long.">part plate, cut from {l.original_length_mm}</Badge>}
            {l.exact_size && <Badge tone="ok" info="Same thickness, width and length as asked: no cutting needed.">exact size</Badge>}
            {(l.heat_no || l.plate_no) && <span className="text-muted">{[l.heat_no && `heat ${l.heat_no}`, l.plate_no && `plate no. ${l.plate_no}`].filter(Boolean).join(" · ")}</span>}
            {l.entity && <span className="text-muted">· {l.entity}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One wanted plate against the plates in stock. Shared by the document review screen and the Stock check page. */
export function StockFitView({ fit, title }: { fit: Fit; title?: string }) {
  const tone = fit.verdict === "enough" ? "ok" : fit.verdict === "partly" ? "warning" : fit.verdict === "none" ? "error" : "neutral";
  const label = fit.verdict === "enough" ? "In stock" : fit.verdict === "partly" ? "Only part in stock" : fit.verdict === "none" ? "Not in stock" : "Cannot check";
  const i = fit.input;
  const want = [i.grade, i.thk != null ? `${i.thk} mm` : null, i.width != null && i.length != null ? `${i.width} × ${i.length}` : null,
    i.needPcs != null ? `${i.needPcs} pc` : null, i.needKg != null ? `${kgFmt.format(i.needKg)} kg` : null].filter(Boolean).join(" · ");
  return (
    <div className="rounded-md border border-line bg-surface/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {title && <span className="text-muted">{title}</span>}
        <span className="font-medium">{want || "No details"}</span>
        <Badge tone={tone} info={fit.verdict === "enough" ? "Plates of the same grade and a fitting size cover the quantity asked." : fit.verdict === "partly" ? "There are fitting plates, but not enough for the whole quantity." : fit.verdict === "none" ? "No plate of this grade fits the thickness and size asked." : "The grade or size could not be read well enough to check."}>{label}</Badge>
        {fit.grade.code && fit.grade.code !== i.grade && <span className="text-[0.8rem] text-muted">read as {fit.grade.code}</span>}
      </div>
      <p className="mt-0.5 text-[0.85rem] text-muted">{fit.why}</p>
      <LotList lots={fit.lots} />
      {fit.verdict === "none" && <LotList lots={fit.near} label="Nearby thickness, same grade" />}
    </div>
  );
}
