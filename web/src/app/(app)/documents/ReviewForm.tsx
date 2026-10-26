"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type Check, type Read, type ReadLine, checkKey, runChecks } from "@/lib/docreader/checks";
import { KIND } from "@/lib/docreader/labels";
import { reviewDocument } from "./actions";

const DIRECTION: Record<string, string> = {
  customer_orders_from_us: "A customer orders from us", we_buy_from_supplier: "We buy from a supplier", our_own_document: "Our own document", unclear: "Unclear",
};
const UNITS = ["nos", "kg", "mt", "m", "m2", "other", "not_shown"];
const RATE_UNITS = ["per_kg", "per_mt", "per_nos", "per_m", "other", "not_shown"];

const input = "w-full rounded-md border bg-field px-2 py-1.5 text-[0.9rem] focus:border-brand disabled:opacity-70 ";
const cls = (amber: boolean, edited: boolean) => input + (amber ? "border-warn bg-warn-soft" : edited ? "border-brand" : "border-line");

export function ReviewForm({ id, original, firstChecks, canEdit }: { id: string; original: Read; firstChecks: Check[]; canEdit: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<Read>(original);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [acked, setAcked] = useState<string[]>([]);

  // the rules run again as the person edits, so a fixed value stops being amber at once
  const checks = useMemo(() => (JSON.stringify(r) === JSON.stringify(original) ? firstChecks : [...runChecks(r), ...firstChecks.filter((c) => c.field === "pages" || c.field === "second_read")]), [r, original, firstChecks]);
  const amber = new Set(checks.filter((c) => c.level === "amber").map((c) => c.field));
  // each value still flagged must be ticked as looked at before the document can be confirmed (the server checks this again)
  const flagged = useMemo(() => runChecks(r).filter((c) => c.level === "amber"), [r]);
  const unticked = flagged.filter((c) => !acked.includes(checkKey(c)));
  const changed = JSON.stringify(r) !== JSON.stringify(original);
  const edited = (k: keyof Read) => String(r[k]) !== String(original[k]);

  const set = <K extends keyof Read>(k: K, v: Read[K]) => setR((x) => ({ ...x, [k]: v }));
  const setLine = (i: number, k: keyof ReadLine, v: string) => setR((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addLine = () => setR((x) => ({ ...x, lines: [...x.lines, { description: "", grade: "", thickness_mm: "", width_mm: "", length_mm: "", qty: "", qty_unit: "nos", weight_kg: "", rate: "", rate_unit: "per_kg", amount: "" }] }));
  const dropLine = (i: number) => setR((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }));

  function submit(decision: "confirmed" | "rejected") {
    setError("");
    if (decision === "rejected" && !note.trim()) { setError("Say why you are rejecting it."); return; }
    start(async () => {
      const res = await reviewDocument(id, decision, decision === "rejected" ? null : r, note, acked);
      if (!res.ok) setError(res.error); else router.push(res.draftId ? `/drafts/${res.draftId}` : "/documents");
    });
  }

  const hdr = (label: string, k: keyof Read, wide = false) => (
    <label className={"block " + (wide ? "sm:col-span-2" : "")}>
      <span className="mb-1 block text-[0.72rem] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <input disabled={!canEdit || pending} value={String(r[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} className={cls(amber.has(k as string), edited(k))} />
    </label>
  );
  const sel = (label: string, k: "doc_kind" | "direction", opts: Record<string, string>) => (
    <label className="block">
      <span className="mb-1 block text-[0.72rem] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <select disabled={!canEdit || pending} value={r[k]} onChange={(e) => set(k, e.target.value)} className={cls(false, edited(k))}>
        {Object.entries(opts).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      {checks.filter((c) => c.field !== "second_read").length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-line bg-card p-4">
          <h3 className="font-display text-[0.95rem] font-bold">Checks</h3>
          <ul className="space-y-1 text-[0.88rem]">
            {checks.filter((c) => c.field !== "second_read").map((c, i) => (
              <li key={i} className={c.level === "amber" ? "text-warn" : "text-muted"}>
                <span className="font-semibold">{c.level === "amber" ? "Check: " : "Note: "}</span>{c.message}
                {c.level === "amber" && canEdit && (
                  <label className="ml-2 inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
                    <input type="checkbox" disabled={pending} checked={acked.includes(checkKey(c))}
                      onChange={(e) => setAcked((a) => (e.target.checked ? [...a, checkKey(c)] : a.filter((k) => k !== checkKey(c))))} />
                    <span className="text-[0.82rem]">I checked this against the document</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {checks.some((c) => c.field === "second_read") && <p className="text-[0.82rem] text-muted">{checks.find((c) => c.field === "second_read")?.message}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {sel("What is it", "doc_kind", KIND)}
        {sel("Who orders from whom", "direction", DIRECTION)}
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" disabled={!canEdit || pending} checked={r.is_firm_order} onChange={(e) => set("is_firm_order", e.target.checked)} />
          <span className="text-[0.92rem]">This is a firm order</span>
        </label>
        {hdr("Buyer", "buyer_name", true)}
        {hdr("Buyer GSTIN", "buyer_gstin")}
        {hdr("Selling name on the document", "seller_entity_named")}
        {hdr("PO / order number", "po_number")}
        {hdr("Document number (D.O., proforma, SR…)", "document_number")}
        {hdr("Date (YYYY-MM-DD)", "po_date")}
        {hdr("Payment terms", "payment_terms")}
        {hdr("Delivery", "delivery_terms")}
        {hdr("Net amount", "net_amount")}
        {hdr("Tax", "tax_amount")}
        {hdr("Total", "total_amount")}
      </div>

      <div>
        <h3 className="mb-2 font-display text-[0.95rem] font-bold">Lines</h3>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[56rem] text-[0.88rem]">
            <thead><tr className="border-b border-line bg-surface text-left text-[0.7rem] uppercase tracking-wider text-muted">
              {["Grade", "Thk", "Width", "Length", "Qty", "Unit", "Weight kg", "Rate", "Per", "Amount", ""].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {r.lines.map((l, i) => {
                const o = original.lines[i];
                const cell = (k: keyof ReadLine, w = "w-20") => (
                  <td className="px-1 py-1.5"><input disabled={!canEdit || pending} value={l[k]} onChange={(e) => setLine(i, k, e.target.value)}
                    className={cls(amber.has(`lines.${i}.${k}`), !o || o[k] !== l[k]) + w} title={l.description} /></td>
                );
                const pick = (k: "qty_unit" | "rate_unit", opts: string[]) => (
                  <td className="px-1 py-1.5"><select disabled={!canEdit || pending} value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} className={cls(false, !o || o[k] !== l[k]) + "w-24"}>
                    {opts.map((v) => <option key={v}>{v}</option>)}</select></td>
                );
                return (
                  <tr key={i}>
                    {cell("grade", "w-28")}{cell("thickness_mm", "w-16")}{cell("width_mm", "w-20")}{cell("length_mm", "w-20")}{cell("qty", "w-16")}{pick("qty_unit", UNITS)}
                    {cell("weight_kg", "w-24")}{cell("rate", "w-20")}{pick("rate_unit", RATE_UNITS)}{cell("amount", "w-28")}
                    <td className="px-1">{canEdit && <button type="button" onClick={() => dropLine(i)} className="px-1 text-muted hover:text-bad" aria-label="Remove line">×</button>}</td>
                  </tr>
                );
              })}
              {r.lines.length === 0 && <tr><td colSpan={11} className="px-3 py-4 text-center text-muted">No lines were read.</td></tr>}
            </tbody>
          </table>
        </div>
        {canEdit && <button type="button" onClick={addLine} className="mt-2 text-[0.85rem] font-medium text-brand hover:underline">+ Add a line</button>}
      </div>

      {original.uncertain.length > 0 && (
        <details className="rounded-lg border border-line bg-card p-4 text-[0.88rem]">
          <summary className="cursor-pointer font-semibold">What the reader was unsure about ({original.uncertain.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{original.uncertain.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </details>
      )}

      {canEdit && (
        <div className="space-y-3 border-t border-line pt-4">
          {(rejecting || changed) && (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} disabled={pending}
              placeholder={rejecting ? "Why are you rejecting it? (required, kept on record)" : "Note (optional, kept on record)"}
              className="w-full rounded-lg border border-line bg-field px-3 py-2 text-sm focus:border-brand" />
          )}
          {error && <p className="text-[0.85rem] text-bad">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!rejecting ? (
              <>
                <button disabled={pending || unticked.length > 0} title={unticked.length > 0 ? "Tick each flagged check once you have looked at it" : undefined} onClick={() => submit("confirmed")} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
                  {pending ? "Saving…" : changed ? "Save my corrections and confirm" : "Looks right, confirm"}
                </button>
                <button disabled={pending} onClick={() => setRejecting(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">Reject</button>
                {changed && <button disabled={pending} onClick={() => setR(original)} className="text-sm text-muted hover:underline">Undo my edits</button>}
              </>
            ) : (
              <>
                <button disabled={pending} onClick={() => submit("rejected")} className="rounded-lg bg-bad px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving…" : "Reject this document"}</button>
                <button disabled={pending} onClick={() => { setRejecting(false); setError(""); }} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">Cancel</button>
              </>
            )}
          </div>
          <p className="text-[0.8rem] text-muted">Confirming records the document and your decision. A customer order or enquiry also becomes a draft you can work from; nothing is posted anywhere.</p>
        </div>
      )}
    </div>
  );
}
