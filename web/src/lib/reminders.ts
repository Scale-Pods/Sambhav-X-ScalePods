import "server-only";
import { q, serviceQuery } from "./db";
import { todayIST } from "./filters";
import { SOON_DAYS, type RemRow } from "./reminderMail";

// What a payment reminder is made from: the customer's unpaid invoices in the Debtors list (from the Payment Better sheets), split into those past their due
// date and those falling due in the next few days. Today's date is the Indian date.

export type Debtor = { party: string; entity: "SPF" | "SAI"; invoices: number; pending: number; oldest_days: number };

const ymd = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const daysBetween = (a: string, b: string) => Math.round((ymd(a) - ymd(b)) / 86400000);

/** Customers with at least one unpaid invoice past its due date, biggest amount first. */
export async function overdueDebtors(entity: "SPF" | "SAI" | null): Promise<Debtor[]> {
  const today = todayIST();
  const rows = await q<{ party: string; entity: string; n: string; pend: string; oldest: string }>(
    `select party, entity, count(*) n, sum(pending) pend, min(due_date)::text oldest
     from public.v_receivables where pending > 0 and due_date is not null and due_date < $1::date and coalesce(party, '') <> '' and ($2::text is null or entity = $2)
     group by party, entity order by sum(pending) desc`, [today, entity]);
  return rows.map((r) => ({ party: r.party, entity: r.entity === "SAI" ? "SAI" : "SPF", invoices: Number(r.n), pending: Number(r.pend), oldest_days: daysBetween(today, r.oldest) }));
}

/** The invoices of one customer, split into overdue and falling due soon. */
export async function reminderRows(party: string, entity: "SPF" | "SAI"): Promise<{ asOf: string; overdue: RemRow[]; soon: RemRow[] }> {
  const asOf = todayIST();
  const rows = await q<{ po_no: string | null; invoice_no: string | null; invoice_date: string | null; due_date: string | null; amount: string | null; received: string | null; pending: string }>(
    `select po_no, invoice_no, invoice_date::text, due_date::text, amount, received, pending from public.v_receivables
     where party = $1 and entity = $2 and pending > 0 and due_date is not null order by invoice_date nulls last, invoice_no`, [party, entity]);
  const overdue: RemRow[] = [], soon: RemRow[] = [];
  for (const r of rows) {
    const late = daysBetween(asOf, r.due_date!);
    const base = { po: r.po_no ?? "", invoice: r.invoice_no ?? "", invoiceDate: r.invoice_date, dueDate: r.due_date, value: Number(r.amount ?? 0), received: Number(r.received ?? 0), balance: Number(r.pending) };
    if (late > 0) overdue.push({ ...base, days: late });
    else if (-late <= SOON_DAYS && -late >= 0) soon.push({ ...base, days: Math.max(1, -late) });
  }
  soon.sort((a, b) => a.days - b.days);
  return { asOf, overdue, soon };
}

const SKIP = new Set(["pvt", "ltd", "limited", "private", "india", "indian", "the", "and", "co", "corp", "corporation", "industries", "industrial", "steel", "steels", "engineering", "enterprises", "enterprise", "associates", "services", "solution", "solutions", "technology", "technologies", "power", "shree", "sri"]);

/** Addresses from the Email Tracker's Client Master whose domain looks like the customer's name (a hint only: the person decides who the mail goes to). */
export async function contactHints(party: string): Promise<{ name: string; email: string }[]> {
  const words = party.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SKIP.has(w));
  const key = words[0];
  if (!key) return [];
  const like = `%${key.replace(/[\\%_]/g, "")}%`;
  return q<{ name: string; email: string }>(
    `select distinct on (lower(cells->>1)) cells->>0 name, cells->>1 email from public.sheet_rows
     where source_key = 'email_tracker' and tab = 'Client Master' and deleted_at is null and row_no > 1 and cells->>1 like '%@%' and split_part(lower(cells->>1), '@', 2) like $1
     order by lower(cells->>1) limit 10`, [like]);
}

// ---------------------------------------------------------------- the memory of reminders: who a customer's reminder goes to, and what was already sent
// (tables customer_contacts and payment_reminders; until they exist every function below answers "nothing yet" and the pages keep working)

export type Contact = { to: string; cc: string; replySubject: string };
export type Sent = { at: string; total: number; count: number; tone: "statement" | "firm"; by: string | null };
export type ReminderMeta = { party: string; entity: "SPF" | "SAI"; invoices: string[]; total: number; count: number; oldest: number; tone: "statement" | "firm" };

export async function contactOf(party: string): Promise<Contact> {
  try {
    const [r] = await q<{ to_emails: string; cc_emails: string; reply_subject: string }>(`select to_emails, cc_emails, reply_subject from public.customer_contacts where lower(btrim(party)) = lower(btrim($1))`, [party]);
    return r ? { to: r.to_emails, cc: r.cc_emails, replySubject: r.reply_subject } : { to: "", cc: "", replySubject: "" };
  } catch { return { to: "", cc: "", replySubject: "" }; }
}

export async function historyOf(party: string): Promise<Sent[]> {
  try {
    return (await q<{ at: string; total: string; n: number; tone: "statement" | "firm"; by: string | null }>(
      `select r.sent_at::text at, r.total_pending total, r.overdue_count n, r.tone, s.full_name by from public.payment_reminders r left join public.staff s on s.id = r.sent_by
       where lower(btrim(r.party)) = lower(btrim($1)) order by r.sent_at desc limit 12`, [party])).map((r) => ({ at: r.at, total: Number(r.total), count: r.n, tone: r.tone, by: r.by }));
  } catch { return []; }
}

/** How many reminders were sent to each customer and when the last one went (the key is the customer's name in lower case). */
export async function historySummary(): Promise<Map<string, { n: number; last: string }>> {
  try {
    const rows = await q<{ k: string; n: string; last: string }>(`select lower(btrim(party)) k, count(*) n, max(sent_at)::text last from public.payment_reminders group by 1`);
    return new Map(rows.map((r) => [r.k, { n: Number(r.n), last: r.last }]));
  } catch { return new Map(); }
}

/** After a reminder has been sent: remember it, and remember who it went to and which conversation it was sent into. Never makes the sending fail. */
export async function recordReminder(m: ReminderMeta, o: { mailboxId: string; to: string; cc: string; subject: string; messageId: string | null; threadId: string | null; staffId: string }): Promise<void> {
  try {
    await serviceQuery(
      `insert into public.payment_reminders (party, entity, mailbox_id, to_emails, cc_emails, subject, invoice_nos, overdue_count, total_pending, oldest_days, tone, gmail_message_id, gmail_thread_id, sent_by)
       values ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14)`,
      [m.party, m.entity, o.mailboxId, o.to, o.cc, o.subject, m.invoices, m.count, m.total, m.oldest, m.tone, o.messageId, o.threadId, o.staffId]);
    const re = /\bRe:\s.*$/i.exec(o.subject)?.[0] ?? "";
    await serviceQuery(
      `insert into public.customer_contacts (party, to_emails, cc_emails, reply_subject, updated_by) values ($1,$2,$3,$4,$5)
       on conflict ((lower(btrim(party)))) do update set to_emails = excluded.to_emails, cc_emails = excluded.cc_emails, reply_subject = case when excluded.reply_subject <> '' then excluded.reply_subject else public.customer_contacts.reply_subject end, updated_by = excluded.updated_by, updated_at = now()`,
      [m.party, o.to, o.cc, re, o.staffId]);
  } catch { /* the mail has gone; the memory can be missing until the tables exist */ }
}
