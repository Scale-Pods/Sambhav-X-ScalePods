import "server-only";
import { q } from "./db";
import type { Read } from "./docreader/checks";

// Step 5 of the reading engine: put what was read next to what we already know. Reads only; it never changes anything.

export type GradeMatch = { line: number; raw: string; code: string | null; how: "list" | "close" | "none"; candidates: string[] };
export type OrderMatch = { order_no: string; client: string | null; po_no: string | null; order_date: string | null; status: string; matched_on: string };
export type CustomerMatch = { client: string; orders: number; last_order: string | null; score: number };
export type Matches = { grades: GradeMatch[]; orders: OrderMatch[]; customers: CustomerMatch[]; exactCustomer: boolean };

const NORM = "regexp_replace(upper(%s), '[^A-Z0-9]', '', 'g')";

export async function matchRead(r: Read): Promise<Matches> {
  // grades: the grade list and its spellings first, then the closest spelling
  const rawGrades = r.lines.map((l) => l.grade.trim());
  const gi = rawGrades.map((_, i) => i).filter((i) => rawGrades[i] !== "");
  const grades: GradeMatch[] = r.lines.map((_, i) => ({ line: i, raw: rawGrades[i], code: null, how: "none", candidates: [] }));
  if (gi.length) {
    const rows = await q<{ i: number; code: string | null; how: string; cands: string[] | null }>(
      `with x(i, raw) as (select * from unnest($1::int[], $2::text[]))
       select x.i, ex.code, case when ex.code is not null then 'list' else 'close' end as how,
              (select array_agg(code) from (select distinct code, s from (
                 select g.code, similarity(a.alias_norm, app.norm_text(x.raw)) s from public.grade_aliases a join public.grades g on g.id = a.grade_id
                  where a.alias_norm % app.norm_text(x.raw)) c order by s desc limit 3) t) as cands
       from x left join lateral (
         select g.code from public.grade_aliases a join public.grades g on g.id = a.grade_id where a.alias_norm = app.norm_text(x.raw)
         union all select g.code from public.grades g where app.norm_text(g.code) = app.norm_text(x.raw) limit 1) ex on true`,
      [gi, gi.map((i) => rawGrades[i])]);
    for (const row of rows) {
      const g = grades[row.i];
      g.code = row.code;
      g.candidates = [...new Set(row.cands ?? [])].filter((c) => c !== row.code);
      g.how = row.code ? "list" : g.candidates.length ? "close" : "none";
    }
  }

  // the same PO already in the sheets
  const refs = [r.po_number, r.document_number].map((s) => s.trim()).filter((s) => s.replace(/[^A-Za-z0-9]/g, "").length >= 3);
  const orders = refs.length
    ? await q<OrderMatch>(
        `select order_no, client, po_no, order_date::text, status, 'PO number' as matched_on from public.v_orders
          where ${NORM.replace("%s", "po_no")} = any(select ${NORM.replace("%s", "x")} from unnest($1::text[]) x) order by order_date desc nulls last limit 5`, [refs])
    : [];

  // customers we already deal with, by name
  const name = r.buyer_name.trim();
  const customers = name.length >= 3
    ? await q<CustomerMatch & { orders: string }>(
        `select client, count(*)::int as orders, max(order_date)::text as last_order, max(similarity(lower(client), lower($1)))::float8 as score
           from public.v_orders where client is not null and (lower(client) % lower($1)) group by client order by score desc, orders desc limit 3`, [name])
    : [];
  const exactCustomer = customers.some((c) => c.client.trim().toLowerCase() === name.toLowerCase());
  return { grades, orders, customers: customers.map((c) => ({ ...c, orders: Number(c.orders) })), exactCustomer };
}
