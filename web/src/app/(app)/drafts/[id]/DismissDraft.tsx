"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissDraft } from "../actions";

export function DismissDraft({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">Set this draft aside</button>;
  return (
    <div className="space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} disabled={pending} placeholder="Why? (kept on record)" className="w-full rounded-lg border border-line bg-field px-3 py-2 text-sm focus:border-brand" />
      {error && <p className="text-[0.85rem] text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => start(async () => { const r = await dismissDraft(id, note); if (!r.ok) setError(r.error); else router.refresh(); })} className="rounded-lg bg-bad px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving…" : "Set aside"}</button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(""); }} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">Cancel</button>
      </div>
    </div>
  );
}
