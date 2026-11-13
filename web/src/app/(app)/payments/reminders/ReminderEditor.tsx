"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Mail } from "lucide-react";
import { buildReminder, type RemRow, type Tone } from "@/lib/reminderMail";

const field = "w-full rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.9rem] focus:border-brand";

/** Prepare one customer's payment reminder: the statement e-mail is built from the Debtors list, the person checks it, picks who it goes to, and copies it into the mail. */
export function ReminderEditor({ party, entity, asOf, overdue, soon, hints }: {
  party: string; entity: "SPF" | "SAI"; asOf: string; overdue: RemRow[]; soon: RemRow[]; hints: { name: string; email: string }[];
}) {
  const oldest = overdue.reduce((a, r) => Math.max(a, r.days), 0);
  const [tone, setTone] = useState<Tone>(oldest > 30 ? "firm" : "statement");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`PAYMENT REMINDER, ${party}`);
  const [done, setDone] = useState<string | null>(null);
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

  return (
    <div className="grid gap-5 xl:grid-cols-[22rem_1fr]">
      <div className="space-y-4 rounded-lg border border-line bg-card p-4">
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">From</p>
          <p className="mt-1 text-[0.9rem]">The company&apos;s info mailbox <span className="text-muted">(sending from the app is switched on in a later step; for now copy the mail into Gmail)</span></p>
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
          <span className="mt-1 block text-[0.76rem] font-normal text-muted">To reply in the old conversation, add its subject after the customer&apos;s name, like “… . Re: Requirement … QUOTATION NO- …”.</span>
        </label>
        <label className="block text-[0.82rem] font-medium">Tone
          <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} className={field + " mt-1"}>
            <option value="statement">Statement of account (polite)</option>
            <option value="firm">Firm: payment overdue, please pay immediately</option>
          </select>
        </label>
        <div className="flex flex-col gap-2 pt-1">
          <button type="button" onClick={() => void copyBody()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            {done === "body" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{done === "body" ? "Copied: paste it into the mail" : "Copy the mail"}
          </button>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(subject).then(() => flash("subject")).catch(() => {}); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">
            {done === "subject" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{done === "subject" ? "Subject copied" : "Copy the subject"}
          </button>
          <a href={gmail} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-surface">
            <Mail className="h-4 w-4" />Open a new Gmail mail<ExternalLink className="h-3.5 w-3.5 text-muted" />
          </a>
          <p className="text-[0.76rem] text-muted">Press “Copy the mail”, open the Gmail mail (it already has To, Cc and the subject), click in the body and paste. The tables keep their layout.</p>
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-line bg-white p-5 text-[#1a2530]">
        <p className="mb-3 border-b border-[#e3e7ec] pb-2 text-[0.8rem] text-[#6b7785]">Preview · <span className="font-medium text-[#1a2530]">{subject || "(no subject)"}</span></p>
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: mail.html }} />
      </div>
    </div>
  );
}
