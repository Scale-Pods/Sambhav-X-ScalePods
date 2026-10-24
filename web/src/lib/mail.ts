import "server-only";
import { qTx } from "./db";
import { parseFilter, todayIST, type Filter, type Preset } from "./filters";
import { W, list, type Page } from "./payments";

// Mail, quotations and leads, read from the typed views over the synced Google Sheets (migration 24).

export type MailParams = { f: Filter; q: string; page: number; show: string; kind: string; state: string; grade: string; all?: boolean };

export function readMailParams(sp: Record<string, string | string[] | undefined>, fallback: Preset = "fy"): MailParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return {
    f: parseFilter(sp as Record<string, string | undefined>, fallback),
    q: (one(sp.q) ?? "").trim().slice(0, 80),
    page: Math.max(1, Number(one(sp.page)) || 1),
    show: one(sp.show) ?? "all",
    kind: one(sp.kind) ?? "all",
    state: one(sp.state) ?? "Pending",
    grade: one(sp.grade) ?? "all",
  };
}

const n = (v: string | number | null | undefined) => Number(v ?? 0);

// ---------------------------------------------------------------- inbox
export type InboxRow = { state: string; row_no: number; subject: string | null; gmail_url: string | null; from_name: string | null; from_email: string | null; received_at: string | null; days: string | null; status: string | null; remarks: string | null; no_reply: boolean };
export function inboxList(p: MailParams): Promise<Page<InboxRow>> {
  const w = new W();
  if (p.state !== "all") w.and(`state = ${w.p(p.state)}`);
  if (p.show !== "all") w.and(`status = ${w.p(p.show)}`);
  w.range("received_at::date", p.f);
  w.search(p.q, ["subject", "from_name", "from_email", "remarks"]);
  return list<InboxRow>("v_mail_inbox", w, "received_at desc nulls last, row_no desc", p, "1");
}

// ---------------------------------------------------------------- quotations
export type QuoteRow = { source_tab: string; row_no: number; priority: string | null; fu1: boolean; fu2: boolean; subject: string | null; gmail_url: string | null; quote_no: string | null; client_name: string | null; client_email: string | null; quoted_at: string | null; days: string | null; material: string | null; qty: string | null; price: string | null; status: string | null; order_value: string | null; remarks: string | null };
export function quotesList(p: MailParams): Promise<Page<QuoteRow>> {
  const w = new W();
  w.range("quoted_at::date", p.f);
  if (p.show === "followup") w.and("source_tab = 'Tracker' and not fu1 and days >= 3");
  if (p.show === "won") w.and("source_tab = 'Won'");
  if (p.show === "numbered") w.and("quote_no is not null");
  w.search(p.q, ["subject", "client_name", "client_email", "material", "quote_no"]);
  return list<QuoteRow>("v_quotations", w, "quoted_at desc nulls last, row_no desc", p, "1");
}

// ---------------------------------------------------------------- clients
export type ClientRow = { row_no: number; client_name: string | null; email: string | null; grade: string | null; enquiries: string; quotations: string; orders_won: string; pipeline_value: string; last_contact: string | null };
export function clientsList(p: MailParams): Promise<Page<ClientRow>> {
  const w = new W();
  if (p.grade !== "all") w.and(`grade = ${w.p(p.grade)}`);
  w.search(p.q, ["client_name", "email"]);
  return list<ClientRow>("v_mail_clients", w, "quotations desc, enquiries desc, client_name", p, "1");
}

// ---------------------------------------------------------------- leads
export type LeadRow = { row_no: number; query_id: string; query_kind: string; received_at: string | null; name: string | null; email: string | null; company: string | null; city: string | null; state: string | null; country: string | null; mobile: string | null; product: string | null; message: string | null };
export function leadsList(p: MailParams): Promise<Page<LeadRow>> {
  const w = new W();
  w.and("received_at is not null");
  w.range("received_at::date", p.f);
  if (p.kind !== "all") w.and(`query_kind = ${w.p(p.kind)}`);
  if (p.show !== "all") w.and(`state = ${w.p(p.show)}`);
  w.search(p.q, ["name", "company", "city", "state", "product", "mobile", "email", "message"]);
  return list<LeadRow>("v_leads", w, "received_at desc nulls last, row_no desc", p, "1");
}

