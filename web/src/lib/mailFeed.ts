import "server-only";
import { q } from "./db";
import type { Scope } from "./mailboxes";

// The Gmail-style Inbox: one list made of the Email Tracker sheet's mails and the mill dispatch mails read from the connected mailboxes.

export type Label = "inbox" | "urgent" | "followup" | "replied" | "ignored" | "dispatch";
export const LABELS: { key: Label; name: string; info: string }[] = [
  { key: "inbox", name: "Inbox", info: "Mails nobody has replied to yet, and dispatch mails waiting for approval" },
  { key: "urgent", name: "Urgent", info: "Waiting mails marked Urgent in the Email Tracker" },
  { key: "followup", name: "Follow up", info: "Waiting mails marked Follow up in the Email Tracker" },
  { key: "replied", name: "Replied", info: "Mails that were replied to, and dispatch mails already decided" },
  { key: "ignored", name: "Ignored", info: "Mails set aside in the Email Tracker" },
  { key: "dispatch", name: "Mill dispatch", info: "The mill's dispatch mails, from the connected mailboxes" },
];
export const isLabel = (v: string | undefined): v is Label => LABELS.some((l) => l.key === v);

export type FeedItem = { key: string; source: "tracker" | "dispatch"; subject: string | null; from_name: string | null; from_addr: string | null; at: string | null; preview: string | null; state: string; status: string | null; days: number | null; mailbox_id: string | null };
export const PER_PAGE = 40;

// $1 = do the tracker sheet's mails apply, $2 = the connected mailboxes whose dispatch mails apply (null = all)
const FEED = `
  select 't:' || i.state || ':' || i.row_no as key, 'tracker'::text as source, i.subject, nullif(btrim(i.from_name), '') as from_name, i.from_email as from_addr,
         i.received_at as at, nullif(btrim(i.remarks), '') as preview, i.state, i.status, i.days::int as days, null::uuid as mailbox_id
    from public.v_mail_inbox i where $1::boolean
  union all
  select 'd:' || m.id::text, 'dispatch', m.subject, coalesce(nullif(btrim(m.from_name), ''), m.from_addr), m.from_addr,
         (coalesce(m.received_at, m.created_at) at time zone 'Asia/Kolkata'),
         case when r.id is null then 'No dispatch table was found in this mail'
              else (r.totals->>'rows') || ' plates · ' || (r.totals->>'tonnes') || ' t' || case r.status when 'pending' then ' · waiting for approval' when 'approved' then ' · added to stock' else ' · set aside' end end,
         case when r.id is null or r.status = 'pending' then 'Pending' else 'Done' end, null, null, m.mailbox_id
    from public.mill_mails m left join public.mill_receipts r on r.message_id = m.id
   where ($2::uuid[] is null or m.mailbox_id = any($2::uuid[]))`;

const LABEL_SQL = `case $3::text when 'inbox' then state = 'Pending' when 'urgent' then status = 'URGENT' and state = 'Pending' when 'followup' then status = 'Follow Up' and state = 'Pending'
  when 'replied' then state = 'Done' when 'ignored' then state = 'Ignored' when 'dispatch' then source = 'dispatch' else true end`;

export async function inboxFeed(scope: Scope, label: Label, search: string, page: number) {
  const like = search.trim() ? `%${search.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
  const args = [scope.tracker, scope.mailboxIds];
  const [counts] = await q<Record<Label, number>>(
    `with feed as (${FEED})
     select count(*) filter (where state = 'Pending')::int inbox, count(*) filter (where status = 'URGENT' and state = 'Pending')::int urgent,
            count(*) filter (where status = 'Follow Up' and state = 'Pending')::int followup, count(*) filter (where state = 'Done')::int replied,
            count(*) filter (where state = 'Ignored')::int ignored, count(*) filter (where source = 'dispatch')::int dispatch from feed`, args);
  const where = `${LABEL_SQL} and ($4::text is null or subject ilike $4 or from_name ilike $4 or from_addr ilike $4 or preview ilike $4)`;
  const [tot] = await q<{ n: number }>(`with feed as (${FEED}) select count(*)::int n from feed where ${where}`, [...args, label, like]);
  const pages = Math.max(1, Math.ceil((tot?.n ?? 0) / PER_PAGE));
  const pg = Math.min(Math.max(1, page), pages);
  const items = await q<FeedItem>(
    `with feed as (${FEED}) select key, source, subject, from_name, from_addr, at::text as at, preview, state, status, days, mailbox_id from feed where ${where} order by at desc nulls last, key limit ${PER_PAGE} offset ${(pg - 1) * PER_PAGE}`, [...args, label, like]);
  return { counts: counts ?? { inbox: 0, urgent: 0, followup: 0, replied: 0, ignored: 0, dispatch: 0 }, items, total: tot?.n ?? 0, page: pg, pages };
}

export type TrackerMail = { state: string; row_no: number; subject: string | null; gmail_url: string | null; from_name: string | null; from_email: string | null; received_at: string | null; days: string | null; status: string | null; remarks: string | null; thread_id: string | null; moved_at: string | null; marked_done: boolean; no_reply: boolean };
export async function trackerMail(key: string): Promise<TrackerMail | null> {
  const m = /^t:(Pending|Done|Ignored):(\d+)$/.exec(key);
  if (!m) return null;
  return (await q<TrackerMail>(
    `select state, row_no, subject, gmail_url, from_name, from_email, received_at::text, days::text, status, remarks, thread_id, moved_at::text, marked_done, no_reply from public.v_mail_inbox where state = $1 and row_no = $2`, [m[1], Number(m[2])]))[0] ?? null;
}
