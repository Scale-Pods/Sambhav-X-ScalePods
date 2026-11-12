import { Badge, td, Th } from "@/components/ui";
import { blockerOf, type DispatchContext, type Receipt } from "@/lib/mill/view";
import { ReceiptButtons } from "./Buttons";

export const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "");
const kg = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n * 1000));
const t3 = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n));
const rate = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n));

/** One mill dispatch mail as read: the plates, the checks, and (while waiting) the approve and set-aside buttons. Used on the Mill dispatch tab and in the Inbox's reading pane. */
export function ReceiptCard({ r, ctx, canDecide, showHeader = true }: { r: Receipt; ctx: DispatchContext; canDecide: boolean; showHeader?: boolean }) {
  const blocked = r.status === "pending" ? blockerOf(r, ctx) : null;
  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{r.subject || "Dispatch details"} {r.is_test && <Badge tone="warning">Test mail</Badge>}</p>
            <p className="text-[0.85rem] text-muted">From {r.from_name || r.from_addr || "?"} · received {when(r.received_at ?? r.created_at)}{r.mailbox ? ` · in ${r.mailbox}` : ""}{r.source_kind ? ` · table read from the ${r.source_kind.replace("_", " ")}` : ""}</p>
          </div>
          <p className="text-[0.92rem]"><b>{r.totals.rows}</b> plates · <b>{r.totals.pieces}</b> pieces · <b>{t3(r.totals.tonnes)} t</b></p>
        </div>
      )}
      {r.consignments.length > 0 && (
        <p className="text-[0.85rem] text-muted">{r.consignments.map((c) => `${c.entity ?? "?"} → ${c.destination ?? "?"}, truck ${c.truck_no ?? "?"} (${c.plates} plates, ${t3(c.tonnes)} t)`).join(" · ")}</p>
      )}
      {r.warnings.map((w, i) => <p key={i} className="text-[0.85rem] text-warn">{w}</p>)}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-line"><Th>Company</Th><Th>Batch (heat)</Th><Th>Grade</Th><Th>Size mm</Th><Th right>Pieces</Th><Th right>Kg</Th><Th right info="Rupees per tonne, from the mill's mail.">Rate/t</Th><Th>Mill invoice item</Th><Th>Check</Th></tr></thead>
          <tbody className="divide-y divide-line">
            {r.rows.map((x, i) => (
              <tr key={i}>
                <td className={td}>{x.entity ?? "?"}</td>
                <td className={td + " font-medium"}>{x.batch}</td>
                <td className={td}>{x.grade_text}{x.grade_text && ctx.gradeOf.get(x.grade_text) ? <span className="block text-[0.78rem] text-muted">= {ctx.gradeOf.get(x.grade_text)}</span> : x.grade_text && r.status === "pending" ? <span className="block text-[0.78rem] text-warn">not in the grade list</span> : null}</td>
                <td className={td + " whitespace-nowrap"}>{x.thickness_mm} × {x.width_mm} × {x.length_mm}</td>
                <td className={td + " text-right"}>{x.pieces}</td>
                <td className={td + " text-right"}>{kg(x.tonnes)}</td>
                <td className={td + " text-right"}>{rate(x.upr)}</td>
                <td className={td + " whitespace-nowrap text-[0.82rem]"}>{x.invoice_item}</td>
                <td className={td}>{x.warnings.length === 0 ? <Badge tone="ok">OK</Badge> : <span className="text-[0.82rem] text-warn">{x.warnings.join("; ")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.status === "pending"
        ? <ReceiptButtons id={r.id} canDecide={canDecide} blocked={blocked} />
        : <p className="text-[0.88rem] text-muted"><Badge tone={r.status === "approved" ? "ok" : "neutral"}>{r.status === "approved" ? "Added to stock" : "Set aside"}</Badge> {r.decided_by ? `by ${r.decided_by} · ` : ""}{when(r.decided_at)}{r.note ? ` · ${r.note}` : ""}</p>}
    </div>
  );
}