// ---------------------------------------------------------------- overview
export async function mailOverview(f: Filter) {
  const today = todayIST();
  const mkQ = (col: string) => { const w = new W(); w.range(col, f); return w; };

  const [inbox, quotes, leads, leadsMonthly, quotesMonthly, leadStates, leadProducts, leadKinds, quoteMaterials, topClients, typed] = await qTx((q) => {
    const run = <T,>(sql: (w: W) => string, w: W) => q<T>(sql(w), w.params);
    return Promise.all([
    q<{ pending: string; urgent: string; follow: string; fresh: string; replied: string }>(
      `select count(*) filter (where state = 'Pending') pending, count(*) filter (where state = 'Pending' and status = 'URGENT') urgent,
              count(*) filter (where state = 'Pending' and status = 'Follow Up') follow, count(*) filter (where state = 'Pending' and status = 'New') fresh,
              count(*) filter (where state = 'Done') replied from public.v_mail_inbox`),
    run<{ n: string; followup: string; numbered: string; won: string }>((w) =>
      `select count(*) filter (where source_tab = 'Tracker') n, count(*) filter (where source_tab = 'Tracker' and not fu1 and days >= 3) followup,
              count(distinct quote_no) numbered, count(*) filter (where source_tab = 'Won') won from public.v_quotations where ${w.sql}`, mkQ("quoted_at::date")),
    run<{ n: string; buy: string }>((w) => `select count(*) n, count(*) filter (where query_type = 'B') buy from public.v_leads where received_at is not null and ${w.sql}`, mkQ("received_at::date")),
    run<{ m: string; v: string }>((w) => `select to_char(date_trunc('month', received_at), 'YYYY-MM-DD') m, count(*) v from public.v_leads where received_at is not null and ${w.sql} group by 1 order by 1`, mkQ("received_at::date")),
    run<{ m: string; v: string }>((w) => `select to_char(date_trunc('month', quoted_at), 'YYYY-MM-DD') m, count(*) v from public.v_quotations where quoted_at is not null and ${w.sql} group by 1 order by 1`, mkQ("quoted_at::date")),
    run<{ label: string; v: string }>((w) => `select coalesce(state, '(not stated)') label, count(*) v from public.v_leads where received_at is not null and ${w.sql} group by 1 order by 2 desc limit 10`, mkQ("received_at::date")),
    run<{ label: string; v: string }>((w) => `select initcap(lower(btrim(product))) label, count(*) v from public.v_leads where received_at is not null and product is not null and ${w.sql} group by 1 order by 2 desc limit 10`, mkQ("received_at::date")),
    run<{ label: string; v: string }>((w) => `select query_kind label, count(*) v from public.v_leads where received_at is not null and ${w.sql} group by 1 order by 2 desc`, mkQ("received_at::date")),
    run<{ label: string; v: string }>((w) => `select upper(btrim(material)) label, count(*) v from public.v_quotations where material is not null and ${w.sql} group by 1 order by 2 desc limit 10`, mkQ("quoted_at::date")),
    run<{ label: string; v: string; e: string }>((w) => `select max(client_name) label, count(*) v, client_email e from public.v_quotations where client_email is not null and ${w.sql} group by client_email order by 2 desc limit 10`, mkQ("quoted_at::date")),
    q<{ cells: string[] }>(`select cells from public.sheet_rows where source_key = 'email_tracker' and tab = 'Dashboard' and deleted_at is null order by row_no`),
  ]);
  });
  const dash = (label: string) => n(typed.find((r) => r.cells[0] === label)?.cells[1]?.replace(/[^0-9.]/g, ""));
  return {
    inbox: { pending: n(inbox[0].pending), urgent: n(inbox[0].urgent), follow: n(inbox[0].follow), fresh: n(inbox[0].fresh), replied: n(inbox[0].replied) },
    quotes: { n: n(quotes[0].n), followup: n(quotes[0].followup), numbered: n(quotes[0].numbered), won: n(quotes[0].won) },
    leads: { n: n(leads[0].n), buy: n(leads[0].buy) },
    leadsMonthly: leadsMonthly.map((r) => ({ k: r.m, v: n(r.v) })), quotesMonthly: quotesMonthly.map((r) => ({ k: r.m, v: n(r.v) })),
    leadStates: leadStates.map((r) => ({ label: r.label, value: n(r.v) })), leadProducts: leadProducts.map((r) => ({ label: r.label, value: n(r.v) })),
    leadKinds: leadKinds.map((r) => ({ label: r.label, value: n(r.v) })), quoteMaterials: quoteMaterials.map((r) => ({ label: r.label, value: n(r.v) })),
    topClients: topClients.map((r) => ({ label: r.label, value: n(r.v), extra: r.e })),
    typed: { pending: dash("Total Pending"), open: dash("Open Quotations"), asOf: typed.find((r) => r.cells[0] === "Last Synced")?.cells[1] ?? "" },
    today,
  };
}
