"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Mail, Send } from "lucide-react";
import { buildReminder, type RemRow, type Tone } from "@/lib/reminderMail";
import { openCompose } from "@/lib/mail/compose";
import type { Contact, Sent } from "@/lib/reminders";
import { ComposeHost } from "../../mail/mailbox/Composer";
import { locateThread } from "./actions";

const field = "w-full rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.9rem] focus:border-brand";
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Prepare one customer's payment reminder: the statement e-mail is built from the Debtors list, the person checks it, picks who it goes to, and opens it in the mail window to send. */
export function ReminderEditor({ party, entity, asOf, overdue, soon, hints, box, writable, canSend, saved, history }: {
  party: string; entity: "SPF" | "SAI"; asOf: string; overdue: RemRow[]; soon: RemRow[]; hints: { name: string; email: string }[];
  box: { id: string; address: string } | null; writable: boolean; canSend: boolean; saved: Contact; history: Sent[];
}) {
  const oldest = overdue.reduce((a, r) => Math.max(a, r.days), 0);
  const [tone, setTone] = useState<Tone>(oldest > 30 || history.length > 0 ? "firm" : "statement");
  const [to, setTo] = useState(saved.to);
  const [cc, setCc] = useState(saved.cc);
  const [subject, setSubject] = useState(saved.replySubject ? `PAYMENT REMINDER, ${party}. ${saved.replySubject}` : `PAYMENT REMINDER, ${party}`);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mail = useMemo(() => buildReminder({ entity, party, asOf, tone, overdue, soon }), [entity, party, asOf, tone, overdue, soon]);

  const flash = (what: string) => { setDone(what); window.setTimeout(() => setDone(null), 1800); };
  async function copyBody() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([mail.html], { type: "text/html" }), "text/plain": new Blob([mail.text], { type: "text/plain" }) })]);
      flash("body");
    } catch {
      try { await navigator.clipboard.writeText(mail.text); flash("body"); } catch { /* the browser refused: the preview can still be selected by hand */ }
    }
  }
  const add = (list: string, email: string) => (list.split(/[,;\s]+/).includes(email) ? list : list.trim() ? `${list.trim().replace(/[,;]$/, "")}, ${email}` : email);
  const gmail = `https://mail.google.com/mail/?${new URLSearchParams({ view: "cm", fs: "1", to: to.replace(/\s/g, ""), cc: cc.replace(/\s/g, ""), su: subject })}`;

  // the mail window opens with everything filled in; the old conversation (if the subject names one) is found first, so the reminder goes in as a reply
  async function openMail() {
    if (!box || busy) return;
    setBusy(true);
    try {
      const re = /\bRe:\s.*$/i.exec(subject)?.[0];
      const t = re ? await locateThread(box.id, re) : null;
      openCompose({
        mb: box.id, address: box.address, mode: "new", title: "Payment reminder", to, cc, bcc: "", subject, html: mail.html,
        ...(t ? { threadId: t.threadId, inReplyTo: t.inReplyTo ?? undefined, references: t.references ?? undefined } : {}),
        reminder: { party, entity, invoices: overdue.map((r) => r.invoice), total: overdue.reduce((a, r) => a + r.balance, 0), count: overdue.length, oldest, tone },
      });
    } finally { setBusy(false); }
  }
  const why = !box ? "No mailbox is connected yet." : !writable ? "The sending mailbox is connected read-only, or your login may only read mail. An administrator can connect it again (Mail → Mailboxes)." : null;

  return (
    <>
      {history.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-card px-4 py-3 text-[0.86rem]">
          <p className="font-semibold">{history.length >= 12 ? "12+" : history.length} reminder{history.length === 1 ? "" : "s"} sent to {party} so far</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {history.slice(0, 4).map((h, i) => <li key={i}>{day(h.at)} · ₹{inr.format(Math.round(h.total))} across {h.count} invoice{h.count === 1 ? "" : "s"}{h.tone === "firm" ? " · firm" : ""}{h.by ? ` · by ${h.by}` : ""}</li>)}
          </ul>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-4 rounded-lg border border-line bg-card p-4">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">From</p>
            <p className="mt-1 text-[0.9rem] font-medium">{box ? box.address : "No mailbox connected"}</p>
          </div>
          <label className="block text-[0.82rem] font-medium">To
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="purchase@customer.com, accounts@customer.com" className={field + " mt-1"} autoComplete="off" />
          </label>
          {hints.length > 0 && (
            <div className="-mt-2 text-[0.78rem] text-muted">
              <p>Addresses in your Client Master that may belong to this customer:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {hints.map((h) => <button key={h.email} type="button" onClick={() => setTo((v) => add(v, h.email))} title={h.name} className="rounded-full border border-line bg-field px-2 py-0.5 text-[0.76rem] hover:border-brand hover:text-brand">{h.email}</button>)}
              </div>
            </div>
          )}
          <label className="block text-[0.82rem] font-medium">Cc
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="accounts@sambhavpipes.com" className={field + " mt-1"} autoComplete="off" />
          </label>
          <label className="block text-[0.82rem] font-medium">Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field + " mt-1"} autoComplete="off" />
            <span className="mt-1 block text-[0.76rem] font-normal text-muted">To send it into the old conversation, add its subject after the customer&apos;s name, like “… . Re: Requirement … QUOTATION NO- …”. The app finds that conversation in the mailbox and replies in it. It remembers the addresses and the subject for next time.</span>
          </label>
          <label className="block text-[0.82rem] font-medium">Tone
            <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} className={field + " mt-1"}>
              <option value="statement">Statement of account (polite)</option>
              <option value="firm">Firm: payment overdue, please pay immediately</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 pt-1">
            <button type="button" disabled={Boolean(why) || busy} onClick={() => void openMail()} title={why ?? undefined} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{canSend ? "Review and send from the app" : "Review and save as a draft"}
            </button>
            {why && <p className="text-[0.78rem] text-warn">{why}</p>}
            {!why && !canSend && <p className="text-[0.78rem] text-muted">Only an approver, an administrator or the owner can send. You can save it as a draft in the mailbox for one of them to send.</p>}
            <details className="text-[0.8rem] text-muted">
              <summary className="cursor-pointer hover:text-ink">Or copy it into Gmail yourself</summary>
              <div className="mt-2 flex flex-col gap-2">
                <button type="button" onClick={() => void copyBody()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface">
                  {done === "body" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{done === "body" ? "Copied: paste it into the mail" : "Copy the mail"}
                </button>
                <a href={gmail} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface"><Mail className="h-4 w-4" />Open a new Gmail mail<ExternalLink className="h-3.5 w-3.5 text-muted" /></a>
              </div>
            </details>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-line bg-white p-5 text-[#1a2530]">
          <p className="mb-3 border-b border-[#e3e7ec] pb-2 text-[0.8rem] text-[#6b7785]">Preview · <span className="font-medium text-[#1a2530]">{subject || "(no subject)"}</span></p>
          <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: mail.html }} />
        </div>
      </div>
      <ComposeHost canSend={canSend} />
    </>
  );
}
