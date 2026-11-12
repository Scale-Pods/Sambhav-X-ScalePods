"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type Check, checkKey } from "@/lib/docreader/checks";
import { BLANK_ROW, FAMILY_UI, type FamilyRead, runChallanChecks, runInvoiceChecks, runMtcChecks } from "@/lib/docreader/families";
import { reviewFamilyDocument } from "./actions";

const input = "w-full rounded-md border bg-field px-2 py-1.5 text-[0.9rem] focus:border-brand disabled:opacity-70 ";
const cls = (amber: boolean, edited: boolean) => input + (amber ? "border-warn bg-warn-soft" : edited ? "border-brand" : "border-line");

type Rec = Record<string, unknown>;

/** The review form for a vendor invoice or a mill certificate: the same idea as the order form, driven by the layout in families.ts. */
export function FamilyReviewForm({ id, original, firstChecks, canEdit }: { id: string; original: FamilyRead; firstChecks: Check[]; canEdit: boolean }) {
  const router = useRouter();
  const cfg = FAMILY_UI[original.family];
  const [r, setR] = useState<FamilyRead>(original);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const [acked, setAcked] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const same = JSON.stringify(r) === JSON.stringify(original);
  const run = (x: FamilyRead) => (x.family === "invoice" ? runInvoiceChecks(x) : x.family === "challan" ? runChallanChecks(x) : runMtcChecks(x));
  // the rules run again as the person edits, so a fixed value stops being amber at once
  const checks = useMemo(() => (same ? firstChecks : [...run(r), ...firstChecks.filter((c) => c.field === "pages" || c.field === "second_read")]), [r, same, firstChecks]); 
  const flagged = useMemo(() => run(r).filter((c) => c.level === "amber"), [r]);
  const unticked = flagged.filter((c) => !acked.includes(checkKey(c)));
  const amber = new Set(checks.filter((c) => c.level === "amber").map((c) => c.field));
  const rec = r as unknown as Rec, orig = original as unknown as Rec;
  const list = (rec[cfg.listKey] as Record<string, string>[]) ?? [];
  const origList = (orig[cfg.listKey] as Record<string, string>[]) ?? [];

  const set = (k: string, v: string) => setR((x) => ({ ...x, [k]: v }) as FamilyRead);
  const setCell = (i: number, k: string, v: string) => setR((x) => ({ ...x, [cfg.listKey]: ((x as unknown as Rec)[cfg.listKey] as Record<string, string>[]).map((row, j) => (j === i ? { ...row, [k]: v } : row)) }) as FamilyRead);
  const addRow = () => setR((x) => ({ ...x, [cfg.listKey]: [...((x as unknown as Rec)[cfg.listKey] as Record<string, string>[]), { ...BLANK_ROW[original.family] }] }) as FamilyRead);
  const dropRow = (i: number) => setR((x) => ({ ...x, [cfg.listKey]: ((x as unknown as Rec)[cfg.listKey] as Record<string, string>[]).filter((_, j) => j !== i) }) as FamilyRead);

  function submit(decision: "confirmed" | "rejected") {
    setError("");
    if (decision === "rejected" && !note.trim()) { setError("Say why you are rejecting it."); return; }
    start(async () => {
      const res = await reviewFamilyDocument(id, decision, decision === "rejected" ? null : r, note, acked);
      if (!res.ok) setError(res.error); else router.push(res.draftId ? `/drafts/${res.draftId}` : "/documents");
    });
  }

  const shown = checks.filter((c) => c.field !== "second_read");
  return (
    <div className="space-y-5">
      {shown.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-line bg-card p-4">
          <h3 className="font-display text-[0.95rem] font-bold">Checks</h3>
          <ul className="space-y-1 text-[0.88rem]">
            {shown.map((c, i) => (
              <li key={i} className={c.level === "amber" ? "text-warn" : "text-muted"}>
                <span className="font-semibold">{c.level === "amber" ? "Check: " : "Note: "}</span>{c.message}
                {c.level === "amber" && canEdit && (
                  <label className="ml-2 inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
                    <input type="checkbox" disabled={pending} checked={acked.includes(checkKey(c))} onChange={(e) => setAcked((a) => (e.target.checked ? [...a, checkKey(c)] : a.filter((k) => k !== checkKey(c))))} />
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
        {cfg.header.map((h) => (
          <label key={h.key} className={"block " + (h.wide ? "sm:col-span-2" : "")}>
            <span className="mb-1 block text-[0.72rem] font-semibold uppercase tracking-wider text-muted">{h.label}</span>
            {h.select ? (
              <select disabled={!canEdit || pending} value={String(rec[h.key] ?? "")} onChange={(e) => set(h.key, e.target.value)} className={cls(amber.has(h.key), String(rec[h.key]) !== String(orig[h.key]))}>
                {Object.entries(h.select).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            ) : (
              <input disabled={!canEdit || pending} value={String(rec[h.key] ?? "")} onChange={(e) => set(h.key, e.target.value)} className={cls(amber.has(h.key), String(rec[h.key]) !== String(orig[h.key]))} />
            )}
          </label>
        ))}
      </div>

      <div>
        <h3 className="mb-2 font-display text-[0.95rem] font-bold">{cfg.listTitle}</h3>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[0.88rem]" style={{ minWidth: `${cfg.cols.length * 5.5}rem` }}>
            <thead><tr className="border-b border-line bg-surface text-left text-[0.7rem] uppercase tracking-wider text-muted">
              {cfg.cols.map((c) => <th key={c.key} className="px-2 py-2 font-semibold">{c.label}</th>)}<th />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {list.map((row, i) => (
                <tr key={i}>
                  {cfg.cols.map((c) => {
                    const edited = !origList[i] || origList[i][c.key] !== row[c.key];
                    const a = amber.has(`${cfg.listKey}.${i}.${c.key}`);
                    return (
                      <td key={c.key} className="px-1 py-1.5">
                        {c.select ? (
                          <select disabled={!canEdit || pending} value={row[c.key] ?? ""} onChange={(e) => setCell(i, c.key, e.target.value)} className={cls(a, edited) + c.w}>{c.select.map((v) => <option key={v}>{v}</option>)}</select>
                        ) : (
                          <input disabled={!canEdit || pending} value={row[c.key] ?? ""} onChange={(e) => setCell(i, c.key, e.target.value)} className={cls(a, edited) + c.w} title={row.description} />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1">{canEdit && <button type="button" onClick={() => dropRow(i)} className="px-1 text-muted hover:text-bad" aria-label="Remove row">×</button>}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={cfg.cols.length + 1} className="px-3 py-4 text-center text-muted">Nothing was read.</td></tr>}
            </tbody>
          </table>
        </div>
        {canEdit && <button type="button" onClick={addRow} className="mt-2 text-[0.85rem] font-medium text-brand hover:underline">+ Add a row</button>}
      </div>

      {original.uncertain.length > 0 && (
        <details className="rounded-lg border border-line bg-card p-4 text-[0.88rem]">
          <summary className="cursor-pointer font-semibold">What the reader was unsure about ({original.uncertain.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{original.uncertain.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </details>
      )}

      {canEdit && (
        <div className="space-y-3 border-t border-line pt-4">
          {(rejecting || !same) && (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} disabled={pending}
              placeholder={rejecting ? "Why are you rejecting it? (required, kept on record)" : "Note (optional, kept on record)"}
              className="w-full rounded-lg border border-line bg-field px-3 py-2 text-sm focus:border-brand" />
          )}
          {error && <p className="text-[0.85rem] text-bad">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!rejecting ? (
              <>
                <button disabled={pending || unticked.length > 0} title={unticked.length > 0 ? "Tick each flagged check once you have looked at it" : undefined} onClick={() => submit("confirmed")}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">{pending ? "Saving…" : !same ? "Save my corrections and confirm" : "Looks right, confirm"}</button>
                <button disabled={pending} onClick={() => setRejecting(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">Reject</button>
                {!same && <button disabled={pending} onClick={() => setR(original)} className="text-sm text-muted hover:underline">Undo my edits</button>}
              </>
            ) : (
              <>
                <button disabled={pending} onClick={() => submit("rejected")} className="rounded-lg bg-bad px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving…" : "Reject this document"}</button>
                <button disabled={pending} onClick={() => { setRejecting(false); setError(""); }} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">Cancel</button>
              </>
            )}
          </div>
          <p className="text-[0.8rem] text-muted">
            {original.family === "invoice"
              ? "Confirming a vendor invoice makes a draft purchase invoice. Nothing is posted to the books or to Tally."
              : original.family === "challan"
                ? "Confirming a challan saves the reading as checked. Stock is not deducted yet: posting a confirmed challan to stock is the next step."
                : "Confirming a certificate files it and links it to the plates in stock that carry its heat or plate numbers. Numbers we do not hold are left alone."}
          </p>
        </div>
      )}
    </div>
  );
}
