import "server-only";
import { q } from "./db";

// The paperwork trail of a Tally sales invoice: the customer's PO behind it, the mill certificates for the heat numbers on its lines, the dispatch
// register row, and any uploaded document carrying the same IRN or e-way bill. Everything is matched on the documents' own numbers, never on row
// positions. Read-only. Tally data is for the owner and administrators (the database enforces it).

// the customer's PO number as typed in Tally's "Buyer's Order No.": "PO NO : 4500003350" -> 4500003350; "PO NO : VERBAL" -> a verbal order
const PO_REF = `nullif(btrim(regexp_replace(coalesce(v.buyer_order_no, ''), '^\\s*PO\\s*NO\\.?\\s*[:\\-]?\\s*', '', 'i')), '')`;
const VERBAL = `^(VERBAL|BYMAIL|BYTELETALK|BYPHONE|BYWHATSAPP|WHATSAPP|TELETALK|MAIL|EMAIL|BYEMAIL|BYCALL|CALL|NA|NIL|NONE)$`;
// heat numbers on the lines: the batch name, else "HEAT NO. xxxx" in the description
const HEAT = `app.norm_text(coalesce(nullif(i.batch, ''), substring(upper(i.description) from 'HEAT\\s*NO\\.?\\s*:?\\s*([A-Z0-9\\-]+)')))`;

export type TrailRow = {
  id: string; voucher_no: string; date: string; party: string | null; amount: number; po_ref: string | null; verbal: boolean; vehicle_no: string | null; eway_bill_no: string | null; has_irn: boolean;
  po_docs: number; po_orders: number; heats: number; heats_in_stock: number; certs_filed: number; cert_docs: number; in_register: number; total: number;
};
export const TRAIL_SHOWS = ["all", "nopo", "nocert", "nodispatch"] as const;
export type TrailShow = (typeof TRAIL_SHOWS)[number];
export const TRAIL_PAGE = 50;

export async function trailList(show: TrailShow, search: string, page: number) {
  const like = search ? `%${search.replace(/[\%_]/g, (c) => "\\" + c)}%` : null;
  // every lookup table is read once (materialized) and joined set-wise: 800 invoices against the views row by row took 16 seconds
  return q<TrailRow>(`
    with base as (
      select v.id, v.voucher_no, v.voucher_date, v.party_ledger, v.amount, v.vehicle_no, v.eway_bill_no, v.irn is not null has_irn, ${PO_REF} po_ref,
             case when app.norm_text(${PO_REF}) ~ '${VERBAL}' then '' else app.norm_text(${PO_REF}) end po_n, app.norm_text(split_part(v.voucher_no, '/', 1)) inv_n
        from public.tally_vouchers v
       where v.voucher_type = 'Sales' and v.deleted_at is null and not v.is_cancelled
         and ($1::text is null or v.voucher_no ilike $1 or v.party_ledger ilike $1 or v.buyer_order_no ilike $1 or v.vehicle_no ilike $1 or v.eway_bill_no ilike $1)
    ), ord as materialized (
      select app.norm_text(po_no) n from public.v_orders where length(app.norm_text(po_no)) >= 4
    ), reg as materialized (
      select app.norm_text(invoice_no) n, dispatch_date from public.v_vehicle_register
    ), docs as materialized (
      select app.norm_text(coalesce(nullif(extracted->>'po_number', ''), extracted->>'document_number')) n from public.documents where duplicate_of is null
    ), lotheat as materialized (
      select app.norm_text(l.heat_no) h, l.id lot_id, (select count(*) from public.lot_certificates lc where lc.lot_id = l.id) certs from public.lots l where l.heat_no is not null
    ), lotcert as materialized (
      select app.norm_text(l.heat_no) h, lc.certificate_id from public.lots l join public.lot_certificates lc on lc.lot_id = l.id where l.heat_no is not null
    ), mtcdocs as materialized (
      select distinct d.id, app.norm_text(it->>'heat_no') h from public.documents d, jsonb_array_elements(coalesce(d.extracted->'items', '[]')) it where d.extracted->>'family' = 'mtc'
    ), vh as (
      select distinct i.voucher_id, ${HEAT} h from public.tally_voucher_items i where i.voucher_id in (select id from base) and ${HEAT} <> ''
    ), hs as (
      select vh.voucher_id, count(distinct vh.h)::int heats,
             count(distinct lh.lot_id)::int heats_in_stock,
             (select count(distinct lcx.certificate_id) from lotcert lcx where lcx.h in (select h from vh x where x.voucher_id = vh.voucher_id))::int certs_filed,
             (select count(distinct m.id) from mtcdocs m where m.h in (select h from vh x where x.voucher_id = vh.voucher_id))::int cert_docs
        from vh left join lotheat lh on lh.h = vh.h group by vh.voucher_id
    ), ev as (
      select b.*, coalesce(hs.heats, 0) heats, coalesce(hs.heats_in_stock, 0) heats_in_stock, coalesce(hs.certs_filed, 0) certs_filed, coalesce(hs.cert_docs, 0) cert_docs,
             case when length(b.po_n) >= 4 then (select count(*)::int from docs d where d.n = b.po_n) else 0 end po_docs,
             case when length(b.po_n) >= 4 then (select count(*)::int from ord o where o.n = b.po_n or o.n like '%' || b.po_n || '%' or b.po_n like '%' || o.n || '%') else 0 end po_orders,
             (select count(*)::int from reg g where g.n = b.inv_n and g.dispatch_date between b.voucher_date - 3 and b.voucher_date + 10) in_register
        from base b left join hs on hs.voucher_id = b.id
    ), shown as (
      select *, (po_ref is not null and app.norm_text(po_ref) ~ '${VERBAL}') verbal from ev
       where ${show === "nopo" ? "po_docs = 0 and po_orders = 0" : show === "nocert" ? "certs_filed = 0 and cert_docs = 0" : show === "nodispatch" ? "in_register = 0" : "true"}
    )
    select id, voucher_no, voucher_date::text date, party_ledger party, amount::float8 amount, po_ref, verbal, vehicle_no, eway_bill_no, has_irn, po_docs, po_orders, heats, heats_in_stock, certs_filed, cert_docs, in_register,
           count(*) over ()::int total
      from shown order by voucher_date desc, voucher_no desc limit ${TRAIL_PAGE} offset ${(Math.max(1, page) - 1) * TRAIL_PAGE}`, [like]);
}

