"use client";

import { useState, useTransition } from "react";
import { decideAdjustment, decideGroup, postCount } from "./actions";

const btn = "rounded-md px-3.5 py-2 text-[0.88rem] font-semibold disabled:cursor-not-allowed disabled:opacity-50";

/** The button that turns a closed count into approval requests. Asks twice, because it cannot be taken back. */
export function SendForApproval({ sessionId, requests }: { sessionId: string; requests: number }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!sure) {
    return <button type="button" onClick={() => setSure(true)} disabled={requests === 0} className={btn + " bg-ink text-surface hover:bg-accent hover:text-white"}>Send {requests} differences for approval</button>;
  }
  return (
    <div className="space-y-3">
      <p className="text-[0.92rem] text-muted">This creates {requests} approval requests. Nothing changes in the books until another approver decides each one. It can only be done once per count.</p>
      {error && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-[0.88rem] text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} className={btn + " bg-accent text-white hover:opacity-90"}
          onClick={() => start(async () => { const r = await postCount(sessionId); if (!r.ok) setError(r.error); })}>{pending ? "Sending…" : "Yes, send them"}</button>
        <button type="button" onClick={() => setSure(false)} className={btn + " border border-line bg-field text-muted hover:text-ink"}>Cancel</button>
      </div>
    </div>
  );
}

/** Approve or reject one difference. Approving can use a different amount; a reason is needed for high-risk ones. */
export function RowActions({ id, proposedKg, high }: { id: string; proposedKg: number; high: boolean }) {
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(String(proposedKg));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setOpen("approve")} className="rounded-md bg-brand px-2.5 py-1 text-[0.8rem] font-semibold text-white hover:bg-brand-dark">Approve</button>
        <button type="button" onClick={() => setOpen("reject")} className="rounded-md border border-line px-2.5 py-1 text-[0.8rem] font-semibold text-muted hover:text-ink">Reject</button>
      </div>
    );
  }
  const approve = open === "approve";
  const changed = approve && Number(amount) !== proposedKg;
  const needNote = (approve && high) || !approve || changed;
  const submit = () => {
    if (needNote && note.trim().length < 3) { setError("Write a short reason."); return; }
    if (approve && !Number.isFinite(Number(amount))) { setError("Check the amount."); return; }
    start(async () => { const r = await decideAdjustment(id, approve ? "approved" : "rejected", note, changed ? Number(amount) : undefined); if (!r.ok) setError(r.error); });
  };
  return (
    <div className="w-64 space-y-2 text-left">
      {approve && (
        <label className="block text-[0.75rem] text-muted">Adjust by (kg)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.\-]/g, ""))} className="num mt-1 w-full rounded-md border border-line bg-field px-2 py-1.5 text-[0.88rem] text-ink" />
        </label>
      )}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} autoFocus
        placeholder={needNote ? (approve ? "Reason (required)" : "Why reject? (required)") : "Note (optional)"}
        className="w-full rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem]" />
      {error && <p role="alert" className="text-[0.78rem] text-bad">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => { setOpen(null); setError(""); }} className="rounded-md border border-line px-2.5 py-1 text-[0.8rem] font-medium text-muted hover:text-ink">Cancel</button>
        <button type="button" disabled={pending} onClick={submit} className={"rounded-md px-2.5 py-1 text-[0.8rem] font-semibold text-white disabled:opacity-60 " + (approve ? "bg-brand hover:bg-brand-dark" : "bg-bad hover:opacity-90")}>
          {pending ? "Saving…" : approve ? (changed ? "Approve this amount" : "Approve") : "Reject"}
        </button>
      </div>
    </div>
  );
}

/** Decide every pending difference of one kind at once. */
export function GroupActions({ sessionId, outcome, count, label, canApprove }: { sessionId: string; outcome: "short" | "excess" | "missing"; count: number; label: string; canApprove: boolean }) {
  const [open, setOpen] = useState<"approved" | "rejected" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (count === 0) return null;
  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        {canApprove && <button type="button" onClick={() => setOpen("approved")} className="rounded-md border border-brand/40 bg-brand-soft px-3 py-1.5 text-[0.82rem] font-semibold text-brand hover:bg-brand hover:text-white">Approve all {count} {label}</button>}
        <button type="button" onClick={() => setOpen("rejected")} className="rounded-md border border-line px-3 py-1.5 text-[0.82rem] font-semibold text-muted hover:text-ink">Reject all {count} {label}</button>
      </div>
    );
  }
  const go = () => {
    if (note.trim().length < 3) { setError("Write a short reason. It is kept on every one of them."); return; }
    start(async () => { const r = await decideGroup(sessionId, outcome, open, note); if (!r.ok) setError(r.error); else setOpen(null); });
  };
  return (
    <div className="max-w-xl space-y-2">
      <p className="text-[0.88rem] text-ink">{open === "approved" ? `Approve all ${count} ${label}?` : `Reject all ${count} ${label}?`} {open === "approved" && outcome === "missing" ? "Each one writes the plate off the books." : ""}</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} autoFocus placeholder="Reason (required)" className="w-full rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem]" />
      {error && <p role="alert" className="text-[0.8rem] text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={go} className={"rounded-md px-3 py-1.5 text-[0.82rem] font-semibold text-white disabled:opacity-60 " + (open === "approved" ? "bg-brand hover:bg-brand-dark" : "bg-bad hover:opacity-90")}>{pending ? "Working…" : "Yes, do it"}</button>
        <button type="button" onClick={() => { setOpen(null); setError(""); }} className="rounded-md border border-line px-3 py-1.5 text-[0.82rem] font-medium text-muted hover:text-ink">Cancel</button>
      </div>
    </div>
  );
}
