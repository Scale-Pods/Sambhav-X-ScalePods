import "server-only";
import { q } from "./db";
import { parseFilter, todayIST, type Filter } from "./filters";

// Invoices and payments, read from the typed views over the synced Google Sheets (see migration 19).
// Sales invoices count each invoice number once: the forms were sometimes submitted twice (entry_no > 1 is the repeat).

export type Entity = "SPF" | "SAI" | null;
export type PayParams = { entity: Entity; f: Filter; q: string; page: number; show: string; all?: boolean };

export const PAGE_SIZE = 100;

export function readPayParams(sp: Record<string, string | string[] | undefined>): PayParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const entity = one(sp.entity);
  return {
    entity: entity === "SPF" || entity === "SAI" ? entity : null,
    f: parseFilter(sp as Record<string, string | undefined>, "fy"),
    q: (one(sp.q) ?? "").trim().slice(0, 80),
    page: Math.max(1, Number(one(sp.page)) || 1),
    show: one(sp.show) ?? "all",
  };
}

class W {
  params: unknown[] = [];
  parts: string[] = [];
  p(v: unknown) { this.params.push(v); return `$${this.params.length}`; }
  and(c: string) { this.parts.push(c); }
  get sql() { return this.parts.length ? this.parts.join(" and ") : "true"; }
  entity(e: Entity, col = "entity") { if (e) this.and(`${col} = ${this.p(e)}`); }
  range(col: string, f: Filter) {
    if (f.from) this.and(`${col} >= ${this.p(f.from)}::date`);
    if (f.to) this.and(`${col} <= ${this.p(f.to)}::date`);
  }
  search(text: string, cols: string[]) {
    if (!text) return;
    const like = `%${text.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    const ph = this.p(like);
    this.and("(" + cols.map((c) => `${c} ilike ${ph}`).join(" or ") + ")");
  }
}

// ---------------------------------------------------------------- lists
type Page<T> = { rows: T[]; total: number; sum: number; page: number; pages: number };

async function list<T>(view: string, w: W, order: string, pp: PayParams, sumCol: string): Promise<Page<T>> {
  const [stats] = await q<{ n: string; s: string | null }>(`select count(*) n, sum(${sumCol}) s from public.${view} where ${w.sql}`, w.params);
  const total = Number(stats.n);
  const size = pp.all ? 50000 : PAGE_SIZE; // "all" is for the CSV download
  const pages = Math.max(1, Math.ceil(total / size));
  const page = pp.all ? 1 : Math.min(pp.page, pages);
  const rows = await q<T>(`select * from public.${view} where ${w.sql} order by ${order} limit ${size} offset ${(page - 1) * size}`, w.params);
  return { rows, total, sum: Number(stats.s ?? 0), page, pages };
}

export type SalesRow = { entity: string; row_no: number; invoice_no: string | null; invoice_date: string | null; client: string | null; salesperson: string | null; po_no: string | null; credit_days: string | null; amount: string | null; due_date: string | null; made_by: string | null; checked_by: string | null; transporter: string | null; entries: string; fy_mismatch: boolean | null };
export function salesList(p: PayParams) {
  const w = new W(); w.entity(p.entity); w.and("entry_no = 1"); w.range("invoice_date", p.f); w.search(p.q, ["invoice_no", "client", "po_no", "salesperson", "transporter"]);
  return list<SalesRow>("v_sales_invoices", w, "invoice_date desc nulls last, row_no desc", p, "amount");
}

export type PurchaseRow = { entity: string; row_no: number; invoice_no: string | null; invoice_date: string | null; vendor: string | null; credit_days: string | null; amount: string | null; due_date: string | null; checked_by: string | null; broker: string | null; purchased_by: string | null; purchased_for: string | null; file_url: string | null; weight: string | null; rate: string | null; unit: string | null; tds: string | null; entries: string };
export function purchasesList(p: PayParams) {
  const w = new W(); w.entity(p.entity); w.and("entry_no = 1"); w.range("invoice_date", p.f); w.search(p.q, ["invoice_no", "vendor", "broker", "purchased_for", "purchased_by"]);
  return list<PurchaseRow>("v_purchase_invoices", w, "invoice_date desc nulls last, row_no desc", p, "amount");
}

export type ExpenseRow = { entity: string; row_no: number; category: string | null; invoice_no: string | null; invoice_date: string | null; vendor: string | null; amount: string | null; tds: string | null; checked_by: string | null; file_url: string | null };
export function expensesList(p: PayParams) {
  const w = new W(); w.entity(p.entity); w.range("coalesce(invoice_date, entered_at::date)", p.f); w.search(p.q, ["category", "vendor", "invoice_no"]);
  return list<ExpenseRow>("v_expenses", w, "coalesce(invoice_date, entered_at::date) desc nulls last, row_no desc", p, "amount");
}

export type ReceivableRow = { entity: string; row_no: number; kind: string | null; salesperson: string | null; po_no: string | null; invoice_no: string | null; invoice_date: string | null; credit_days: string | null; due_date: string | null; party: string | null; amount: string | null; received: string | null; pending: string | null; overdue_days: string | null };
export function receivablesList(p: PayParams) {
  const w = new W(); w.entity(p.entity); w.search(p.q, ["party", "invoice_no", "po_no", "salesperson"]);
  if (p.show === "overdue") w.and("overdue_days > 0 and pending > 0");
  if (p.show === "blocked") w.and("kind = 'Blocked'");
  if (p.show === "open") w.and("pending > 0");
  return list<ReceivableRow>("v_receivables", w, "pending desc nulls last", p, "pending");
}

export type PayableRow = { entity: string; row_no: number; checked: boolean; invoice_no: string | null; invoice_date: string | null; file_url: string | null; buyer: string | null; purchased_for: string | null; credit_days: string | null; due_date: string | null; broker: string | null; vendor: string | null; amount: string | null; advance: string | null; tds: string | null; pending: string | null; remark: string | null; overdue_days: string | null };
export function payablesList(p: PayParams) {
  const w = new W(); w.entity(p.entity); w.search(p.q, ["vendor", "invoice_no", "broker", "purchased_for"]);
  if (p.show === "overdue") w.and("overdue_days > 0 and pending > 0");
  if (p.show === "open") w.and("pending > 0");
  return list<PayableRow>("v_payables", w, "pending desc nulls last", p, "pending");
}

export type GpayRow = { row_no: number; entered_at: string | null; description: string | null; for_whom: string | null; amount: string | null; paid_by: string | null; file_url: string | null };
export function gpayList(p: PayParams) {
  const w = new W(); w.range("entered_at::date", p.f); w.search(p.q, ["description", "for_whom", "paid_by"]);
  return list<GpayRow>("v_gpay_payments", w, "entered_at desc nulls last, row_no desc", p, "amount");
}
export type PettyRow = { row_no: number; entered_at: string | null; who: string | null; what: string | null; amount: string | null; file_url: string | null };
export function pettyList(p: PayParams) {
  const w = new W(); w.range("entered_at::date", p.f); w.search(p.q, ["who", "what"]);
  return list<PettyRow>("v_petty_expenses", w, "entered_at desc nulls last, row_no desc", p, "amount");
}
export type BrokerageRow = { entity: string; row_no: number; entry_date: string | null; party: string | null; broker: string | null; weight: string | null; rate: string | null; unit: string | null; basic_amount: string | null };
export function brokerageList(p: PayParams) {
  const w = new W(); w.entity(p.entity); w.range("entry_date", p.f); w.search(p.q, ["party", "broker"]);
  return list<BrokerageRow>("v_brokerage", w, "entry_date desc nulls last, row_no desc", p, "basic_amount");
}

// ---------------------------------------------------------------- overview
const n = (v: string | number | null | undefined) => Number(v ?? 0);

export async function payOverview(p: PayParams) {
  const today = todayIST();
  // a fresh filter per query: each one carries its own parameter list
  const mk = (build?: (w: W) => void) => { const w = new W(); w.entity(p.entity); build?.(w); return w; };
  const sales = mk((w) => { w.and("entry_no = 1"); w.range("invoice_date", p.f); });
  const purchases = mk((w) => { w.and("entry_no = 1"); w.range("invoice_date", p.f); });
  const exp = mk((w) => w.range("coalesce(invoice_date, entered_at::date)", p.f));
  const monthlyW = () => mk((w) => { w.and("entry_no = 1"); w.range("invoice_date", p.f); w.and("invoice_date is not null"); });
  const run = <T,>(sql: (w: W) => string, w: W) => q<T>(sql(w), w.params);

  const recW = mk(); const dueSoonFrom = recW.p(today);
  const [salesT, purchT, expT, rec, pay, monthly, topDebtors, byPerson, ageing, topCreditors, expByCat, typed, dups, undated] = await Promise.all([
    run<{ n: string; s: string }>((w) => `select count(*) n, coalesce(sum(amount),0) s from public.v_sales_invoices where ${w.sql}`, sales),
    run<{ n: string; s: string }>((w) => `select count(*) n, coalesce(sum(amount),0) s from public.v_purchase_invoices where ${w.sql}`, purchases),
    run<{ n: string; s: string }>((w) => `select count(*) n, coalesce(sum(amount),0) s from public.v_expenses where ${w.sql}`, exp),
    run<{ n: string; total: string; overdue: string; blocked: string; due_soon: string }>((w) =>
      `select count(*) filter (where pending > 0) n, coalesce(sum(pending),0) total,
              coalesce(sum(pending) filter (where overdue_days > 0),0) overdue, coalesce(sum(pending) filter (where kind = 'Blocked'),0) blocked,
              coalesce(sum(pending) filter (where due_date between ${dueSoonFrom}::date and ${dueSoonFrom}::date + 7),0) due_soon
       from public.v_receivables where ${w.sql}`, recW),
    run<{ n: string; total: string; overdue: string }>((w) =>
      `select count(*) filter (where pending > 0) n, coalesce(sum(pending),0) total, coalesce(sum(pending) filter (where overdue_days > 0),0) overdue
       from public.v_payables where ${w.sql}`, mk()),
    (() => { const a = monthlyW(); return q<{ m: string; sales: string | null; purchases: string | null }>(
      `with s as (select date_trunc('month', invoice_date)::date m, sum(amount) amt from public.v_sales_invoices where ${a.sql} group by 1),
            pu as (select date_trunc('month', invoice_date)::date m, sum(amount) amt from public.v_purchase_invoices where ${a.sql} group by 1)
       select to_char(coalesce(s.m, pu.m), 'YYYY-MM-DD') m, s.amt sales, pu.amt purchases from s full join pu on pu.m = s.m order by 1`, a.params); })(),
    run<{ label: string; v: string; n: string }>((w) =>
      `select coalesce(party, '(no name)') label, sum(pending) v, count(*) n from public.v_receivables where ${w.sql} and pending > 0 group by 1 order by 2 desc limit 10`, mk()),
    run<{ label: string; v: string; n: string }>((w) =>
      `select coalesce(initcap(lower(btrim(salesperson))), '(none)') label, sum(pending) v, count(*) n from public.v_receivables where ${w.sql} and pending > 0 group by 1 order by 2 desc`, mk()),
    run<{ band: string; ord: number; v: string; n: string }>((w) =>
      `select case when overdue_days = 0 then 'Not yet due' when overdue_days <= 30 then '1–30 days late' when overdue_days <= 60 then '31–60 days late' when overdue_days <= 90 then '61–90 days late' else 'Over 90 days late' end band,
              case when overdue_days = 0 then 1 when overdue_days <= 30 then 2 when overdue_days <= 60 then 3 when overdue_days <= 90 then 4 else 5 end ord,
              sum(pending) v, count(*) n
       from public.v_receivables where ${w.sql} and pending > 0 group by 1, 2 order by 2`, mk()),
    run<{ label: string; v: string; n: string }>((w) =>
      `select coalesce(vendor, '(no name)') label, sum(pending) v, count(*) n from public.v_payables where ${w.sql} and pending > 0 group by 1 order by 2 desc limit 10`, mk()),
    run<{ label: string; v: string; n: string }>((w) =>
      `select coalesce(category, '(none)') label, sum(amount) v, count(*) n from public.v_expenses where ${w.sql} group by 1 order by 2 desc limit 8`, exp),
    run<{ entity: string; particulars: string; amount: string }>((w) =>
      `select entity, particulars, amount from public.v_pay_summary where ${w.sql} and particulars ~* '^(total debtors|due debtors|blocked|total creditors|due creditors)'`, mk()),
    q<{ n: string }>(`select count(*) n from public.v_sales_invoices where entry_no > 1`),
    q<{ s: string; pu: string }>(`select (select count(*) from public.v_sales_invoices where invoice_date is null) s, (select count(*) from public.v_purchase_invoices where invoice_date is null) pu`),
  ]);

  const tp = (re: RegExp) => typed.filter((t) => re.test(t.particulars)).reduce((a, t) => a + n(t.amount), 0);
  return {
    sales: { n: n(salesT[0].n), s: n(salesT[0].s) }, purchases: { n: n(purchT[0].n), s: n(purchT[0].s) }, expenses: { n: n(expT[0].n), s: n(expT[0].s) },
    rec: { n: n(rec[0].n), total: n(rec[0].total), overdue: n(rec[0].overdue), blocked: n(rec[0].blocked), dueSoon: n(rec[0].due_soon) },
    pay: { n: n(pay[0].n), total: n(pay[0].total), overdue: n(pay[0].overdue) },
    monthly: monthly.map((m) => ({ k: m.m, sales: n(m.sales), purchases: n(m.purchases) })),
    topDebtors: topDebtors.map((r) => ({ label: r.label, value: n(r.v), extra: `${r.n} invoice${n(r.n) === 1 ? "" : "s"}` })),
    byPerson: byPerson.map((r) => ({ label: r.label, value: n(r.v), extra: `${r.n} invoice${n(r.n) === 1 ? "" : "s"}` })),
    ageing: ageing.map((r) => ({ label: r.band, value: n(r.v), count: n(r.n) })),
    topCreditors: topCreditors.map((r) => ({ label: r.label, value: n(r.v), extra: `${r.n} invoice${n(r.n) === 1 ? "" : "s"}` })),
    expByCat: expByCat.map((r) => ({ label: r.label, value: n(r.v), extra: `${r.n} bills` })),
    typed: { debtors: tp(/^total debtors/i), dueDebtors: tp(/^due debtors/i), creditors: tp(/^total creditors/i) },
    dupSales: n(dups[0].n), undatedSales: n(undated[0].s), undatedPurchases: n(undated[0].pu),
  };
}
