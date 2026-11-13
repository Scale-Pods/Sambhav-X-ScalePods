"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { GmailLogo } from "@/components/GmailLogo";

/** Which connected mailbox the Mailbox page shows. Changing it opens that mailbox's Inbox. */
export function LiveMailboxSelect({ value, options, canAdd }: { value: string; options: { value: string; label: string }[]; canAdd: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[0.82rem] text-muted">
      <span className="flex items-center gap-1.5"><GmailLogo className="h-3.5 w-auto" /> Mailbox</span>
      <select value={value} aria-label="Mailbox" className="max-w-[16rem] rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.85rem] text-ink"
        onChange={(e) => { if (e.target.value === "__add") { window.location.href = "/api/mail/google/connect"; return; } start(() => router.push(`${path}?mb=${e.target.value}`)); }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {canAdd && <option value="__add">+ Add mailbox…</option>}
      </select>
    </label>
  );
}
