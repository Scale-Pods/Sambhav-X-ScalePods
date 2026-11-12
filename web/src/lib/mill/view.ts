import "server-only";
import { q } from "../db";
import { mailSources } from "../mailboxes";
import type { Consignment, DispatchRow } from "./dispatchTable";

export type Receipt = {
  id: string; status: "pending" | "approved" | "rejected"; rows: DispatchRow[]; consignments: Consignment[]; totals: { rows: number; pieces: number; tonnes: number; value: number }; warnings: string[];
  is_test: boolean; created_at: string; decided_at: string | null; note: string | null; decided_by: string | null;
  mail_id: string | null; mailbox_id: string | null; mailbox: string | null; subject: string | null; from_name: string | null; from_addr: string | null; received_at: string | null; source_kind: string | null;
};

const COLS = `r.id, r.status, r.rows, r.consignments, r.totals, r.warnings, r.is_test, r.created_at::text, r.decided_at::text, r.note, (select s.full_name from public.staff s where s.id = r.decided_by) decided_by,
       m.id mail_id, m.mailbox_id, null::text mailbox, m.subject, m.from_name, m.from_addr, m.received_at::text, m.source_kind`;

/** The dispatch suggestions, newest first with the waiting ones on top. `mailboxIds` null = every mailbox, [] = none. */
export async function receiptsList(mailboxIds: string[] | null, limit = 40): Promise<Receipt[]> {
  return withMailbox(await q<Receipt>(
    `select ${COLS} from public.mill_receipts r left join public.mill_mails m on m.id = r.message_id
      where ($1::uuid[] is null or m.mailbox_id = any($1::uuid[]))
      order by (r.status = 'pending') desc, coalesce(m.received_at, r.created_at) desc limit ${Math.max(1, Math.min(limit, 100))}`, [mailboxIds]));
}

export async function receiptOfMail(mailId: string): Promise<Receipt | null> {
  return (await withMailbox(await q<Receipt>(`select ${COLS} from public.mill_receipts r left join public.mill_mails m on m.id = r.message_id where m.id = $1::uuid`, [mailId])))[0] ?? null;
}

/** The address of the mailbox each mail came from (the mailbox list is read on the server, because the mailboxes table itself is only readable by its owner and administrators). */
async function withMailbox(rows: Receipt[]): Promise<Receipt[]> {
  const names = new Map((await mailSources()).filter((s) => s.id).map((s) => [s.id as string, s.address]));
  return rows.map((r) => ({ ...r, mailbox: r.mailbox_id ? names.get(r.mailbox_id) ?? null : null }));
}

export type DispatchContext = { gradeOf: Map<string, string | null>; books: Set<string> };

/** What would stop an approval: a grade the mill wrote that our list does not know, or a company that has no stock book yet. */
export async function dispatchContext(receipts: Receipt[]): Promise<DispatchContext> {
  const texts = [...new Set(receipts.filter((r) => r.status === "pending").flatMap((r) => r.rows.map((x) => x.grade_text ?? "")).filter(Boolean))];
  const grades = texts.length
    ? await q<{ txt: string; code: string | null }>(
        `select t.txt, g.code from unnest($1::text[]) t(txt)
           left join lateral (select a.grade_id from public.grade_aliases a where translate(a.alias_norm, 'O', '0') = translate(app.norm_text(t.txt), 'O', '0') limit 1) x on true
           left join public.grades g on g.id = x.grade_id`, [texts])
    : [];
  const books = new Set((await q<{ code: string }>(`select distinct e.code from public.stock_books b join public.entities e on e.id = b.owner_entity_id`)).map((b) => b.code));
  return { gradeOf: new Map(grades.map((g) => [g.txt, g.code])), books };
}

export function blockerOf(r: Receipt, c: DispatchContext): string | null {
  const unknown = [...new Set(r.rows.filter((x) => x.grade_text && !c.gradeOf.get(x.grade_text)).map((x) => x.grade_text as string))];
  const noBook = [...new Set(r.rows.map((x) => x.entity).filter((e): e is "SPF" | "SAI" => e != null && !c.books.has(e)))];
  if (unknown.length) return `The grade ${unknown.map((g) => `"${g}"`).join(", ")} is not in the grade list yet. Add it as a name of the right grade first.`;
  if (noBook.length) return `There is no stock book for ${noBook.join(", ")} yet, so these plates cannot be added.`;
  return null;
}
