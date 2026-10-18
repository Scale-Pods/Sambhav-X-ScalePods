"use client";

import { useState, useTransition } from "react";
import { approveException } from "./actions";

export function ApproveButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return <button onClick={() => setOpen(true)} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">Approve</button>;
  }
  return (
    <div className="w-72 space-y-2 text-left">
      <textarea
        autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300}
        placeholder="Why is this fine? (kept on record)"
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand"
      />
      {error && <p className="text-[0.8rem] text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => { setOpen(false); setError(""); }} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface">Cancel</button>
        <button
          disabled={pending}
          onClick={() => start(async () => { const r = await approveException(id, note); if (!r.ok) setError(r.error); })}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >{pending ? "Saving…" : "Save approval"}</button>
      </div>
    </div>
  );
}
