import "server-only";
import { q } from "./db";
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
