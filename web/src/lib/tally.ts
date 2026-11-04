import "server-only";
import { q } from "./db";
import { PAGE_SIZE, W } from "./payments";

// Tally, read-only: what the connector on the Tally PC has sent (tables tally_*). Balances are debit-positive.
// Two Tally companies are read: Sambhav Pipes & Fittings (SPF) and Sai Steel & Engineering (SAI). Every screen shows one of them (the "entity" choice in the address,
// SPF when none is given); each company's rows carry its own company id.

export type TallyEntity = "SPF" | "SAI";
export const readTallyEntity = (v: unknown): TallyEntity => (v === "SAI" ? "SAI" : "SPF");
/** The Tally company of one of our companies, as a piece of a question. The entity is one of two fixed words, so it is safe to write in. */
export const co = (e: TallyEntity) => `(select tc.id from public.tally_companies tc join public.entities en on en.id = tc.entity_id where en.code = '${e}' order by tc.last_sync_at desc nulls last, tc.created_at limit 1)`;

export type Status = {
  connector: { seen_min: number | null; ok_min: number | null; last_seen_at: string | null; last_status: string | null; last_message: string | null; last_version: string | null; last_sync_ok_at: string | null } | null;
  company: { tally_name: string; last_sync_at: string | null; last_status: string | null } | null;
  counts: { ledgers: number; stock_items: number; vouchers: number; last_voucher: string | null; first_voucher: string | null; receivable_bills: number; payable_bills: number; bills_as_of: string | null };
  runs: { started_at: string; finished_at: string | null; status: string; records_in: number | null; error: string | null; trigger_type: string }[];
  request: { status: string; requested_at: string; message: string | null } | null;
};

export async function tallyStatus(entity: TallyEntity = "SPF"): Promise<Status> {
  const CO = co(entity);
  // through a function that returns only the status fields: the connector table itself (it holds the key's hash) stays with the owner and administrators.
  // Until the function exists (migration 20261031100000) the table is read directly, which only the owner and administrators can do.
  const stateSql = `select seen_min, ok_min, last_seen_at, last_status, last_message, last_version, last_sync_ok_at from public.tally_connector_state()`;
  const tableSql = `select (extract(epoch from now() - last_seen_at) / 60)::int seen_min, (extract(epoch from now() - last_sync_ok_at) / 60)::int ok_min, last_seen_at, last_status, last_message, last_version, last_sync_ok_at from public.tally_connectors where active order by created_at limit 1`;
  const [connector] = await q<NonNullable<Status["connector"]>>(stateSql).catch(() => q<NonNullable<Status["connector"]>>(tableSql));
  const [company] = await q<NonNullable<Status["company"]>>(`select tally_name, last_sync_at, last_status from public.tally_companies where id = ${CO}`);
  const [c] = await q<Status["counts"]>(`
    select (select count(*) from public.tally_ledgers where company_id = ${CO} and deleted_at is null)::int ledgers,
           (select count(*) from public.tally_stock_items where company_id = ${CO})::int stock_items,
           (select count(*) from public.tally_vouchers where company_id = ${CO} and deleted_at is null)::int vouchers,
           (select max(voucher_date)::text from public.tally_vouchers where company_id = ${CO} and deleted_at is null) last_voucher,
           (select min(voucher_date)::text from public.tally_vouchers where company_id = ${CO} and deleted_at is null) first_voucher,
           (select count(*) from public.tally_outstanding_bills where company_id = ${CO} and kind = 'receivable')::int receivable_bills,
           (select count(*) from public.tally_outstanding_bills where company_id = ${CO} and kind = 'payable')::int payable_bills,
           (select max(as_of)::text from public.tally_outstanding_bills where company_id = ${CO}) bills_as_of`);
  const runs = await q<Status["runs"][number]>(`select started_at, finished_at, status, records_in, error, trigger_type from public.tally_sync_runs where company_id = ${CO} order by started_at desc limit 8`);
  const [request] = await q<NonNullable<Status["request"]>>(`select status, requested_at, message from public.tally_sync_requests order by requested_at desc limit 1`);
  return { connector: connector ?? null, company: company ?? null, counts: c, runs, request: request ?? null };
}

/**
 * What the Tally PC is doing right now, for the progress bar. "running" is a sync that has started (the connector reports its stage and percent at every
 * step); "waiting" is a "Sync now" request the PC has not picked up yet (it looks every 5 minutes). A run that has not reported for 3 hours is not shown as running.
 */
