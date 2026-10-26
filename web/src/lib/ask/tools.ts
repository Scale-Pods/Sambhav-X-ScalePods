import "server-only";
import { q } from "../db";
import { canExport, canUploadDocs } from "../auth";
import { stockFit } from "../stockfit";

// The only things the Ask box may do: fixed, read-only lookups. The AI picks one and fills in its few parameters; it never writes SQL.
// Every lookup runs as the signed-in person (the database's row rules still apply) and returns a small, trimmed set of rows.

export type Who = "all" | "docs" | "admin"; // everyone internal / people who work with documents / owner and administrators
export type Tool = {
  name: string;
  description: string;
  schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  who: Who;
  run: (i: Record<string, unknown>) => Promise<unknown>;
};

const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const numv = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN; return Number.isFinite(n) ? n : null; };
const day = (v: unknown) => { const s = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const limit = (v: unknown, dflt = 15, max = 30) => Math.max(1, Math.min(max, Math.round(numv(v) ?? dflt)));
const like = (s: string) => (s ? `%${s.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null);
const cut = (s: string | null, n = 160) => (s && s.length > n ? s.slice(0, n) + "…" : s);

const P = { type: "string" } as const;
const N = { type: "number" } as const;
const DATE = { type: "string", description: "YYYY-MM-DD" } as const;

export const TOOLS: Tool[] = [
  {
    name: "stock_check",
    who: "all",
    description: "Do we have this plate in stock? Same grade, thickness (within 0.05 mm) and big enough (width and length either way round). Use for any 'do we have', 'is it available', 'can we supply' question about a plate.",
    schema: { type: "object", properties: { grade: { ...P, description: "e.g. SA 387 GR 22 CL2, SA516 Gr70, 16Mo3" }, thickness_mm: N, width_mm: N, length_mm: N, quantity: N, unit: { type: "string", enum: ["nos", "kg", "mt"], description: "unit of quantity: plates, kilograms or metric tonnes" } }, required: ["grade", "thickness_mm"] },
    async run(i) {
      const qty = numv(i.quantity), unit = str(i.unit, 3);
      const f = await stockFit({
        grade: str(i.grade), thk: numv(i.thickness_mm), width: numv(i.width_mm), length: numv(i.length_mm),
        needPcs: unit === "nos" && qty ? Math.round(qty) : null, needKg: qty && unit === "kg" ? qty : qty && unit === "mt" ? qty * 1000 : null,
      });
      const lot = (l: (typeof f.lots)[number]) => ({ plate: l.lot_no, size_mm: `${l.thickness_mm} x ${l.width_mm} x ${l.length_mm}`, kg: Math.round(l.balance_kg), pieces: l.balance_pieces, heat_no: l.heat_no, plate_no: l.plate_no, company: l.entity, exact_size: l.exact_size });
      return { verdict: f.verdict, summary: f.why, grade_read_as: f.grade.code, grade_candidates: f.grade.candidates, plates: f.plates, pieces: f.pieces, kg: Math.round(f.kg), best_plates: f.lots.slice(0, 6).map(lot), nearby_thickness: f.near.map(lot) };
    },
  },
  {
    name: "stock_summary",
    who: "all",
    description: "Plates in stock added up by grade and thickness (plates, pieces, kilograms). Optionally for one grade and/or one thickness. Use for 'how much X do we have', 'what stock do we have of grade Y'.",
    schema: { type: "object", properties: { grade: P, thickness_mm: N } },
    async run(i) {
      const grade = str(i.grade);
      return q(
        `select g.code grade, l.thickness_mm::float8 thickness_mm, count(*)::int plates, sum(greatest(coalesce(l.balance_pieces, 0), 1))::int pieces, round(sum(l.balance_kg))::int kg
           from public.v_lots_current l join public.grades g on g.id = l.grade_id
          where l.current_status = 'available' and l.balance_kg > 0
            and ($1::text is null or g.code ilike $1 or g.id in (select a.grade_id from public.grade_aliases a where a.alias_norm = app.norm_text($3)))
            and ($2::numeric is null or abs(l.thickness_mm - $2) <= 0.05)
          group by 1, 2 order by kg desc limit 30`, [like(grade), numv(i.thickness_mm), grade]);
    },
  },
  {
    name: "plate_lookup",
    who: "all",
    description: "Find a plate by its heat number, plate number, test certificate number or plate (lot) number, with its status and balance.",
    schema: { type: "object", properties: { text: { ...P, description: "heat, plate, TC or lot number (part of it is fine)" } }, required: ["text"] },
    async run(i) {
      const t = str(i.text);
      return q(
        `select l.lot_no::int plate, g.code grade, l.thickness_mm::float8 thk, l.width_mm::float8 width, l.length_mm::float8 length, l.heat_no, l.plate_no, l.tc_no,
                l.current_status status, l.balance_kg::float8 kg, l.balance_pieces pieces, l.receipt_date::text received, e.code company
           from public.v_lots_current l left join public.grades g on g.id = l.grade_id left join public.entities e on e.id = l.entity_id
          where l.heat_no ilike $1 or l.plate_no ilike $1 or l.tc_no ilike $1 or l.lot_no::text = $2 order by l.receipt_date desc nulls last limit 12`, [like(t), t]);
    },
  },
  {
    name: "overview",
    who: "admin",
    description: "The headline numbers: plates and kg in stock, open orders, money to receive and to pay, sales this month, new leads this week, mails waiting. Use for 'how are we doing', 'give me the overview'.",
    schema: { type: "object", properties: {} },
    async run() {
      const [r] = await q(
        `select (select count(*)::int from public.v_lots_current where current_status = 'available' and balance_kg > 0) plates_in_stock,
                (select round(coalesce(sum(balance_kg), 0))::bigint from public.v_lots_current where current_status = 'available' and balance_kg > 0) kg_in_stock,
                (select count(*)::int from public.v_orders where status = 'Open') open_orders,
                (select round(coalesce(sum(pending), 0))::bigint from public.v_receivables where pending > 0) to_receive_rs,
                (select round(coalesce(sum(pending), 0))::bigint from public.v_payables where pending > 0) to_pay_rs,
                (select round(coalesce(sum(amount), 0))::bigint from public.v_sales_invoices where invoice_date >= date_trunc('month', current_date)) sales_this_month_rs,
                (select count(*)::int from public.v_leads where received_at >= now() - interval '7 days') leads_last_7_days,
                (select count(*)::int from public.v_mail_inbox where state = 'Pending' and no_reply is not true) mails_waiting`);
      return r;
    },
  },
  {
    name: "orders_search",
    who: "admin",
    description: "Customer orders (the Dispatch FMS): by client, PO number, order number, status or date. Returns orders with grades, status and vehicles.",
    schema: { type: "object", properties: { client: P, po_no: P, order_no: P, status: { ...P, description: "part of the status text" }, since: DATE, limit: N } },
    async run(i) {
      return q(
        `select order_no, company, salesperson, client, po_no, order_date::text, etd::text, delivery_location, lines, done_lines, status, grades, vehicles
           from public.v_orders
          where ($1::text is null or client ilike $1) and ($2::text is null or po_no ilike $2) and ($3::text is null or order_no = $3)
            and ($4::text is null or status ilike $4) and ($5::date is null or order_date >= $5::date)
          order by order_date desc nulls last limit ${limit(i.limit)}`, [like(str(i.client)), like(str(i.po_no)), str(i.order_no) || null, like(str(i.status)), day(i.since)]);
    },
  },
  {
    name: "order_detail",
    who: "admin",
    description: "All lines of one order (grade, size, quantity, rate, material source, transporter, vehicle, done).",
    schema: { type: "object", properties: { order_no: P }, required: ["order_no"] },
    async run(i) {
      return q(`select order_no, sr_no, client, po_no, grade, size, qty::float8, unit, rate::float8, material, transporter, vehicle_no, done, instructions
                  from public.v_order_lines where order_no = $1 order by sr_no limit 40`, [str(i.order_no)]);
    },
  },
  {
    name: "dispatch_search",
    who: "admin",
    description: "The vehicle register: what left, when, in which vehicle, with which invoice and weight. By vehicle number, invoice number, grade or dates.",
    schema: { type: "object", properties: { vehicle_no: P, invoice_no: P, grade: P, from: DATE, to: DATE, limit: N } },
    async run(i) {
      return q(
        `select dispatch_date::text, vehicle_no, invoice_no, grade, weight_kg::float8, plot, entity from public.v_vehicle_register
          where ($1::text is null or vehicle_no ilike $1) and ($2::text is null or invoice_no ilike $2) and ($3::text is null or grade ilike $3)
            and ($4::date is null or dispatch_date >= $4::date) and ($5::date is null or dispatch_date <= $5::date)
          order by dispatch_date desc nulls last limit ${limit(i.limit)}`, [like(str(i.vehicle_no)), like(str(i.invoice_no)), like(str(i.grade)), day(i.from), day(i.to)]);
    },
  },
  {
    name: "receivables",
    who: "admin",
    description: "Money customers owe us (from the payment sheets). Without a party: the biggest debtors and the total. With a party: that party's open invoices with due dates and days overdue.",
    schema: { type: "object", properties: { party: P, only_overdue: { type: "boolean" } } },
    async run(i) {
      const party = str(i.party);
      if (party) {
        return q(`select entity, party, invoice_no, invoice_date::text, due_date::text, amount::float8, received::float8, pending::float8, overdue_days from public.v_receivables
                   where pending > 0 and party ilike $1 order by overdue_days desc nulls last, pending desc limit 30`, [like(party)]);
      }
      return q(`select party, count(*)::int invoices, round(sum(pending))::bigint pending_rs, max(overdue_days) max_days_overdue, round(sum(pending) filter (where overdue_days > 0))::bigint overdue_rs
                  from public.v_receivables where pending > 0 ${i.only_overdue ? "and overdue_days > 0" : ""} group by party order by sum(pending) desc limit 15`);
    },
  },
  {
    name: "payables",
    who: "admin",
    description: "Money we owe vendors. Without a vendor: the biggest creditors. With a vendor: their open bills with due dates.",
    schema: { type: "object", properties: { vendor: P } },
    async run(i) {
      const vendor = str(i.vendor);
      if (vendor) {
        return q(`select entity, vendor, invoice_no, invoice_date::text, due_date::text, amount::float8, advance::float8, pending::float8, overdue_days from public.v_payables
                   where pending > 0 and vendor ilike $1 order by due_date nulls last limit 30`, [like(vendor)]);
      }
      return q(`select vendor, count(*)::int bills, round(sum(pending))::bigint pending_rs, max(overdue_days) max_days_overdue
                  from public.v_payables where pending > 0 group by vendor order by sum(pending) desc limit 15`);
    },
  },
  {
    name: "invoices_search",
    who: "admin",
    description: "Sales or purchase invoices (from the payment sheets) by party, invoice number or dates, with amounts.",
    schema: { type: "object", properties: { kind: { type: "string", enum: ["sales", "purchase"] }, party: P, invoice_no: P, from: DATE, to: DATE, limit: N }, required: ["kind"] },
    async run(i) {
      const sales = str(i.kind) === "sales";
      return q(
        sales
          ? `select entity, invoice_no, invoice_date::text, client party, amount::float8, po_no, transporter, due_date::text from public.v_sales_invoices
              where ($1::text is null or client ilike $1) and ($2::text is null or invoice_no ilike $2) and ($3::date is null or invoice_date >= $3::date) and ($4::date is null or invoice_date <= $4::date)
              order by invoice_date desc nulls last limit ${limit(i.limit)}`
          : `select entity, invoice_no, invoice_date::text, vendor party, amount::float8, weight::float8 weight_kg, rate::float8, due_date::text from public.v_purchase_invoices
              where ($1::text is null or vendor ilike $1) and ($2::text is null or invoice_no ilike $2) and ($3::date is null or invoice_date >= $3::date) and ($4::date is null or invoice_date <= $4::date)
              order by invoice_date desc nulls last limit ${limit(i.limit)}`,
        [like(str(i.party)), like(str(i.invoice_no)), day(i.from), day(i.to)]);
    },
  },
  {
    name: "payments_search",
    who: "admin",
    description: "GPay / UPI payments entered by the team: description, for whom, amount, who paid, date.",
    schema: { type: "object", properties: { text: P, from: DATE, to: DATE, limit: N } },
    async run(i) {
      return q(`select entered_at::date::text as day, description, for_whom, amount::float8, paid_by from public.v_gpay_payments
                 where ($1::text is null or description ilike $1 or for_whom ilike $1 or paid_by ilike $1) and ($2::date is null or entered_at >= $2::date) and ($3::date is null or entered_at < $3::date + 1)
                 order by entered_at desc nulls last limit ${limit(i.limit)}`, [like(str(i.text)), day(i.from), day(i.to)]);
    },
  },
  {
    name: "leads_mail_quotes",
    who: "admin",
    description: "Leads (IndiaMART etc.), the mail inbox tracker, or quotations sent: search by text. kind = leads | mail | quotations.",
    schema: { type: "object", properties: { kind: { type: "string", enum: ["leads", "mail", "quotations"] }, text: P, status: P, limit: N }, required: ["kind"] },
    async run(i) {
      const t = like(str(i.text)), n = limit(i.limit, 10, 20);
      switch (str(i.kind)) {
        case "leads":
          return (await q<Record<string, string | null>>(`select received_at::date::text as day, name, company, city, state, product, mobile, left(message, 200) message from public.v_leads
            where ($1::text is null or name ilike $1 or company ilike $1 or product ilike $1 or city ilike $1 or message ilike $1) order by received_at desc nulls last limit ${n}`, [t]));
        case "mail":
          return q(`select received_at::date::text as day, from_name, from_email, subject, status, days, remarks, marked_done, no_reply from public.v_mail_inbox
            where ($1::text is null or subject ilike $1 or from_name ilike $1 or from_email ilike $1 or remarks ilike $1) and ($2::text is null or status ilike $2) order by received_at desc nulls last limit ${n}`, [t, like(str(i.status))]);
        case "quotations":
          return q(`select quote_no, client_name, quoted_at::date::text as day, material, qty, price::float8, status, order_value::float8, lost_reason, remarks from public.v_quotations
            where ($1::text is null or client_name ilike $1 or material ilike $1 or quote_no ilike $1 or subject ilike $1) and ($2::text is null or status ilike $2) order by quoted_at desc nulls last limit ${n}`, [t, like(str(i.status))]);
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
    async run(i) {
      return q(
        `select v.voucher_no, v.voucher_date::text date, v.voucher_type type, v.party_ledger party, v.amount::float8 amount, v.is_cancelled cancelled, left(v.irn, 12) irn_start, v.eway_bill_no, v.vehicle_no,
                v.buyer_order_no, v.shipped_by,
                (select string_agg(coalesce(i.item_name, '?') || ' ' || coalesce(i.quantity::text, '') || ' ' || coalesce(i.unit, '') || ' @' || coalesce(i.rate::text, ''), '; ' order by i.line_no) from public.tally_voucher_items i where i.voucher_id = v.id) items
           from public.tally_vouchers v
          where v.deleted_at is null and ($1::text is null or v.voucher_no ilike $1) and ($2::text is null or v.irn ilike $2) and ($3::text is null or v.eway_bill_no = $3)
            and ($4::text is null or v.vehicle_no ilike $4) and ($5::text is null or v.party_ledger ilike $5) and ($6::text is null or v.voucher_type ilike $6)
            and ($7::date is null or v.voucher_date >= $7::date) and ($8::date is null or v.voucher_date <= $8::date)
          order by v.voucher_date desc limit ${limit(i.limit, 8, 15)}`,
        [like(str(i.voucher_no)), like(str(i.irn)), str(i.eway_bill_no) || null, like(str(i.vehicle_no)), like(str(i.party)), str(i.type) || null, day(i.from), day(i.to)]);
    },
  },
  {
    name: "tally_party",
    who: "admin",
    description: "A customer or vendor in Tally: the ledger balance (positive = they owe us, negative = we owe them), GSTIN, and the open bills.",
    schema: { type: "object", properties: { name: P }, required: ["name"] },
    async run(i) {
      const n = like(str(i.name));
      const ledgers = await q(`select name, parent_group, gstin, state, closing_balance::float8 balance_rs from public.tally_ledgers where deleted_at is null and name ilike $1 order by abs(coalesce(closing_balance, 0)) desc limit 6`, [n]);
      const bills = await q(`select kind, party_ledger party, count(*)::int bills, round(sum(pending_amount))::bigint pending_rs, min(due_date)::text oldest_due from public.tally_outstanding_bills where party_ledger ilike $1 group by 1, 2 order by 4 desc limit 8`, [n]);
      return { ledgers, open_bills: bills };
    },
  },
  {
    name: "documents_search",
    who: "docs",
    description: "Uploaded documents (POs, enquiries) and their review status, with what was read: buyer, number, date, total.",
    schema: { type: "object", properties: { status: { type: "string", enum: ["to_review", "reviewed", "not_read", "all"] }, text: P, limit: N } },
    async run(i) {
      const s = str(i.status, 10);
      const where = s === "reviewed" ? "d.review_status <> 'pending'" : s === "not_read" ? "d.extraction_status = 'failed' and d.review_status = 'pending'" : s === "all" ? "true" : "d.review_status = 'pending' and d.extraction_status in ('pending', 'needs_review') and d.duplicate_of is null";
      return q(
        `select d.original_filename file, d.created_at::date::text uploaded, d.extraction_status read_state, d.review_status review_state, d.extracted->>'doc_kind' kind, nullif(d.extracted->>'buyer_name', '') buyer,
                coalesce(nullif(d.extracted->>'po_number', ''), nullif(d.extracted->>'document_number', '')) ref, coalesce(nullif(d.extracted->>'total_amount', ''), nullif(d.extracted->>'net_amount', '')) total
           from public.documents d where ${where} and ($1::text is null or d.original_filename ilike $1 or d.extracted->>'buyer_name' ilike $1)
          order by d.created_at desc limit ${limit(i.limit)}`, [like(str(i.text))]);
    },
  },
  {
    name: "count_status",
    who: "docs",
    description: "The physical stock counts: recent sessions, their status and how many plates were counted or are still to check.",
    schema: { type: "object", properties: {} },
    async run() {
      return q(`select s.name, b.code book, s.status, s.planned_date::text planned, s.started_at::date::text started, s.closed_at::date::text closed,
                       (select count(*)::int from public.count_lines c where c.session_id = s.id) lines_counted
                  from public.count_sessions s left join public.stock_books b on b.id = s.stock_book_id order by s.created_at desc limit 6`);
    },
  },
  {
    name: "sheet_search",
    who: "admin",
    description: "Last resort: search any text across all the copied Google sheets (every tab). Use only when no other lookup fits. Returns the sheet, tab, row number and the row's cells.",
    schema: { type: "object", properties: { text: P, sheet: { ...P, description: "optional sheet key to limit the search" } }, required: ["text"] },
    async run(i) {
      const rows = await q<{ source_key: string; tab: string; row_no: number; cells: string[] }>(
        `select source_key, tab, row_no, cells from public.sheet_rows where deleted_at is null and ($2::text is null or source_key = $2) and cells::text ilike $1 order by source_key, tab, row_no limit 8`, [like(str(i.text, 60)), str(i.sheet, 40) || null]);
      return rows.map((r) => ({ sheet: r.source_key, tab: r.tab, row: r.row_no, cells: r.cells.filter((c) => c !== "").map((c) => cut(c, 60)).slice(0, 14) }));
    },
  },
];

/** Which lookups a role may use. The database's own row rules apply on top, so a mistake here still cannot open more than the person may read. */
export function toolsFor(role: string | undefined): Tool[] {
  return TOOLS.filter((t) => t.who === "all" || (t.who === "docs" && canUploadDocs(role)) || (t.who === "admin" && canExport(role)));
}

/** A lookup's result as text for the AI, cut to a safe size. The text is data, never instructions. */
export function asText(result: unknown): string {
  const s = JSON.stringify(result, (_k, v) => (typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v));
  return s.length > 9000 ? s.slice(0, 9000) + '…"(cut)' : s;
}
