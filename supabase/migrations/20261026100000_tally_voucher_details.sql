-- 24: the invoice details a Tally voucher carries besides its lines (found with the connector's Dump mode on invoice 730/26-27):
-- e-invoice acknowledgement, e-way bill number and validity, vehicle, how it was dispatched, the buyer's order note, the party's GSTIN and
-- place of supply; and the HSN code of every item line. They are what a document (invoice, e-way bill) is matched against.
alter table public.tally_vouchers
  add column irn_ack_no     text,
  add column shipped_by     text,
  add column vehicle_no     text,
  add column eway_bill_no   text,
  add column eway_valid_upto text,       -- Tally's own text, yyyyMMddHHmmss...
  add column buyer_order_no text,
  add column party_gstin    text,
  add column place_of_supply text;

create or replace function public.tally_ingest_vouchers(p_key text, p_company text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int; m int := 0; r record;
begin
  create temp table _tv on commit drop as
  select x.guid, x.alter_id, x.vtype, x.vno, to_date(x.vdate, 'YYYYMMDD') vdate, x.party, x.amount, x.narration, coalesce(x.cancelled, false) cancelled,
         x.reference, x.irn, x.entered_by, x.entries, x.items,
         x.ack_no, x.shipped_by, x.vehicle, x.eway_no, x.eway_until, x.order_no, x.gstin, x.pos
  from jsonb_to_recordset(p_items) as x(guid text, alter_id bigint, vtype text, vno text, vdate text, party text, amount numeric, narration text,
                                        cancelled boolean, reference text, irn text, entered_by text, entries jsonb, items jsonb,
                                        ack_no text, shipped_by text, vehicle text, eway_no text, eway_until text, order_no text, gstin text, pos text)
  where coalesce(x.guid, '') <> '' and coalesce(x.vtype, '') <> '' and coalesce(x.vdate, '') <> '';

  insert into public.tally_vouchers (company_id, tally_guid, alter_id, voucher_type, voucher_no, voucher_date, party_ledger, amount, narration, is_cancelled,
                                     reference, irn, entered_by, entries, updated_at, deleted_at,
                                     irn_ack_no, shipped_by, vehicle_no, eway_bill_no, eway_valid_upto, buyer_order_no, party_gstin, place_of_supply)
  select v_co, guid, alter_id, vtype, nullif(vno, ''), vdate, nullif(party, ''), amount, nullif(narration, ''), cancelled, nullif(reference, ''), nullif(irn, ''),
         nullif(entered_by, ''), entries, now(), null,
         nullif(ack_no, ''), nullif(shipped_by, ''), nullif(vehicle, ''), nullif(eway_no, ''), nullif(eway_until, ''), nullif(order_no, ''), nullif(gstin, ''), nullif(pos, '')
  from _tv
  on conflict (company_id, tally_guid) do update set alter_id = excluded.alter_id, voucher_type = excluded.voucher_type, voucher_no = excluded.voucher_no,
    voucher_date = excluded.voucher_date, party_ledger = excluded.party_ledger, amount = excluded.amount, narration = excluded.narration,
    is_cancelled = excluded.is_cancelled, reference = excluded.reference, irn = excluded.irn, entered_by = excluded.entered_by, entries = excluded.entries,
    irn_ack_no = excluded.irn_ack_no, shipped_by = excluded.shipped_by, vehicle_no = excluded.vehicle_no, eway_bill_no = excluded.eway_bill_no,
    eway_valid_upto = excluded.eway_valid_upto, buyer_order_no = excluded.buyer_order_no, party_gstin = excluded.party_gstin, place_of_supply = excluded.place_of_supply,
    updated_at = now(), deleted_at = null;
  get diagnostics n = row_count;

  -- item lines are replaced as a set (a voucher edited in Tally may have fewer lines than before)
  delete from public.tally_voucher_items where voucher_id in (select v.id from public.tally_vouchers v join _tv t on t.guid = v.tally_guid where v.company_id = v_co);
  insert into public.tally_voucher_items (voucher_id, line_no, item_name, description, quantity, unit, rate, amount, hsn_code, godown, batch)
  select v.id, e.ord::int, nullif(e.obj->>'item', ''), nullif(e.obj->>'descr', ''), nullif(e.obj->>'qty', '')::numeric, nullif(e.obj->>'unit', ''),
         nullif(e.obj->>'rate', '')::numeric, nullif(e.obj->>'amount', '')::numeric, nullif(e.obj->>'hsn', ''), nullif(e.obj->>'godown', ''), nullif(e.obj->>'batch', '')
  from _tv t join public.tally_vouchers v on v.company_id = v_co and v.tally_guid = t.guid,
       jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) with ordinality as e(obj, ord);
  get diagnostics m = row_count;
  return jsonb_build_object('vouchers', n, 'item_lines', m);
end $$;