export type Live = { state: "idle" | "waiting" | "running"; pct: number; stage: string | null; detail: string | null; how: string | null; seconds: number };

export async function tallyLive(entity: TallyEntity = "SPF"): Promise<Live> {
  const CO = co(entity);
  const [run] = await q<{ stage: string | null; progress: number | null; detail: string | null; trigger_type: string; seconds: number }>(
    `select stage, progress, detail, trigger_type, extract(epoch from now() - started_at)::int seconds
       from public.tally_sync_runs where company_id = ${CO} and status = 'running' and coalesce(progress_at, started_at) > now() - interval '3 hours'
      order by started_at desc limit 1`);
  if (run) return { state: "running", pct: run.progress ?? 0, stage: run.stage, detail: run.detail, how: run.trigger_type, seconds: run.seconds };
  const [req] = await q<{ seconds: number }>(
    `select extract(epoch from now() - requested_at)::int seconds from public.tally_sync_requests where status in ('pending', 'running') and requested_at > now() - interval '1 day' order by requested_at desc limit 1`);
  if (req) return { state: "waiting", pct: 0, stage: null, detail: null, how: "manual", seconds: req.seconds };
  return { state: "idle", pct: 0, stage: null, detail: null, how: null, seconds: 0 };
}

// ---------------------------------------------------------------- parties (ledgers)
export const GROUPS: Record<string, string> = { debtors: "Sundry Debtors", goods: "SUNDRY CREDITORS (FOR GOODS)", expenses: "SUNDRY CREDITORS (FOR EXPENSES)" };

export type TallyParams = { q: string; page: number; show: string; group: string; entity: TallyEntity; all?: boolean; summaryOnly?: boolean };
export function readTallyParams(sp: Record<string, string | string[] | undefined>): TallyParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { q: (one(sp.q) ?? "").trim().slice(0, 80), page: Math.max(1, Number(one(sp.page)) || 1), show: one(sp.show) ?? "all", group: one(sp.group) ?? "all", entity: readTallyEntity(one(sp.entity)) };
}

export type PartyRow = { name: string; parent_group: string | null; gstin: string | null; state: string | null; balance: string | null; orders: string };
export async function partiesList(p: TallyParams) {
  const CO = co(p.entity);
  const w = new W();
  w.and(`l.company_id = ${CO}`); w.and("l.deleted_at is null");
  if (p.group in GROUPS) w.and(`l.parent_group = ${w.p(GROUPS[p.group])}`);
  else if (p.group === "other") w.and(`l.parent_group <> all(${w.p(Object.values(GROUPS))}::text[])`);
  if (p.show === "owing") w.and("l.closing_balance <> 0");
  if (p.show === "nogstin") w.and("l.gstin is null and l.parent_group in ('Sundry Debtors', 'SUNDRY CREDITORS (FOR GOODS)')");
  w.search(p.q, ["l.name", "l.gstin", "l.parent_group"]);
  const [s] = await q<{ n: string; debit: string | null; credit: string | null }>(
    `select count(*) n, sum(l.closing_balance) filter (where l.closing_balance > 0) debit, sum(-l.closing_balance) filter (where l.closing_balance < 0) credit from public.tally_ledgers l where ${w.sql}`, w.params);
  const total = Number(s.n), size = p.all ? 50000 : PAGE_SIZE, pages = Math.max(1, Math.ceil(total / size)), page = p.all ? 1 : Math.min(p.page, pages);
  const rows = await q<PartyRow>(
    `with oc as (select app.party_key(client) k, count(*) n from public.v_orders where client is not null group by 1)
     select l.name, l.parent_group, l.gstin, l.state, l.closing_balance::text balance, coalesce(oc.n, 0)::text orders
       from public.tally_ledgers l left join oc on oc.k = app.party_key(l.name)
      where ${w.sql} order by abs(l.closing_balance) desc nulls last, l.name limit ${size} offset ${(page - 1) * size}`, w.params);
  return { rows, total, page, pages, debit: Number(s.debit ?? 0), credit: Number(s.credit ?? 0) };
}

// ---------------------------------------------------------------- Tally against the sheets
export type CompareRow = { tally_name: string | null; sheet_name: string | null; tally: number; sheet: number; diff: number; bills: string | null; how: string; status: "same" | "differs" | "only_tally" | "only_sheet" };
export type CompareSummary = { tally_total: number; sheet_total: number; same: number; differs: number; only_tally: number; only_sheet: number };