export type Trail = {
  v: { id: string; voucher_no: string; date: string; party: string | null; amount: number; narration: string | null; irn: string | null; ack_no: string | null; eway_bill_no: string | null; eway_valid_upto: string | null;
       vehicle_no: string | null; shipped_by: string | null; buyer_order_no: string | null; party_gstin: string | null; po_ref: string | null; verbal: boolean; cancelled: boolean };
  items: { line_no: number; item_name: string | null; description: string | null; quantity: number | null; unit: string | null; rate: number | null; amount: number | null; hsn_code: string | null; heat: string }[];
  po_docs: { id: string; file: string; po: string | null; buyer: string | null; review: string }[];
  po_orders: { order_no: string; client: string | null; po_no: string | null; order_date: string | null; status: string }[];
  heats: { heat: string; lots: { lot_no: number; plate_no: string | null; status: string; certs: string[] }[]; cert_docs: { id: string; file: string; cert_no: string | null; review: string }[] }[];
  register: { dispatch_date: string; invoice_no: string; vehicle_no: string | null; weight_kg: number | null; grade: string | null; row_no: number; month_tab: string }[];
  same_numbers: { id: string; file: string; by: string }[];
};

export async function trailDetail(id: string): Promise<Trail | null> {
  const [v] = await q<Trail["v"]>(`
    select v.id, v.voucher_no, v.voucher_date::text date, v.party_ledger party, v.amount::float8 amount, v.narration, v.irn, v.irn_ack_no ack_no, v.eway_bill_no, v.eway_valid_upto, v.vehicle_no,
           v.shipped_by, v.buyer_order_no, v.party_gstin, ${PO_REF} po_ref, coalesce(app.norm_text(${PO_REF}) ~ '${VERBAL}', false) verbal, v.is_cancelled cancelled
      from public.tally_vouchers v where v.id = $1::uuid and v.deleted_at is null`, [id]);
  if (!v) return null;
  const items = await q<Trail["items"][number]>(`
    select i.line_no, i.item_name, i.description, i.quantity::float8 quantity, i.unit, i.rate::float8 rate, i.amount::float8 amount, i.hsn_code,
           coalesce(nullif(i.batch, ''), substring(upper(i.description) from 'HEAT\\s*NO\\.?\\s*:?\\s*([A-Z0-9\\-]+)'), '') heat
      from public.tally_voucher_items i where i.voucher_id = $1::uuid order by i.line_no`, [id]);
  const refNorm = (v.po_ref ?? "").replace(/[^A-Za-z0-9]/g, "");
  const poOk = refNorm.length >= 4 && !v.verbal;
  const po_docs = poOk ? await q<Trail["po_docs"][number]>(
    `select d.id, d.original_filename file, coalesce(nullif(d.extracted->>'po_number', ''), nullif(d.extracted->>'document_number', '')) po, nullif(d.extracted->>'buyer_name', '') buyer, d.review_status review
       from public.documents d where d.duplicate_of is null and app.norm_text(coalesce(nullif(d.extracted->>'po_number', ''), d.extracted->>'document_number')) = app.norm_text($1) order by d.created_at limit 5`, [v.po_ref]) : [];
  const po_orders = poOk ? await q<Trail["po_orders"][number]>(
    `select order_no, client, po_no, order_date::text order_date, status from public.v_orders
      where length(app.norm_text(po_no)) >= 4 and (app.norm_text(po_no) = app.norm_text($1) or app.norm_text(po_no) like '%' || app.norm_text($1) || '%' or app.norm_text($1) like '%' || app.norm_text(po_no) || '%')
      order by order_date desc nulls last limit 5`, [v.po_ref]) : [];

  // each heat is looked up on its own, side by side (one after another it is a dozen round trips)
  const heats: Trail["heats"] = await Promise.all([...new Set(items.map((i) => i.heat).filter(Boolean))].slice(0, 20).map(async (h) => {
    const [lots, cert_docs] = await Promise.all([
      q<{ lot_no: number; plate_no: string | null; status: string; certs: string[] | null }>(
        `select l.lot_no::int lot_no, l.plate_no, l.current_status status,
                (select array_agg(coalesce(c.cert_no, 'certificate')) from public.lot_certificates lc join public.certificates c on c.id = lc.certificate_id where lc.lot_id = l.id) certs
           from public.v_lots_current l where app.norm_text(l.heat_no) = app.norm_text($1) order by l.lot_no limit 6`, [h]),
      q<{ id: string; file: string; cert_no: string | null; review: string }>(
        `select distinct d.id, d.original_filename file, nullif(d.extracted->>'certificate_no', '') cert_no, d.review_status review
           from public.documents d, jsonb_array_elements(coalesce(d.extracted->'items', '[]')) it
          where d.extracted->>'family' = 'mtc' and app.norm_text(it->>'heat_no') = app.norm_text($1) limit 4`, [h]),
    ]);
    return { heat: h, lots: lots.map((l) => ({ ...l, certs: l.certs ?? [] })), cert_docs };
  }));

  const register = await q<Trail["register"][number]>(
    `select dispatch_date::text dispatch_date, invoice_no, vehicle_no, weight_kg::float8 weight_kg, grade, row_no::int row_no, month_tab from public.v_vehicle_register
      where app.norm_text(invoice_no) = app.norm_text(split_part($1, '/', 1)) and dispatch_date between $2::date - 3 and $2::date + 10 order by dispatch_date limit 4`, [v.voucher_no, v.date]);

  const same = (v.irn || v.eway_bill_no)
    ? await q<Trail["same_numbers"][number]>(
        `select d.id, d.original_filename file, case when $1::text <> '' and app.norm_text(d.extracted->>'irn') = app.norm_text($1) then 'IRN' else 'e-way bill' end "by"
           from public.documents d where d.duplicate_of is null and (($1::text <> '' and app.norm_text(d.extracted->>'irn') = app.norm_text($1)) or ($2::text <> '' and d.extracted->>'eway_bill_no' = $2)) limit 5`,
        [v.irn ?? "", v.eway_bill_no ?? ""])
    : [];
  return { v, items, po_docs, po_orders, heats, register, same_numbers: same };
}

/** Tally sales invoices that mention a customer PO number (for the PO's own review screen). */
export async function invoicesForPo(po: string) {
  if (po.replace(/[^A-Za-z0-9]/g, "").length < 4) return [];
  return q<{ id: string; voucher_no: string; date: string; party: string | null; amount: number }>(
    `select v.id, v.voucher_no, v.voucher_date::text date, v.party_ledger party, v.amount::float8 amount from public.tally_vouchers v
      where v.voucher_type = 'Sales' and v.deleted_at is null and not v.is_cancelled and app.norm_text(${PO_REF}) = app.norm_text($1) order by v.voucher_date desc limit 5`, [po]);
}
