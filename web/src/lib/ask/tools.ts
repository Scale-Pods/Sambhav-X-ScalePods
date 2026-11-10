import "server-only";
import { q } from "../db";
import { canExport, canSeeBusiness, canUploadDocs } from "../auth";
import { stockFit } from "../stockfit";
import { trailDetail, trailList } from "../tallytrail";
import { appRef, findSheetRows, sheetRef, type ToolCtx } from "./refs";

// The only things the Ask box may do: fixed, read-only lookups. The AI picks one and fills in its few parameters; it never writes SQL.
// Every lookup runs as the signed-in person (the database's row rules still apply) and returns a small, trimmed set of rows.
// Every record a lookup returns carries a reference id (ref / refs: r1, r2 ...) that stands for a link to where it can be checked: the exact row of a
// Google sheet, or a page of the app. The answer cites those ids and the screen turns them into links.

export type Who = "all" | "docs" | "admin" | "owner"; // everyone internal / people who work with documents / every staff login that may see business data (money, orders, mail, Tally) / owner and administrators only
export type Tool = {
  name: string;
  description: string;
  schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  who: Who;
  run: (i: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
};

const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const numv = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN; return Number.isFinite(n) ? n : null; };
const day = (v: unknown) => { const s = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const limit = (v: unknown, dflt = 15, max = 30) => Math.max(1, Math.min(max, Math.round(numv(v) ?? dflt)));
const like = (s: string) => (s ? `%${s.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null);
const cut = (s: string | null, n = 160) => (s && s.length > n ? s.slice(0, n) + "…" : s);

/** SQL: a name compared without spaces or punctuation, so "q lar" finds "QLAR TECHNOLOGY INDIA PVT LTD". `$n` holds the plain text; write `($n::text is null or ${nameHas(col, n)})`. */
const nameHas = (col: string, n: number) => `app.norm_text(${col}) like '%' || app.norm_text($${n}::text) || '%'`;
/** The words of a grade as the grade list writes them: upper case, GRADE as GR, the letter O as the digit 0 (the sheets have both 16Mo3 and 16M03). */
const gradeWords = (s: string) => s.toUpperCase().replace(/GRADE/g, "GR").replace(/O/g, "0").split(/[^A-Z0-9]+/).filter(Boolean).slice(0, 8);
/** SQL: every word of the grade is found in the grade's code (`$n` is the array of words, see gradeWords). So "sa gr 11" finds "SA 387 GR 11 CL2". */
const gradeHas = (col: string, n: number) => `not exists (select 1 from unnest($${n}::text[]) w where translate(upper(${col}), 'O', '0') not like '%' || w || '%')`;

const P = { type: "string" } as const;
const N = { type: "number" } as const;
const DATE = { type: "string", description: "YYYY-MM-DD" } as const;

const STOCK_SHEETS = ["wb1_stock_ims", "wb2_stock_spf_rs"];
const PAY_SOURCE: Record<string, string> = { SPF: "spf_payment_better", SAI: "sai_payment_better" };
const entityTab = (entity: string | null, kind: "Inv" | "Pur") => `${entity === "SAI" ? "Sai" : "Spf"} ${kind}`;

/** How old the stock figures are. The stock book is loaded from the stock sheets (WB1 and WB2) in batches; the sheets keep changing in between. */
async function stockAsOf(ctx: ToolCtx) {
  const [b] = await q<{ at: string | null }>(`select max(imported_at)::date::text at from public.import_batches`);
  const out: { stock_book_loaded_on: string | null; sheets_last_changed: string | null; note: string } = {
    stock_book_loaded_on: b?.at ?? null, sheets_last_changed: null, note: "Stock quantities are those of the stock book, loaded from the stock sheets on the date shown. Later changes in the sheets are not included until the next load.",
  };
  if (ctx.admin) {
    const [s] = await q<{ at: string | null }>(`select max(last_modified_at)::date::text at from public.sheet_sources where key = any($1::text[])`, [STOCK_SHEETS]);
    out.sheets_last_changed = s?.at ?? null;
  }
  return out;
}

type LotLike = { lot_no: number; plate_no: string | null; heat_no: string | null };
/** Give each plate its references: its page in the app and the row(s) of the stock sheets that carry its plate (or heat) number. */
async function lotRefs(ctx: ToolCtx, lots: LotLike[]) {
  const tokens = lots.map((l) => l.plate_no || l.heat_no || "").filter(Boolean);
  const rows = await findSheetRows(ctx, tokens, STOCK_SHEETS);
  const out = new Map<number, string[]>();
  for (const l of lots) {
    const ids = [appRef(ctx, `Plate ${l.lot_no} in the app`, `/plates/${l.lot_no}`)];
    const hit = rows.get(l.plate_no || l.heat_no || "") ?? [];
    for (const h of hit.slice(0, 2)) { const id = await sheetRef(ctx, h.source_key, h.tab, h.row_no); if (id) ids.push(id); }
    out.set(l.lot_no, ids);
  }
  return out;
}


type AppPage = { path: string; title: string; what: string; who: Who };
const PAGES: AppPage[] = [
  { path: "/", title: "Stock overview", what: "stock now, received and sold in a period, charts", who: "all" },
  { path: "/summary", title: "Summary", what: "stock by grade and thickness", who: "all" },
  { path: "/plates", title: "Plates", what: "every plate with heat and plate number, filters, plate history", who: "all" },
  { path: "/stock-check", title: "Stock check", what: "do we have this plate: type grade and size", who: "all" },
  { path: "/count", title: "Physical count", what: "count the yard and settle differences", who: "all" },
  { path: "/mill-orders", title: "Mill orders", what: "what was ordered from the mills and what has arrived; vehicle weights", who: "all" },
  { path: "/documents", title: "Documents", what: "upload a PO, enquiry, vendor invoice or mill certificate to be read and confirmed", who: "docs" },
  { path: "/drafts", title: "Drafts", what: "orders and enquiries confirmed from documents, waiting to be worked on", who: "docs" },
  { path: "/orders", title: "Orders and dispatch", what: "customer orders, open and late orders", who: "admin" },
  { path: "/orders/list", title: "Order list", what: "every order with status and delivery date", who: "admin" },
  { path: "/orders/vehicles", title: "Vehicle register", what: "trips and tonnes sent by month and plot", who: "admin" },
  { path: "/quotations", title: "Quotations", what: "quotation builder (coming soon)", who: "admin" },
  { path: "/mail", title: "Mail and leads", what: "mail waiting, quotes with no follow-up, IndiaMART leads", who: "admin" },
  { path: "/mail/inbox", title: "Mail inbox", what: "mails waiting for a reply", who: "admin" },
  { path: "/mail/quotations", title: "Quotations sent", what: "quotations and their follow-up", who: "admin" },
  { path: "/mail/leads", title: "IndiaMART leads", what: "enquiries from IndiaMART", who: "admin" },
  { path: "/mail/clients", title: "Clients", what: "client list from the email tracker", who: "admin" },
  { path: "/payments", title: "Invoices and payments", what: "what customers owe, what we owe, sales and purchases", who: "admin" },
  { path: "/payments/receivables", title: "Who owes us", what: "customer invoices not yet paid, overdue", who: "admin" },
  { path: "/payments/payables", title: "What we owe", what: "vendor bills not yet paid", who: "admin" },
  { path: "/payments/sales", title: "Sales invoices", what: "sales invoices from the payment sheets", who: "admin" },
  { path: "/payments/purchases", title: "Purchase invoices", what: "purchase bills from the payment sheets", who: "admin" },
  { path: "/payments/expenses", title: "Expenses", what: "expenses entered through the form", who: "admin" },
  { path: "/tally", title: "Tally status", what: "is Tally connected, last sync", who: "admin" },
  { path: "/tally/parties", title: "Customers and vendors (Tally)", what: "Tally ledgers and balances", who: "admin" },
  { path: "/tally/receivables", title: "Debtors vs sheets", what: "Tally debtors compared with the payment sheets", who: "admin" },
  { path: "/tally/payables", title: "Creditors vs sheets", what: "Tally creditors compared with the payment sheets", who: "admin" },
  { path: "/tally/invoices", title: "Invoices and paperwork", what: "Tally sales invoices with PO, certificates, vehicle, e-invoice", who: "admin" },
  { path: "/sheets", title: "Sheet view", what: "the Google Sheets copies, tab by tab", who: "admin" },
  { path: "/review", title: "Needs review", what: "things the sheets could not settle", who: "admin" },
  { path: "/digital-brain", title: "Digital Brain", what: "the full question workspace with history, files and saved questions", who: "all" },
];

export const TOOLS: Tool[] = [
  {
    name: "stock_check",
    who: "all",
    description: "Do we have this plate in stock? Same grade, thickness (within 0.05 mm) and big enough (width and length either way round). Use for any 'do we have', 'is it available', 'can we supply' question about a plate.",
    schema: { type: "object", properties: { grade: { ...P, description: "e.g. SA 387 GR 22 CL2, SA516 Gr70, 16Mo3" }, thickness_mm: N, width_mm: N, length_mm: N, quantity: N, unit: { type: "string", enum: ["nos", "kg", "mt"], description: "unit of quantity: plates, kilograms or metric tonnes" } }, required: ["grade", "thickness_mm"] },
    async run(i, ctx) {
      const qty = numv(i.quantity), unit = str(i.unit, 3);
      const f = await stockFit({
        grade: str(i.grade), thk: numv(i.thickness_mm), width: numv(i.width_mm), length: numv(i.length_mm),
        needPcs: unit === "nos" && qty ? Math.round(qty) : null, needKg: qty && unit === "kg" ? qty : qty && unit === "mt" ? qty * 1000 : null,
      });
      const shown = [...f.lots.slice(0, 6), ...f.near];
      const refs = await lotRefs(ctx, shown);
      const lot = (l: (typeof f.lots)[number]) => ({ refs: refs.get(l.lot_no), plate: l.lot_no, size_mm: `${l.thickness_mm} x ${l.width_mm} x ${l.length_mm}`, kg: Math.round(l.balance_kg), pieces: l.balance_pieces, heat_no: l.heat_no, plate_no: l.plate_no, company: l.entity, exact_size: l.exact_size, part_plate_cut_from_mm: l.part ? l.original_length_mm : undefined });
      return { verdict: f.verdict, summary: f.why, grade_read_as: f.grade.code, grade_candidates: f.grade.candidates, plates: f.plates, pieces: f.pieces, kg: Math.round(f.kg), best_plates: f.lots.slice(0, 6).map(lot), nearby_thickness: f.near.map(lot), data_as_of: await stockAsOf(ctx) };
    },
  },
  {
    name: "stock_summary",
    who: "all",
    description: "Plates in stock added up by grade and thickness (plates, pieces, kilograms). Optionally for one grade and/or one thickness. Use for 'how much X do we have', 'what stock do we have of grade Y'.",
    schema: { type: "object", properties: { grade: P, thickness_mm: N } },
    async run(i, ctx) {
      const grade = str(i.grade);
      const rows = await q(
        `select g.code grade, l.thickness_mm::float8 thickness_mm, count(*)::int plates, sum(greatest(coalesce(l.balance_pieces, 0), 1))::int pieces, round(sum(l.balance_kg))::int kg
           from public.v_lots_current l join public.grades g on g.id = l.grade_id
          where l.current_status = 'available' and l.balance_kg > 0
            and (cardinality($1::text[]) = 0 or ${gradeHas("g.code", 1)} or g.id in (select a.grade_id from public.grade_aliases a where translate(a.alias_norm, 'O', '0') = translate(app.norm_text($3), 'O', '0')))
            and ($2::numeric is null or abs(l.thickness_mm - $2) <= 0.05)
          group by 1, 2 order by kg desc limit 30`, [gradeWords(grade), numv(i.thickness_mm), grade]);
      const ref = appRef(ctx, "Stock summary page", "/summary");
      return { rows, refs: [ref], data_as_of: await stockAsOf(ctx) };
    },
  },
  {
    name: "stock_age",
    who: "all",
    description: "How long plates have been lying in stock: the OLDEST plates still available (by the date they were received), optionally for one grade and/or one thickness, with the date received and days in stock, plus how much stock sits in each age band. Use for 'oldest stock', 'which plates have been here longest', 'slow moving', 'how old is our stock'.",
    schema: { type: "object", properties: { grade: P, thickness_mm: N, limit: N } },
    async run(i, ctx) {
      const words = gradeWords(str(i.grade)), thk = numv(i.thickness_mm);
      const from = `from public.v_lots_current l left join public.grades g on g.id = l.grade_id left join public.entities e on e.id = l.entity_id
         where l.current_status = 'available' and l.balance_kg > 0 and l.receipt_date is not null
           and (cardinality($1::text[]) = 0 or ${gradeHas("g.code", 1)}) and ($2::numeric is null or abs(l.thickness_mm - $2) <= 0.05)`;
      const rows = await q<{ lot_no: number; plate_no: string | null; heat_no: string | null } & Record<string, unknown>>(
        `select l.lot_no::int lot_no, g.code grade, l.thickness_mm::float8 thk, l.width_mm::float8 width, l.length_mm::float8 length, l.heat_no, l.plate_no, l.receipt_date::text received,
                (current_date - l.receipt_date)::int days_in_stock, round(l.balance_kg)::int kg, l.balance_pieces pieces, e.code company
           ${from} order by l.receipt_date asc, l.lot_no limit ${limit(i.limit, 10, 20)}`, [words, thk]);
      const bands = await q(
        `select case when l.receipt_date < current_date - 730 then 'over 2 years' when l.receipt_date < current_date - 365 then '1 to 2 years' when l.receipt_date < current_date - 180 then '6 to 12 months' else 'under 6 months' end age,
                count(*)::int plates, round(sum(l.balance_kg))::int kg ${from} group by 1 order by min(l.receipt_date)`, [words, thk]);
      const refs = await lotRefs(ctx, rows);
      return { oldest_first: rows.map((r) => ({ ...r, refs: refs.get(r.lot_no) })), stock_by_age: bands, note: "age is counted from the receipt date in the stock sheets", data_as_of: await stockAsOf(ctx) };
    },
  },
  {
    name: "stock_movements",
    who: "all",
    description: "What went in and out of stock in a period, or in all time: receipts (bought), sales (sold), cuts, adjustments and counts, added up by kind, with a breakdown by grade, thickness or month and the latest individual movements. Optionally for one grade, thickness or kind. Use for 'what changed in stock this week', 'how much did we sell of grade X', 'what did we receive in October', 'sales by grade'. Give dates as YYYY-MM-DD (work them out from today's date).",
    schema: { type: "object", properties: { from: DATE, to: DATE, grade: P, thickness_mm: N, kind: { type: "string", enum: ["receipt", "sale", "cut_out", "cut_in", "adjustment", "opening_count", "reversal"] }, group_by: { type: "string", enum: ["grade", "thickness", "month"], description: "how to split the breakdown; default grade" } } },
    async run(i, ctx) {
      const args = [day(i.from), day(i.to), gradeWords(str(i.grade)), numv(i.thickness_mm), str(i.kind, 14) || null];
      const base = `from public.stock_movements m join public.v_lots_current l on l.id = m.lot_id left join public.grades g on g.id = l.grade_id
         where ($1::date is null or m.movement_date >= $1::date) and ($2::date is null or m.movement_date <= $2::date)
           and (cardinality($3::text[]) = 0 or ${gradeHas("g.code", 3)}) and ($4::numeric is null or abs(l.thickness_mm - $4) <= 0.05) and ($5::text is null or m.movement_type::text = $5)`;
      const g = str(i.group_by, 10);
      const split = g === "month" ? "to_char(m.movement_date, 'YYYY-MM')" : g === "thickness" ? "l.thickness_mm::float8" : "g.code";
      const totals = await q(`select m.movement_type::text kind, count(*)::int movements, count(distinct m.lot_id)::int plates, abs(sum(m.pieces))::int pieces, round(abs(sum(m.weight_kg)))::int kg ${base} group by 1 order by 1`, args);
      const breakdown = await q(`select m.movement_type::text kind, ${split} as ${g === "month" ? "month" : g === "thickness" ? "thickness_mm" : "grade"}, abs(sum(m.pieces))::int pieces, round(abs(sum(m.weight_kg)))::int kg ${base} group by 1, 2 order by 1, 4 desc limit 30`, args);
      const latest = await q<{ lot_no: number } & Record<string, unknown>>(
        `select m.movement_date::text date, m.movement_type::text kind, g.code grade, l.thickness_mm::float8 thk, l.width_mm::float8 width, l.length_mm::float8 length, l.heat_no, l.plate_no, l.lot_no::int lot_no, m.pieces, round(m.weight_kg)::int kg, left(m.note, 80) note
           ${base} order by m.movement_date desc, m.seq desc limit 10`, args);
      return {
        period: { from: args[0], to: args[1] }, totals_by_kind: totals, breakdown,
        latest: latest.map(({ lot_no, ...r }) => ({ ...r, plate: lot_no, refs: [appRef(ctx, `Plate ${lot_no} in the app`, `/plates/${lot_no}`)] })),
        note: "kg and pieces in the totals are absolute (sales leave stock, receipts enter it); in 'latest' a minus sign means it left stock. Movements come from the stock sheets as loaded into the stock book, so very recent sheet changes may not be in yet.",
        refs: [appRef(ctx, "Plates in the app", "/plates"), appRef(ctx, "Stock overview", "/")], data_as_of: await stockAsOf(ctx),
      };
    },
  },
  {
    name: "plate_lookup",
    who: "all",
    description: "Find a plate by its heat number, plate number, test certificate number or plate (lot) number, with its status, balance and any mill certificates filed for it.",
    schema: { type: "object", properties: { text: { ...P, description: "heat, plate, TC or lot number (part of it is fine)" } }, required: ["text"] },
    async run(i, ctx) {
      const t = str(i.text);
      const rows = await q<{ plate: number; plate_no: string | null; heat_no: string | null } & Record<string, unknown>>(
        `select l.lot_no::int plate, g.code grade, l.thickness_mm::float8 thk, l.width_mm::float8 width, l.length_mm::float8 length, l.heat_no, l.plate_no, l.tc_no,
                l.current_status status, l.balance_kg::float8 kg, l.balance_pieces pieces, l.receipt_date::text received, e.code company,
                (select string_agg(coalesce(c.cert_no, 'certificate'), ', ') from public.lot_certificates lc join public.certificates c on c.id = lc.certificate_id where lc.lot_id = l.id) certificates
           from public.v_lots_current l left join public.grades g on g.id = l.grade_id left join public.entities e on e.id = l.entity_id
          where l.heat_no ilike $1 or l.plate_no ilike $1 or l.tc_no ilike $1 or l.lot_no::text = $2 order by l.receipt_date desc nulls last limit 12`, [like(t), t]);
      const refs = await lotRefs(ctx, rows.map((r) => ({ lot_no: r.plate, plate_no: r.plate_no, heat_no: r.heat_no })));
      return { rows: rows.map((r) => ({ ...r, refs: refs.get(r.plate) })), data_as_of: await stockAsOf(ctx) };
    },
  },
  {
    name: "overview",
    who: "admin",
    description: "The headline numbers: plates and kg in stock, open orders, money to receive and to pay, sales this month, new leads this week, mails waiting. Use for 'how are we doing', 'give me the overview'.",
    schema: { type: "object", properties: {} },
    async run(_i, ctx) {
      const [r] = await q(
        `select (select count(*)::int from public.v_lots_current where current_status = 'available' and balance_kg > 0) plates_in_stock,
                (select round(coalesce(sum(balance_kg), 0))::bigint from public.v_lots_current where current_status = 'available' and balance_kg > 0) kg_in_stock,
                (select count(*)::int from public.v_orders where status = 'Open') open_orders,
                (select round(coalesce(sum(pending), 0))::bigint from public.v_receivables where pending > 0) to_receive_rs,
                (select round(coalesce(sum(pending), 0))::bigint from public.v_payables where pending > 0) to_pay_rs,
                (select round(coalesce(sum(amount), 0))::bigint from public.v_sales_invoices where invoice_date >= date_trunc('month', current_date)) sales_this_month_rs,
                (select count(*)::int from public.v_leads where received_at >= now() - interval '7 days') leads_last_7_days,
                (select count(*)::int from public.v_mail_inbox where state = 'Pending' and no_reply is not true) mails_waiting`);
      return { ...r, refs: [appRef(ctx, "Overview page", "/"), appRef(ctx, "Invoices and payments", "/payments"), appRef(ctx, "Orders and dispatch", "/orders")], stock_data_as_of: await stockAsOf(ctx) };
    },
  },
  {
    name: "orders_search",
    who: "admin",
    description: "Customer orders (the Dispatch FMS): by client, PO number, order number, status or date. Returns how many orders match (total, open, complete) and the orders with grades, status and vehicles. An order's status is 'Open' (not fully dispatched: pending) or 'Complete' (all lines dispatched). For 'how many orders are pending' use status Open and read the counts.",
    schema: { type: "object", properties: { client: { ...P, description: "customer name, or part of it; spaces and punctuation do not matter" }, po_no: P, order_no: P, status: { ...P, description: "Open (pending) or Complete" }, since: DATE, limit: N } },
    async run(i, ctx) {
      const st0 = str(i.status, 20);
      const status = !st0 ? null : /pend|open|not.*(done|dispatch|deliver)|undeliver|incomplete/i.test(st0) ? "Open" : /complete|done|deliver|dispatched|closed|finish/i.test(st0) ? "Complete" : st0;
      const rows = await q<{ order_no: string; first_row: number | null; total_matching: number; open_matching: number } & Record<string, unknown>>(
        `select o.order_no, o.company, o.salesperson, o.client, o.po_no, o.order_date::text, o.etd::text, o.delivery_location, o.lines, o.done_lines, o.status, o.grades, o.vehicles,
                (select min(l.row_no)::int from public.v_order_lines l where l.order_no = o.order_no) first_row,
                (count(*) over ())::int total_matching, (count(*) filter (where o.status = 'Open') over ())::int open_matching
           from public.v_orders o
          where ($1::text is null or ${nameHas("o.client", 1)}) and ($2::text is null or o.po_no ilike $2) and ($3::text is null or o.order_no = $3)
            and ($4::text is null or o.status ilike $4) and ($5::date is null or o.order_date >= $5::date)
          order by o.order_date desc nulls last limit ${limit(i.limit)}`, [str(i.client) || null, like(str(i.po_no)), str(i.order_no) || null, status ? like(status) : null, day(i.since)]);
      const orders = [];
      for (const r of rows) {
        const refs = [appRef(ctx, `Order ${r.order_no} in the app`, `/orders/${encodeURIComponent(r.order_no)}`)];
        if (r.first_row) { const s = await sheetRef(ctx, "dispatch_fms", "FormResponses", r.first_row); if (s) refs.push(s); }
        const { first_row: _drop, total_matching: _t, open_matching: _o, ...rest } = r; void _drop; void _t; void _o;
        orders.push({ ...rest, refs });
      }
      return { total_matching: rows[0]?.total_matching ?? 0, open_among_them: rows[0]?.open_matching ?? 0, shown: orders.length, orders, note: rows.length ? "orders are listed newest first; the same customer may be written in several ways in the orders sheet and all spellings are included" : "no order matches; the customer name may be written differently in the sheet" };
    },
  },
  {
    name: "order_detail",
    who: "admin",
    description: "All lines of one order (grade, size, quantity, rate, material source, transporter, vehicle, done).",
    schema: { type: "object", properties: { order_no: P }, required: ["order_no"] },
    async run(i, ctx) {
      const rows = await q<{ row_no: number } & Record<string, unknown>>(
        `select row_no::int row_no, order_no, sr_no, client, po_no, grade, size, qty::float8, unit, rate::float8, material, transporter, vehicle_no, done, instructions
           from public.v_order_lines where order_no = $1 order by sr_no limit 40`, [str(i.order_no)]);
      const page = appRef(ctx, `Order ${str(i.order_no)} in the app`, `/orders/${encodeURIComponent(str(i.order_no))}`);
      const out = [];
      for (const r of rows) { const s = await sheetRef(ctx, "dispatch_fms", "FormResponses", r.row_no); const { row_no: _r, ...rest } = r; void _r; out.push({ ...rest, refs: s ? [page, s] : [page] }); }
      return out;
    },
  },
  {
    name: "dispatch_search",
    who: "admin",
    description: "The vehicle register: what left, when, in which vehicle, with which invoice and weight. By vehicle number, invoice number, grade or dates.",
    schema: { type: "object", properties: { vehicle_no: P, invoice_no: P, grade: P, from: DATE, to: DATE, limit: N } },
    async run(i, ctx) {
      const rows = await q<{ row_no: number; month_tab: string } & Record<string, unknown>>(
        `select dispatch_date::text, vehicle_no, invoice_no, grade, weight_kg::float8, plot, entity, row_no::int row_no, month_tab from public.v_vehicle_register
          where ($1::text is null or vehicle_no ilike $1) and ($2::text is null or invoice_no ilike $2) and ($3::text is null or grade ilike $3)
            and ($4::date is null or dispatch_date >= $4::date) and ($5::date is null or dispatch_date <= $5::date)
          order by dispatch_date desc nulls last limit ${limit(i.limit)}`, [like(str(i.vehicle_no)), like(str(i.invoice_no)), like(str(i.grade)), day(i.from), day(i.to)]);
      const out = [];
      for (const r of rows) { const s = await sheetRef(ctx, "dispatch_26_27", r.month_tab, r.row_no); const { row_no: _r, month_tab: _m, ...rest } = r; void _r; void _m; out.push({ ...rest, refs: s ? [s] : [] }); }
      return out;
    },
  },
  {
    name: "receivables",
    who: "admin",
    description: "Money customers owe us (from the payment sheets). Without a party: the biggest debtors and the total. With a party: that party's open invoices with due dates and days overdue.",
    schema: { type: "object", properties: { party: P, only_overdue: { type: "boolean" } } },
    async run(i, ctx) {
      const party = str(i.party);
      if (party) {
        const rows = await q<{ entity: string; row_no: number } & Record<string, unknown>>(
          `select entity, row_no::int row_no, party, invoice_no, invoice_date::text, due_date::text, amount::float8, received::float8, pending::float8, overdue_days from public.v_receivables
            where pending > 0 and ${nameHas("party", 1)} order by overdue_days desc nulls last, pending desc limit 30`, [party]);
        const out = [];
        for (const r of rows) { const s = await sheetRef(ctx, PAY_SOURCE[r.entity] ?? "spf_payment_better", "M Sale", r.row_no); const { row_no: _r, ...rest } = r; void _r; out.push({ ...rest, refs: s ? [s] : [] }); }
        return out;
      }
      const rows = await q<{ top: { e: string; r: number }[] } & Record<string, unknown>>(
        `select party, count(*)::int invoices, round(sum(pending))::bigint pending_rs, max(overdue_days) max_days_overdue, round(sum(pending) filter (where overdue_days > 0))::bigint overdue_rs,
                (array_agg(jsonb_build_object('e', entity, 'r', row_no) order by pending desc))[1:4] top
           from public.v_receivables where pending > 0 ${i.only_overdue ? "and overdue_days > 0" : ""} group by party order by sum(pending) desc limit 15`);
      const out = [];
      for (const r of rows) {
        const refs: string[] = [];
        for (const t of r.top) { const s = await sheetRef(ctx, PAY_SOURCE[t.e] ?? "spf_payment_better", "M Sale", t.r); if (s) refs.push(s); }
        const { top: _t, ...rest } = r; void _t;
        out.push({ ...rest, refs, ref_note: "the party's pending_rs is the sum of ALL its open invoice rows in the sheet; refs are its largest rows only. Say that the figure is a total" });
      }
      return out;
    },
  },
  {
    name: "payables",
    who: "admin",
    description: "Money we owe vendors. Without a vendor: the biggest creditors. With a vendor: their open bills with due dates.",
    schema: { type: "object", properties: { vendor: P } },
    async run(i, ctx) {
      const vendor = str(i.vendor);
      if (vendor) {
        const rows = await q<{ entity: string; row_no: number } & Record<string, unknown>>(
          `select entity, row_no::int row_no, vendor, invoice_no, invoice_date::text, due_date::text, amount::float8, advance::float8, pending::float8, overdue_days from public.v_payables
            where pending > 0 and ${nameHas("vendor", 1)} order by due_date nulls last limit 30`, [vendor]);
        const out = [];
        for (const r of rows) { const s = await sheetRef(ctx, PAY_SOURCE[r.entity] ?? "spf_payment_better", "M Pur", r.row_no); const { row_no: _r, ...rest } = r; void _r; out.push({ ...rest, refs: s ? [s] : [] }); }
        return out;
      }
      const rows = await q<{ top: { e: string; r: number }[] } & Record<string, unknown>>(
        `select vendor, count(*)::int bills, round(sum(pending))::bigint pending_rs, max(overdue_days) max_days_overdue,
                (array_agg(jsonb_build_object('e', entity, 'r', row_no) order by pending desc))[1:4] top
           from public.v_payables where pending > 0 group by vendor order by sum(pending) desc limit 15`);
      const out = [];
      for (const r of rows) {
        const refs: string[] = [];
        for (const t of r.top) { const s = await sheetRef(ctx, PAY_SOURCE[t.e] ?? "spf_payment_better", "M Pur", t.r); if (s) refs.push(s); }
        const { top: _t, ...rest } = r; void _t;
        out.push({ ...rest, refs, ref_note: "pending_rs is the sum of ALL the vendor's open bills in the sheet; refs are its largest rows only. Say that the figure is a total" });
      }
      return out;
    },
  },
  {
    name: "invoices_search",
    who: "admin",
    description: "Sales or purchase invoices (from the payment sheets) by party, invoice number or dates, with amounts.",
    schema: { type: "object", properties: { kind: { type: "string", enum: ["sales", "purchase"] }, party: P, invoice_no: P, from: DATE, to: DATE, limit: N }, required: ["kind"] },
    async run(i, ctx) {
      const sales = str(i.kind) === "sales";
      const rows = await q<{ entity: string; row_no: number } & Record<string, unknown>>(
        sales
          ? `select entity, row_no::int row_no, invoice_no, invoice_date::text, client party, amount::float8, po_no, transporter, due_date::text from public.v_sales_invoices
              where ($1::text is null or ${nameHas("client", 1)}) and ($2::text is null or invoice_no ilike $2) and ($3::date is null or invoice_date >= $3::date) and ($4::date is null or invoice_date <= $4::date)
              order by invoice_date desc nulls last limit ${limit(i.limit)}`
          : `select entity, row_no::int row_no, invoice_no, invoice_date::text, vendor party, amount::float8, weight::float8 weight_kg, rate::float8, due_date::text from public.v_purchase_invoices
              where ($1::text is null or ${nameHas("vendor", 1)}) and ($2::text is null or invoice_no ilike $2) and ($3::date is null or invoice_date >= $3::date) and ($4::date is null or invoice_date <= $4::date)
              order by invoice_date desc nulls last limit ${limit(i.limit)}`,
        [str(i.party) || null, like(str(i.invoice_no)), day(i.from), day(i.to)]);
      const out = [];
      for (const r of rows) { const s = await sheetRef(ctx, "form_responses", entityTab(r.entity, sales ? "Inv" : "Pur"), r.row_no); const { row_no: _r, ...rest } = r; void _r; out.push({ ...rest, refs: s ? [s] : [] }); }
      return out;
    },
  },
  {
    name: "payments_search",
    who: "admin",
    description: "GPay / UPI payments entered by the team: description, for whom, amount, who paid, date.",
    schema: { type: "object", properties: { text: P, from: DATE, to: DATE, limit: N } },
    async run(i, ctx) {
      const rows = await q<{ row_no: number } & Record<string, unknown>>(
        `select row_no::int row_no, entered_at::date::text as day, description, for_whom, amount::float8, paid_by from public.v_gpay_payments
          where ($1::text is null or description ilike $1 or for_whom ilike $1 or paid_by ilike $1) and ($2::date is null or entered_at >= $2::date) and ($3::date is null or entered_at < $3::date + 1)
          order by entered_at desc nulls last limit ${limit(i.limit)}`, [like(str(i.text)), day(i.from), day(i.to)]);
      const out = [];
      for (const r of rows) { const s = await sheetRef(ctx, "form_responses", "Gpay", r.row_no); const { row_no: _r, ...rest } = r; void _r; out.push({ ...rest, refs: s ? [s] : [] }); }
      return out;
    },
  },
  {
    name: "leads_mail_quotes",
    who: "admin",
    description: "Leads (IndiaMART etc.), the mail inbox tracker, or quotations sent: search by text. kind = leads | mail | quotations.",
    schema: { type: "object", properties: { kind: { type: "string", enum: ["leads", "mail", "quotations"] }, text: P, status: P, limit: N }, required: ["kind"] },
    async run(i, ctx) {
      const t = like(str(i.text)), n = limit(i.limit, 10, 20);
      const withRefs = async (rows: ({ row_no: number; tab: string } & Record<string, unknown>)[], source: string) => {
        const out = [];
        for (const r of rows) { const s = await sheetRef(ctx, source, r.tab, r.row_no); const { row_no: _r, tab: _t, ...rest } = r; void _r; void _t; out.push({ ...rest, refs: s ? [s] : [] }); }
        return out;
      };
      switch (str(i.kind)) {
        case "leads":
          return withRefs(await q(`select row_no::int row_no, 'Enquiries' tab, received_at::date::text as day, name, company, city, state, product, mobile, left(message, 200) message from public.v_leads
            where ($1::text is null or name ilike $1 or company ilike $1 or product ilike $1 or city ilike $1 or message ilike $1) order by received_at desc nulls last limit ${n}`, [t]), "indiamart");
        case "mail":
          return withRefs(await q(`select row_no::int row_no, state tab, received_at::date::text as day, from_name, from_email, subject, status, days, remarks, marked_done, no_reply from public.v_mail_inbox
            where ($1::text is null or subject ilike $1 or from_name ilike $1 or from_email ilike $1 or remarks ilike $1) and ($2::text is null or status ilike $2) order by received_at desc nulls last limit ${n}`, [t, like(str(i.status))]), "email_tracker");
        case "quotations":
          return withRefs(await q(`select row_no::int row_no, source_tab tab, quote_no, client_name, quoted_at::date::text as day, material, qty, price::float8, status, order_value::float8, lost_reason, remarks from public.v_quotations
            where ($1::text is null or client_name ilike $1 or material ilike $1 or quote_no ilike $1 or subject ilike $1) and ($2::text is null or status ilike $2) order by quoted_at desc nulls last limit ${n}`, [t, like(str(i.status))]), "email_tracker");
        default:
          return { error: "kind must be leads, mail or quotations" };
      }
    },
  },
  {
    name: "tally_voucher",
    who: "admin",
    description: "Find vouchers in Tally (read-only copy): by voucher/invoice number, IRN, e-way bill number, vehicle number, party, type or dates. Returns the invoice with its e-invoice, e-way bill, vehicle and the items.",
    schema: { type: "object", properties: { voucher_no: P, irn: P, eway_bill_no: P, vehicle_no: P, party: P, type: { ...P, description: "Sales, Purchase, Receipt, Payment, Journal, Credit Note ..." }, from: DATE, to: DATE, limit: N } },
    async run(i, ctx) {
      const rows = await q<{ id: string; voucher_no: string; type: string } & Record<string, unknown>>(
        `select v.id, v.voucher_no, (select en.code from public.tally_companies tc join public.entities en on en.id = tc.entity_id where tc.id = v.company_id) company, v.voucher_date::text date, v.voucher_type type, v.party_ledger party, v.amount::float8 amount, v.is_cancelled cancelled, left(v.irn, 12) irn_start, v.eway_bill_no, v.vehicle_no,
                v.buyer_order_no, v.shipped_by,
                (select string_agg(coalesce(i.item_name, '?') || ' ' || coalesce(i.quantity::text, '') || ' ' || coalesce(i.unit, '') || ' @' || coalesce(i.rate::text, ''), '; ' order by i.line_no) from public.tally_voucher_items i where i.voucher_id = v.id) items
           from public.tally_vouchers v
          where v.deleted_at is null and ($1::text is null or v.voucher_no ilike $1) and ($2::text is null or v.irn ilike $2) and ($3::text is null or v.eway_bill_no = $3)
            and ($4::text is null or v.vehicle_no ilike $4) and ($5::text is null or ${nameHas("v.party_ledger", 5)}) and ($6::text is null or v.voucher_type ilike $6)
            and ($7::date is null or v.voucher_date >= $7::date) and ($8::date is null or v.voucher_date <= $8::date)
          order by v.voucher_date desc limit ${limit(i.limit, 8, 15)}`,
        [like(str(i.voucher_no)), like(str(i.irn)), str(i.eway_bill_no) || null, like(str(i.vehicle_no)), str(i.party) || null, str(i.type) || null, day(i.from), day(i.to)]);
      return rows.map(({ id, ...r }) => ({ ...r, refs: r.type === "Sales" ? [appRef(ctx, `Tally invoice ${r.voucher_no}${r.party ? ` · ${r.party}` : ""}`, `/tally/invoices/${id}`)] : [appRef(ctx, "Tally customers and vendors", "/tally/parties")] }));
    },
  },
  {
    name: "invoice_trail",
    who: "admin",
    description: "The paperwork behind a Tally sales invoice: the customer's PO (uploaded or in the orders sheet), the heat numbers on its lines and whether a mill certificate is filed for each, the vehicle register row, and any document with the same IRN or e-way bill. Use to ask whether an invoice has its PO or certificates.",
    schema: { type: "object", properties: { invoice_no: { ...P, description: "the invoice (voucher) number, e.g. 730/26-27" } }, required: ["invoice_no"] },
    async run(i, ctx) {
      const rows = await trailList("all", str(i.invoice_no, 40), 1, null); // both companies
      if (rows.length === 0) return { error: "No sales invoice with that number" };
      const t = await trailDetail(rows[0].id);
      if (!t) return { error: "Not found" };
      // each fact carries the references that show it, so an answer can cite the right place for each claim
      const invoice_refs = [appRef(ctx, `Tally invoice ${t.v.voucher_no} (paperwork trail)`, `/tally/invoices/${rows[0].id}`)];
      const po_documents = t.po_docs.map((d) => ({ file: d.file, review: d.review, refs: [appRef(ctx, `Uploaded PO ${d.file}`, `/documents/${d.id}`)] }));
      const po_in_orders_sheet = [];
      for (const o of t.po_orders) {
        const refs = [appRef(ctx, `Order ${o.order_no} in the app`, `/orders/${encodeURIComponent(o.order_no)}`)];
        if (o.po_no) { const hit = (await findSheetRows(ctx, [o.po_no], ["dispatch_fms"])).get(o.po_no.trim())?.[0]; if (hit) { const s = await sheetRef(ctx, hit.source_key, hit.tab, hit.row_no); if (s) refs.push(s); } }
        po_in_orders_sheet.push({ order: `order ${o.order_no} (${o.client})`, refs });
      }
      const sheetHits = await findSheetRows(ctx, t.heats.map((h) => h.heat), STOCK_SHEETS);
      const heats = [];
      for (const h of t.heats) {
        const refs = h.lots.slice(0, 2).map((l) => appRef(ctx, `Plate ${l.lot_no} in the app`, `/plates/${l.lot_no}`));
        for (const x of (sheetHits.get(h.heat.trim()) ?? []).slice(0, 1)) { const s = await sheetRef(ctx, x.source_key, x.tab, x.row_no); if (s) refs.push(s); }
        for (const d of h.cert_docs.slice(0, 1)) refs.push(appRef(ctx, `Certificate ${d.file}`, `/documents/${d.id}`));
        heats.push({ heat: h.heat, plates_in_books: h.lots.length, certificates_filed: [...new Set(h.lots.flatMap((l) => l.certs))], certificate_documents_read: h.cert_docs.length, refs });
      }
      const vehicle_register = [];
      for (const r of t.register) { const s = await sheetRef(ctx, "dispatch_26_27", r.month_tab, r.row_no); vehicle_register.push({ row: `${r.dispatch_date} vehicle ${r.vehicle_no}`, refs: s ? [s] : [] }); }
      const same = t.same_numbers.map((d) => ({ file: d.file, refs: [appRef(ctx, `Document ${d.file}`, `/documents/${d.id}`)] }));
      return {
        invoice: t.v.voucher_no, company: rows[0].company, date: t.v.date, customer: t.v.party, amount_rs: t.v.amount, po_noted_in_tally: t.v.buyer_order_no, verbal_order: t.v.verbal, refs: invoice_refs,
        po_documents, po_in_orders_sheet, heats, vehicle_register, e_way_bill: t.v.eway_bill_no, vehicle: t.v.vehicle_no, documents_with_same_irn_or_eway: same,
        more_matches_with_this_number: rows.length - 1,
      };
    },
  },
  {
    name: "paperwork_gaps",
    who: "admin",
    description: "Tally sales invoices that are missing paperwork, in one list: no customer PO (kind = no_po), no mill certificate (no_certificate) or not in the vehicle register (no_dispatch), newest first, with the total count. Use this for 'which invoices have no PO / no certificate' instead of checking invoices one by one.",
    schema: { type: "object", properties: { kind: { type: "string", enum: ["no_po", "no_certificate", "no_dispatch"] }, limit: N }, required: ["kind"] },
    async run(i, ctx) {
      const show = str(i.kind) === "no_certificate" ? "nocert" : str(i.kind) === "no_dispatch" ? "nodispatch" : "nopo";
      const rows = await trailList(show, "", 1, null); // both companies
      const n = limit(i.limit, 12, 15);
      return {
        total_invoices: rows[0]?.total ?? 0,
        note: "newest first; invoice numbers made only of X are placeholders (drafts), not real invoices",
        shown: rows.slice(0, n).map((r) => ({
          invoice: r.voucher_no, company: r.company, placeholder_number: /^x+$/i.test(r.voucher_no), date: r.date, customer: (r.party ?? "").replace(/\s*\((Sale|Pur|Rent)\)\s*$/i, ""), amount_rs: r.amount,
          po_noted_in_tally: r.po_ref, verbal_order: r.verbal, heat_numbers: r.heats, certificates_filed: r.certs_filed,
          refs: [appRef(ctx, `Tally invoice ${r.voucher_no} · ${(r.party ?? "").replace(/\s*\((Sale|Pur|Rent)\)\s*$/i, "")}`, `/tally/invoices/${r.id}`)],
        })),
        refs: [appRef(ctx, "Tally invoices and paperwork", `/tally/invoices?show=${show}`)],
      };
    },
  },
  {
    name: "tally_party",
    who: "admin",
    description: "A customer or vendor in Tally: the ledger balance (positive = they owe us, negative = we owe them), GSTIN, and the open bills.",
    schema: { type: "object", properties: { name: P }, required: ["name"] },
    async run(i, ctx) {
      const n = str(i.name);
      const ledgers = await q(`select (select en.code from public.tally_companies tc join public.entities en on en.id = tc.entity_id where tc.id = company_id) company, name, parent_group, gstin, state, closing_balance::float8 balance_rs from public.tally_ledgers where deleted_at is null and ${nameHas("name", 1)} order by abs(coalesce(closing_balance, 0)) desc limit 6`, [n]);
      const bills = await q(`select (select en.code from public.tally_companies tc join public.entities en on en.id = tc.entity_id where tc.id = company_id) company, kind, party_ledger party, count(*)::int bills, round(sum(pending_amount))::bigint pending_rs, min(due_date)::text oldest_due from public.tally_outstanding_bills where ${nameHas("party_ledger", 1)} group by 1, 2, 3 order by 5 desc limit 8`, [n]);
      return { ledgers, open_bills: bills, refs: [appRef(ctx, `Tally customers and vendors: ${str(i.name)}`, `/tally/parties?q=${encodeURIComponent(str(i.name))}`)] };
    },
  },
  {
    name: "documents_search",
    who: "docs",
    description: "Uploaded documents (POs, enquiries) and their review status, with what was read: buyer, number, date, total.",
    schema: { type: "object", properties: { status: { type: "string", enum: ["to_review", "reviewed", "not_read", "all"] }, text: P, limit: N } },
    async run(i, ctx) {
      const s = str(i.status, 10);
      const where = s === "reviewed" ? "d.review_status <> 'pending'" : s === "not_read" ? "d.extraction_status = 'failed' and d.review_status = 'pending'" : s === "all" ? "true" : "d.review_status = 'pending' and d.extraction_status in ('pending', 'needs_review') and d.duplicate_of is null";
      const rows = await q<{ id: string } & Record<string, unknown>>(
        `select d.id, d.original_filename file, d.created_at::date::text uploaded, d.extraction_status read_state, d.review_status review_state, coalesce(d.extracted->>'doc_kind', d.extracted->>'family') kind,
                coalesce(nullif(d.extracted->>'buyer_name', ''), nullif(d.extracted->>'vendor_name', ''), nullif(d.extracted->>'mill_name', '')) buyer,
                coalesce(nullif(d.extracted->>'po_number', ''), nullif(d.extracted->>'document_number', ''), nullif(d.extracted->>'invoice_no', ''), nullif(d.extracted->>'certificate_no', '')) ref,
                coalesce(nullif(d.extracted->>'total_amount', ''), nullif(d.extracted->>'net_amount', '')) total
           from public.documents d where ${where} and ($1::text is null or d.original_filename ilike $1 or d.extracted->>'buyer_name' ilike $1 or d.extracted->>'vendor_name' ilike $1)
          order by d.created_at desc limit ${limit(i.limit)}`, [like(str(i.text))]);
      return rows.map(({ id, ...r }) => ({ ...r, refs: [appRef(ctx, `Document ${r.file}`, `/documents/${id}`)] }));
    },
  },
  {
    name: "drafts_search",
    who: "docs",
    description: "Drafts: customer orders, enquiries and vendor invoices that a person confirmed from a document and that are waiting to be worked on. By customer, PO number or status (open, dismissed).",
    schema: { type: "object", properties: { customer: P, po_no: P, status: { type: "string", enum: ["open", "dismissed", "all"] }, limit: N } },
    async run(i, ctx) {
      const st = str(i.status, 10) || "open";
      const rows = await q<{ id: string; kind: string } & Record<string, unknown>>(
        `select d.id, d.kind::text kind, d.status, d.customer_name, d.tally_ledger is not null as found_in_tally, d.po_no, d.doc_no, d.doc_date::text, d.total_amount::float8 total_rs,
                (select count(*)::int from public.draft_lines l where l.draft_id = d.id) lines, d.created_at::date::text as made
           from public.drafts d where ($1::text = 'all' or d.status = $1) and ($2::text is null or ${nameHas("d.customer_name", 2)}) and ($3::text is null or d.po_no ilike $3 or d.doc_no ilike $3)
          order by d.created_at desc limit ${limit(i.limit)}`, [st, str(i.customer) || null, like(str(i.po_no))]);
      return rows.map(({ id, ...r }) => ({ ...r, refs: [appRef(ctx, `Draft ${r.customer_name ?? ""} ${r.doc_no ?? r.po_no ?? ""}`.trim(), `/drafts/${id}`)] }));
    },
  },
  {
    name: "count_status",
    who: "docs",
    description: "The physical stock counts: recent sessions, their status and how many plates were counted or are still to check.",
    schema: { type: "object", properties: {} },
    async run(_i, ctx) {
      const rows = await q(`select s.name, b.code book, s.status, s.planned_date::text planned, s.started_at::date::text started, s.closed_at::date::text closed,
                       (select count(*)::int from public.count_lines c where c.session_id = s.id) lines_counted
                  from public.count_sessions s left join public.stock_books b on b.id = s.stock_book_id order by s.created_at desc limit 6`);
      return { rows, refs: [appRef(ctx, "Physical count", "/count")] };
    },
  },
  {
    name: "go_to",
    who: "all",
    description: "Find the page of this app that fits what the person wants to open or see (\"take me to debtors\", \"where is the physical count\", \"vehicle register\"). Returns pages with links.",
    schema: { type: "object", properties: { topic: { ...P, description: "what they want to open, in a few words" } }, required: ["topic"] },
    async run(i, ctx) {
      const words = str(i.topic, 60).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      const allowed = PAGES.filter((p) => p.who === "all" || (p.who === "docs" && (ctx.docs || ctx.admin)) || (p.who === "admin" && ctx.admin));
      const scored = allowed.map((p) => ({ p, n: words.filter((w) => `${p.title} ${p.what} ${p.path}`.toLowerCase().includes(w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
      const hits = scored.length ? scored.map((x) => x.p) : allowed.slice(0, 0);
      return hits.length ? hits.map((p) => ({ page: p.title, what: p.what, refs: [appRef(ctx, p.title, p.path)] })) : { note: "No page matches; say so and suggest the Overview or Digital Brain.", pages: allowed.map((p) => p.title) };
    },
  },
  {
    name: "sheet_search",
    who: "owner", // the raw sheet copies stay with the owner and administrators
    description: "Last resort: search any text across all the copied Google sheets (every tab). Use only when no other lookup fits. Returns the sheet, tab, row number and the row's cells.",
    schema: { type: "object", properties: { text: P, sheet: { ...P, description: "optional sheet key to limit the search" } }, required: ["text"] },
    async run(i, ctx) {
      const rows = await q<{ source_key: string; tab: string; row_no: number; cells: string[] }>(
        `select source_key, tab, row_no::int row_no, cells from public.sheet_rows where deleted_at is null and ($2::text is null or source_key = $2) and cells::text ilike $1 order by source_key, tab, row_no limit 8`, [like(str(i.text, 60)), str(i.sheet, 40) || null]);
      const out = [];
      for (const r of rows) { const s = await sheetRef(ctx, r.source_key, r.tab, r.row_no); out.push({ sheet: r.source_key, tab: r.tab, row: r.row_no, cells: r.cells.filter((c) => c !== "").map((c) => cut(c, 60)).slice(0, 14), refs: s ? [s] : [] }); }
      return out;
    },
  },
];

export const SCOPES = ["all", "stock", "orders", "money", "mail", "tally", "documents", "sheets"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABEL: Record<Scope, string> = { all: "Everything", stock: "Stock", orders: "Orders and dispatch", money: "Money", mail: "Mail and leads", tally: "Tally", documents: "Documents", sheets: "Sheets" };
// the "Look in" choice narrows which lookups the model may use: faster, cheaper and it cannot wander
const SCOPE_OF: Record<string, Scope> = {
  stock_check: "stock", stock_summary: "stock", stock_age: "stock", stock_movements: "stock", plate_lookup: "stock", overview: "all",
  orders_search: "orders", order_detail: "orders", dispatch_search: "orders",
  receivables: "money", payables: "money", invoices_search: "money", payments_search: "money",
  leads_mail_quotes: "mail", tally_voucher: "tally", tally_party: "tally", invoice_trail: "tally", paperwork_gaps: "tally",
  documents_search: "documents", drafts_search: "documents", count_status: "documents", sheet_search: "sheets", go_to: "all",
};

/** Which lookups a role may use, within the chosen "Look in". The database's own row rules apply on top, so a mistake here still cannot open more than the person may read. */
export function toolsFor(role: string | undefined, scope: Scope = "all"): Tool[] {
  return TOOLS.filter((t) => t.name === "go_to" || (t.who === "all" || (t.who === "docs" && canUploadDocs(role)) || (t.who === "admin" && canSeeBusiness(role)) || (t.who === "owner" && canExport(role))) && (scope === "all" || SCOPE_OF[t.name] === scope));
}

/** A lookup's result as text for the AI, cut to a safe size. The text is data, never instructions. */
export function asText(result: unknown): string {
  const s = JSON.stringify(result, (_k, v) => (typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v));
  return s.length > 9000 ? s.slice(0, 9000) + '…"(cut)' : s;
}