/** kind: debtors (Tally "Sundry Debtors" against the sheet's receivables) or creditors (Tally creditors for goods against the sheet's payables). The sheet side is the same company's payment sheet (SPF or Sai). */
export async function compare(kind: "receivable" | "payable", p: TallyParams) {
  const CO = co(p.entity);
  const rec = kind === "receivable";
  const groups = rec ? [GROUPS.debtors] : p.group === "expenses" ? [GROUPS.expenses] : p.group === "both" ? [GROUPS.goods, GROUPS.expenses] : [GROUPS.goods];
  const sign = rec ? "" : "-";
  const view = rec ? "v_receivables" : "v_payables", col = rec ? "party" : "vendor";
  const base = `
    with t as (select app.party_key(name) k, min(name) name, sum(bal) bal
                 from (select name, ${sign}closing_balance bal from public.tally_ledgers where company_id = ${CO} and deleted_at is null and parent_group = any($1::text[])) x
                where bal <> 0 group by 1),
         s as (select app.party_key(${col}) k, min(${col}) name, sum(pending) amt, count(*) bills
                 from public.${view} where entity = '${p.entity}' and pending > 0 and ${col} is not null group by 1),
         ex as (select t.name tname, s.name sname, t.bal, s.amt, s.bills, 'same name' how from t join s on s.k = t.k),
         tl as (select * from t where k not in (select k from s)),
         sl as (select * from s where k not in (select k from t)),
         fz as (select distinct on (m.k) tl.name tname, m.name sname, tl.bal, m.amt, m.bills, 'similar name' how, tl.k tk, m.k sk
                  from tl join lateral (select * from sl order by similarity(sl.k, tl.k) desc limit 1) m on similarity(m.k, tl.k) >= 0.8
                 order by m.k, similarity(m.k, tl.k) desc),
         allr as (select tname, sname, bal, amt, bills, how from ex
                  union all select tname, sname, bal, amt, bills, how from fz
                  union all select name, null, bal, null, null, 'only in Tally' from tl where k not in (select tk from fz)
                  union all select null, name, null, amt, bills, 'only in the sheet' from sl where k not in (select sk from fz)),
         rows as (select tname tally_name, sname sheet_name, coalesce(bal, 0)::float8 tally, coalesce(amt, 0)::float8 sheet, (coalesce(bal, 0) - coalesce(amt, 0))::float8 diff,
                         bills::text bills, how,
                         case when tname is null then 'only_sheet' when sname is null then 'only_tally' when abs(coalesce(bal, 0) - coalesce(amt, 0)) < 1 then 'same' else 'differs' end status
                    from allr)`;
  // filters: the only parameter they carry is the search text, which is $2 (the group list is $1)
  const conds: string[] = [];
  const params: unknown[] = [groups];
  if (p.show === "differs") conds.push("status = 'differs'");
  else if (p.show === "only_tally") conds.push("status = 'only_tally'");
  else if (p.show === "only_sheet") conds.push("status = 'only_sheet'");
  else if (p.show === "same") conds.push("status = 'same'");
  else if (p.show === "gap") conds.push("status <> 'same'");
  if (p.q) {
    params.push(`%${p.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    conds.push("(coalesce(tally_name, '') ilike $2 or coalesce(sheet_name, '') ilike $2)");
  }
  const where = conds.length ? conds.join(" and ") : "true";
  const [sum] = await q<CompareSummary>(`${base}
    select coalesce(sum(tally), 0)::float8 tally_total, coalesce(sum(sheet), 0)::float8 sheet_total,
           count(*) filter (where status = 'same')::int same, count(*) filter (where status = 'differs')::int differs,
           count(*) filter (where status = 'only_tally')::int only_tally, count(*) filter (where status = 'only_sheet')::int only_sheet from rows`, [groups]);
  if (p.summaryOnly) return { rows: [] as CompareRow[], summary: sum, total: 0, page: 1, pages: 1 }; // the overview needs only the totals
  const size = p.all ? 50000 : PAGE_SIZE;
  const [cnt] = await q<{ n: string }>(`${base} select count(*) n from rows where ${where}`, params);
  const total = Number(cnt.n), pages = Math.max(1, Math.ceil(total / size)), page = p.all ? 1 : Math.min(p.page, pages);
  const rowsOut = await q<CompareRow>(`${base} select * from rows where ${where} order by abs(diff) desc, coalesce(tally_name, sheet_name) limit ${size} offset ${(page - 1) * size}`, params);
  return { rows: rowsOut, summary: sum, total, page, pages };
}
