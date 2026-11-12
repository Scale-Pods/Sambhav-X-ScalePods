import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { GmailLogo } from "@/components/GmailLogo";
import { canExport, currentStaff } from "@/lib/auth";
import { serviceQuery } from "@/lib/db";
import { mailSources, TRACKER_ADDRESS } from "@/lib/mailboxes";
import { MailboxButtons } from "../dispatch/Buttons";

export const metadata = { title: "Mailboxes · Sambhav Stock" };
type SP = Promise<Record<string, string | undefined>>;

export default function MailboxesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={6} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "never");

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const me = await currentStaff().catch(() => null);
  const admin = canExport(me?.role);
  const sources = await mailSources();
  // the filters and the last problem of each connected mailbox (never the Google login)
  const info = new Map((await serviceQuery<{ mailbox_id: string; sender_filter: string; subject_filter: string; last_error: string | null; connected_at: string }>(
    `select mailbox_id, sender_filter, subject_filter, last_error, connected_at::text from public.mailbox_tokens`)).map((r) => [r.mailbox_id, r]));
  return (
    <div className="space-y-6">
      {sp.connected && <p className="rounded-lg bg-ok-soft px-4 py-3 text-[0.92rem] text-ok">Connected {sp.connected}. The app will look for the mill&apos;s dispatch mails in it every 15 minutes.</p>}
      {sp.error && <p className="rounded-lg bg-bad-soft px-4 py-3 text-[0.92rem] text-bad">{sp.error}</p>}
      <Card title="Mailboxes" aside={admin ? <a href="/api/mail/google/connect" className="rounded-lg bg-brand px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">+ Add mailbox</a> : undefined}>
        <ul className="divide-y divide-line">
          {sources.map((s) => {
            const i = s.id ? info.get(s.id) : undefined;
            return (
              <li key={s.value} className="space-y-1.5 px-5 py-4">
                <p className="flex flex-wrap items-center gap-2 font-semibold"><GmailLogo className="h-4 w-auto" />{s.address} {s.kind === "tracker" ? <Badge tone="info">Email Tracker sheet</Badge> : null} {s.connected ? <Badge tone={i?.last_error ? "error" : "ok"}>{i?.last_error ? "Problem" : "Connected"}</Badge> : null}</p>
                {s.kind === "tracker" && <p className="text-[0.88rem] text-muted">Quotations, Inbox and Clients are read from this mailbox&apos;s Email Tracker sheet, a copy that refreshes once a day. Last copied {when(s.last_synced_at)}.{s.connected ? "" : " Its dispatch mails are not read yet: connect it to start."}</p>}
                {s.connected && i && (
                  <>
                    <p className="text-[0.88rem] text-muted">Reads only the mill&apos;s dispatch mails: subject with &ldquo;{i.subject_filter}&rdquo;{i.sender_filter ? ` from ${i.sender_filter}` : ""}. Last looked {when(s.last_synced_at)}.</p>
                    {i.last_error && <p className="text-[0.88rem] text-bad">{i.last_error}</p>}
                    {admin && <MailboxButtons mailboxId={s.id as string} />}
                  </>
                )}
                {!s.connected && s.address === TRACKER_ADDRESS && admin && <a href="/api/mail/google/connect" className="inline-block text-[0.88rem] font-medium text-brand hover:underline">Connect this mailbox for dispatch mails</a>}
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="text-[0.85rem] text-muted">A connected mailbox is read-only: the app can never send, change or delete a mail, and only dispatch mails are picked up. Everything shown here is open to every staff login.</p>
    </div>
  );
}
