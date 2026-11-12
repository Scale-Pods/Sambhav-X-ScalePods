"use client";

import { useState, useTransition } from "react";
import { approveReceipt, disconnectMailbox, rejectReceipt, syncNow, type Result } from "./actions";

const btn = "rounded-lg px-3.5 py-1.5 text-sm font-medium disabled:opacity-50";

function Note({ r }: { r: Result | null }) {
  if (!r) return null;
  return <p className={"mt-2 text-[0.88rem] " + (r.ok ? "text-ok" : "text-bad")}>{r.ok ? r.message : r.error}</p>;
}

/** Approve or set aside one suggestion. */
export function ReceiptButtons({ id, canDecide, blocked }: { id: string; canDecide: boolean; blocked: string | null }) {
  const [busy, go] = useTransition();
  const [res, setRes] = useState<Result | null>(null);
  if (!canDecide) return <p className="text-[0.85rem] text-muted">Only an approver, an administrator or the owner can approve this.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || blocked !== null} title={blocked ?? undefined} className={btn + " bg-brand text-white hover:bg-brand-dark"} onClick={() => go(async () => setRes(await approveReceipt(id)))}>Approve and add to stock</button>
        <button type="button" disabled={busy} className={btn + " border border-line hover:bg-surface"} onClick={() => { const note = window.prompt("Why is this not being added? (optional)"); if (note === null) return; go(async () => setRes(await rejectReceipt(id, note))); }}>Set aside</button>
        {busy && <span className="text-[0.85rem] text-muted">Working…</span>}
      </div>
      {blocked && <p className="mt-2 text-[0.85rem] text-warn">{blocked}</p>}
      <Note r={res} />
    </div>
  );
}

/** Look in the mailbox now; disconnect it. */
export function MailboxButtons({ mailboxId }: { mailboxId: string }) {
  const [busy, go] = useTransition();
  const [res, setRes] = useState<Result | null>(null);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={btn + " bg-brand text-white hover:bg-brand-dark"} onClick={() => go(async () => setRes(await syncNow()))}>{busy ? "Looking…" : "Look for new mails now"}</button>
        <button type="button" disabled={busy} className={btn + " border border-line hover:bg-surface"} onClick={() => { if (window.confirm("Disconnect this mailbox? The app stops reading it.")) go(async () => setRes(await disconnectMailbox(mailboxId))); }}>Disconnect</button>
      </div>
      <Note r={res} />
    </div>
  );
}
