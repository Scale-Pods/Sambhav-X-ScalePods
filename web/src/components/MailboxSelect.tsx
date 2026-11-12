"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GmailLogo } from "./GmailLogo";
import { useTransition } from "react";

/** The mailbox dropdown of Mail & leads, built like the period dropdown next to it. The last entry (administrators) goes to Google to connect another mailbox. */
export function MailboxSelect({ value, options, canAdd }: { value: string; options: { value: string; label: string }[]; canAdd: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[0.82rem] text-muted">
      <span className="flex items-center gap-1.5"><GmailLogo className="h-3.5 w-auto" /> Mailbox</span>
      <select
        value={value}
        aria-label="Mailbox"
        className="max-w-[16rem] rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.85rem] text-ink"
        onChange={(e) => {
          if (e.target.value === "__add") { window.location.href = "/api/mail/google/connect"; return; }
          const u = new URLSearchParams(sp.toString());
          if (e.target.value === "all") u.delete("mb"); else u.set("mb", e.target.value);
          u.delete("page"); u.delete("m");
          start(() => router.push(`${pathname}${u.toString() ? "?" + u : ""}`));
        }}
      >
        <option value="all">All mailboxes</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {canAdd && <option value="__add">+ Add mailbox…</option>}
      </select>
    </label>
  );
}
