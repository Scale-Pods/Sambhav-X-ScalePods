import "server-only";
import { q, qTx } from "./db";
import { parseFilter, todayIST, type Filter } from "./filters";
import { W, list, type Page } from "./payments";

// Orders and dispatch, read from the typed views over the synced Google Sheets (migrations 21-23).

export type Company = "SPF" | "SAI" | null;
export type OrderParams = { company: Company; f: Filter; q: string; page: number; show: string; plot: string; all?: boolean };

export function readOrderParams(sp: Record<string, string | string[] | undefined>): OrderParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const c = one(sp.entity);
  return {
    company: c === "SPF" || c === "SAI" ? c : null,
    f: parseFilter(sp as Record<string, string | undefined>, "fy"),
    q: (one(sp.q) ?? "").trim().slice(0, 80),
    page: Math.max(1, Number(one(sp.page)) || 1),
    show: one(sp.show) ?? "all",
    plot: one(sp.plot) === "753" || one(sp.plot) === "D15" ? (one(sp.plot) as string) : "all",
  };
}

const n = (v: string | number | null | undefined) => Number(v ?? 0);
const sfx = (c: number) => `${c} order${c === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- orders
export type OrderRow = {
  order_no: string; order_no_num: number | null; company: string | null; salesperson: string | null; po_no: string | null; client: string | null; delivery_location: string | null;
  order_date: string | null; etd: string | null; po_url: string | null; lines: string; done_lines: string; status: string; grades: string | null; material: string | null;
  transporters: string | null; vehicles: string | null; has_testing: boolean | null;
};

function orderWhere(p: OrderParams, withPeriod = true) {
  const w = new W();
  if (p.company) w.and(`company like ${w.p("%" + p.company + "%")}`);
  if (withPeriod) w.range("order_date", p.f);
  w.search(p.q, ["order_no", "client", "po_no", "salesperson", "grades", "vehicles", "transporters", "delivery_location"]);
  return w;
}

export function ordersList(p: OrderParams): Promise<Page<OrderRow>> {
  const w = orderWhere(p);
  if (p.show === "open") w.and("status = 'Open'");
  if (p.show === "complete") w.and("status = 'Complete'");
  if (p.show === "late") w.and(`status = 'Open' and etd < ${w.p(todayIST())}::date`);
  return list<OrderRow>("v_orders", w, "order_no_num desc nulls last, order_no desc", p, "lines");
}

export async function orderDetail(no: string) {
  const [o, lines] = await Promise.all([
    q<OrderRow>(`select * from public.v_orders where order_no = $1`, [no]),
    q<Record<string, string | boolean | null>>(`select * from public.v_order_lines where order_no = $1 order by case when sr_no ~ '^[0-9]+$' then sr_no::int end nulls last, row_no`, [no]),
  ]);
  return { order: o[0] ?? null, lines };
}

export async function orderOverview(p: OrderParams) {
  const today = todayIST();
  const mk = (period = true) => orderWhere({ ...p, q: "" }, period);
  const lineW = () => { const w = new W(); if (p.company) w.and(`company = ${w.p(p.company)}`); w.range("order_date", p.f); return w; };
  const openW = mk(false); const lateFrom = openW.p(today);

  const [inPeriod, open, monthly, topClients, bySales, grades, material, transport, openOldest] = await qTx((q) => {
    const run = <T,>(sql: (w: W) => string, w: W) => q<T>(sql(w), w.params);
    return Promise.all([
    run<{ n: string; done: string; lines: string }>((w) => `select count(*) n, count(*) filter (where status = 'Complete') done, coalesce(sum(lines),0) lines from public.v_orders where ${w.sql}`, mk()),
    run<{ n: string; lines: string; late: string; open_lines: string }>((w) =>
      `select count(*) filter (where status = 'Open') n, coalesce(sum(lines - done_lines) filter (where status = 'Open'),0) open_lines,
              count(*) filter (where status = 'Open' and etd < ${lateFrom}::date) late, 0 lines from public.v_orders where ${w.sql}`, openW),
    run<{ m: string; spf: string; sai: string }>((w) =>
      `select to_char(date_trunc('month', order_date), 'YYYY-MM-DD') m, count(*) filter (where company like '%SPF%') spf, count(*) filter (where company like '%SAI%') sai
       from public.v_orders where ${w.sql} and order_date is not null group by 1 order by 1`, mk()),
    run<{ label: string; v: string; n: string }>((w) =>
      `select max(coalesce(client, '(no name)')) label, count(*) v, coalesce(sum(lines),0) n from public.v_orders where ${w.sql} group by btrim(regexp_replace(regexp_replace(upper(coalesce(client, '')), '\m(PRIVATE|PVT|LIMITED|LTD|LLP|CO)\M', '', 'g'), '[^A-Z0-9]+', ' ', 'g')) order by 2 desc, 3 desc limit 10`, mk()),
    run<{ label: string; v: string; n: string }>((w) =>
      `select coalesce(initcap(lower(split_part(btrim(salesperson), ' ', 1))), '(none)') label, count(*) v, coalesce(sum(lines),0) n from public.v_orders where ${w.sql} group by 1 order by 2 desc`, mk()),
    run<{ label: string; v: string }>((w) =>
      `select g label, count(*) v from (select unnest(string_to_array(grades, ', ')) g from public.v_orders where ${w.sql}) t where g is not null group by 1 order by 2 desc limit 10`, mk()),
    run<{ label: string; v: string }>((w) =>
      `select coalesce(material, '(not stated)') label, count(*) v from public.v_order_lines where ${w.sql} group by 1 order by 2 desc`, lineW()),
    run<{ label: string; v: string }>((w) =>
      `select t label, count(*) v from (select unnest(string_to_array(transporters, ', ')) t from public.v_orders where ${w.sql}) x where t is not null and upper(btrim(t)) not in ('NA','N/A','NO','PENDING','-','') group by 1 order by 2 desc limit 8`, mk()),
    run<{ order_no: string; client: string | null; order_date: string | null; etd: string | null; lines: string; done_lines: string; salesperson: string | null }>((w) =>
      `select order_no, client, order_date, etd, lines, done_lines, salesperson from public.v_orders where ${w.sql} and status = 'Open' order by etd asc nulls last, order_no_num desc limit 12`, mk(false)),
  ]);
  });
  return {
    period: { n: n(inPeriod[0].n), done: n(inPeriod[0].done), lines: n(inPeriod[0].lines) },
    open: { n: n(open[0].n), late: n(open[0].late), lines: n(open[0].open_lines) },
    monthly: monthly.map((m) => ({ k: m.m, spf: n(m.spf), sai: n(m.sai) })),
    topClients: topClients.map((r) => ({ label: r.label, value: n(r.v), extra: `${n(r.n)} lines` })),
    bySales: bySales.map((r) => ({ label: r.label, value: n(r.v), extra: `${n(r.n)} lines` })),
    grades: grades.map((r) => ({ label: r.label, value: n(r.v), extra: sfx(n(r.v)) })),
    material: material.map((r) => ({ label: r.label, value: n(r.v) })),
    transport: transport.map((r) => ({ label: r.label, value: n(r.v), extra: sfx(n(r.v)) })),
    openOldest,
  };
}

// ---------------------------------------------------------------- vehicle / outward register
export type TripRow = { month_tab: string; row_no: number; plot: string; vehicle_no: string | null; grade: string | null; dispatch_date: string | null; invoice_no: string | null; weight_kg: string | null; entity: string | null };

function tripWhere(p: OrderParams, search = true) {
  const w = new W();
  if (p.company) w.and(`entity ilike ${w.p(p.company === "SAI" ? "SAI%" : "SPF%")}`);
  if (p.plot !== "all") w.and(`plot = ${w.p(p.plot)}`);
  w.range("dispatch_date", p.f);
  if (search) w.search(p.q, ["vehicle_no", "grade", "invoice_no", "entity"]);
  return w;
}

export function tripsList(p: OrderParams): Promise<Page<TripRow>> {
  return list<TripRow>("v_vehicle_register", tripWhere(p), "dispatch_date desc nulls last, row_no desc", p, "weight_kg");
}

export async function vehiclesOverview(p: OrderParams) {
  const w = () => tripWhere({ ...p, q: "" }, false);
  const [tot, monthly, byEntity, byGrade, typed, undated] = await qTx((q) => {
    const run = <T,>(sql: (w: W) => string) => { const x = w(); return q<T>(sql(x), x.params); };
    return Promise.all([
    run<{ trips: string; kg: string }>((x) => `select count(*) trips, coalesce(sum(weight_kg),0) kg from public.v_vehicle_register where ${x.sql}`),
    run<{ m: string; p753: string; d15: string }>((x) =>
      `select to_char(date_trunc('month', dispatch_date), 'YYYY-MM-DD') m, coalesce(sum(weight_kg) filter (where plot = '753'),0) p753, coalesce(sum(weight_kg) filter (where plot = 'D15'),0) d15
       from public.v_vehicle_register where ${x.sql} and dispatch_date is not null group by 1 order by 1`),
    run<{ label: string; kg: string; n: string }>((x) =>
      `select coalesce(entity, '(not stated)') label, coalesce(sum(weight_kg),0) kg, count(*) n from public.v_vehicle_register where ${x.sql} group by 1 order by 2 desc`),
    run<{ label: string; kg: string; n: string }>((x) =>
      `select coalesce(case when upper(regexp_replace(grade, '\\s+', '', 'g')) ~ '^[0-9]+$' then 'GR' || upper(regexp_replace(grade, '\\s+', '', 'g')) else upper(regexp_replace(grade, '\\s+', '', 'g')) end, '(not stated)') label, coalesce(sum(weight_kg),0) kg, count(*) n from public.v_vehicle_register where ${x.sql} group by 1 order by 2 desc limit 10`),
    q<{ cells: string[] }>(`select cells from public.sheet_rows where source_key = 'dispatch_26_27' and tab = '26-27' and row_no between 2 and 13 and deleted_at is null order by row_no`),
    q<{ n: string }>(`select count(*) n from public.v_vehicle_register where dispatch_date is null`),
  ]);
  });
  const num = (t: string | undefined) => Number(String(t ?? "").replace(/[^0-9.\-]/g, "")) || 0;
  return {
    trips: n(tot[0].trips), kg: n(tot[0].kg),
    monthly: monthly.map((m) => ({ k: m.m, p753: n(m.p753), d15: n(m.d15) })),
    byEntity: byEntity.map((r) => ({ label: r.label, kg: n(r.kg), n: n(r.n) })),
    byGrade: byGrade.map((r) => ({ label: r.label, kg: n(r.kg), n: n(r.n) })),
    typed: typed.filter((r) => r.cells[0] && num(r.cells[3])).map((r) => ({ month: r.cells[0], p753: num(r.cells[1]), d15: num(r.cells[2]), total: num(r.cells[3]), rs: num(r.cells[4]) })),
    undated: n(undated[0].n),
  };
}
