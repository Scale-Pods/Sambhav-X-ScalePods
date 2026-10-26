-- 34: purchase invoices and mill certificates through the document reader.
-- A confirmed vendor (purchase) invoice becomes a DRAFT purchase invoice (same drafts area as customer orders, apart from the future purchase-invoice module).
-- A confirmed mill test certificate is filed in `certificates` and linked to the plates in `lots` that carry its heat or plate numbers (`lot_certificates`):
-- a link is only made where a plate really matches; nothing is created for numbers we do not hold.

alter type public.draft_kind add value if not exists 'purchase_invoice';
alter table public.drafts add column extra jsonb;
alter table public.draft_lines
  add column hsn_code text,
  add column heat_no  text,
  add column plate_no text;
create unique index certificates_document on public.certificates (document_id) where document_id is not null;

create or replace function app.make_invoice_draft(p_doc uuid, p_final jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents; v_id uuid; v_led text; l jsonb; i integer := 0; v_gst text := upper(btrim(coalesce(p_final->>'vendor_gstin', ''))); v_name text := btrim(coalesce(p_final->>'vendor_name', ''));
begin
  select * into d from public.documents where id = p_doc;
  if not found or d.duplicate_of is not null then return null; end if;
  if coalesce(p_final->>'direction', '') <> 'we_are_buyer' then return null; end if;   -- our own sales invoices are not purchase drafts
  if jsonb_typeof(p_final->'lines') <> 'array' or jsonb_array_length(p_final->'lines') = 0 then return null; end if;

  if v_gst <> '' then
    select name into v_led from public.tally_ledgers where deleted_at is null and gstin = v_gst order by (parent_group ilike 'SUNDRY CREDITORS%') desc, name limit 1;
  end if;
  if v_led is null and v_name <> '' then
    select name into v_led from public.tally_ledgers where deleted_at is null
       and app.norm_text(regexp_replace(name, '\s*\((Sale|Pur|Rent)\)\s*$', '', 'i')) = app.norm_text(v_name) order by (parent_group ilike 'SUNDRY CREDITORS%') desc, name limit 1;
  end if;

  insert into public.drafts (document_id, kind, customer_name, customer_gstin, tally_ledger, po_no, doc_no, doc_date, payment_terms, total_amount, created_by, extra)
  values (p_doc, 'purchase_invoice', nullif(v_name, ''), nullif(v_gst, ''), v_led, nullif(btrim(p_final->>'buyer_order_no'), ''), nullif(btrim(p_final->>'invoice_no'), ''),
          case when (p_final->>'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$' then (p_final->>'invoice_date')::date end, nullif(btrim(p_final->>'payment_terms'), ''),
          app.to_num(p_final->>'total_amount'), app.my_staff_id(),
          jsonb_strip_nulls(jsonb_build_object('irn', nullif(p_final->>'irn', ''), 'ack_no', nullif(p_final->>'ack_no', ''), 'eway_bill_no', nullif(p_final->>'eway_bill_no', ''),
            'vehicle_no', nullif(p_final->>'vehicle_no', ''), 'taxable_value', app.to_num(p_final->>'taxable_value'), 'cgst', app.to_num(p_final->>'cgst'),
            'sgst', app.to_num(p_final->>'sgst'), 'igst', app.to_num(p_final->>'igst'), 'buyer_name', nullif(p_final->>'buyer_name', ''), 'buyer_gstin', nullif(p_final->>'buyer_gstin', ''))))
  on conflict (document_id) do nothing returning id into v_id;
  if v_id is null then return null; end if;

  for l in select * from jsonb_array_elements(p_final->'lines') loop
    i := i + 1;
    insert into public.draft_lines (draft_id, line_no, description, grade_raw, grade_id, thickness_mm, width_mm, length_mm, quantity, unit_code, weight_kg, rate, rate_unit, amount, hsn_code, heat_no, plate_no)
    values (v_id, i, nullif(btrim(l->>'description'), ''), nullif(btrim(l->>'grade'), ''),
            (select g.id from public.grades g where app.norm_text(g.code) = app.norm_text(l->>'grade')
              union all select a.grade_id from public.grade_aliases a where a.alias_norm = app.norm_text(l->>'grade') limit 1),
            app.to_num(l->>'thickness_mm'), app.to_num(l->>'width_mm'), app.to_num(l->>'length_mm'), app.to_num(l->>'pieces'),
            case when app.to_num(l->>'pieces') is null then null else 'nos' end, app.to_num(l->>'weight_kg'), app.to_num(l->>'rate'),
            case when l->>'rate_unit' in ('not_shown', '') then null else l->>'rate_unit' end, app.to_num(l->>'amount'),
            nullif(btrim(l->>'hsn'), ''), nullif(btrim(l->>'heat_no'), ''), nullif(btrim(l->>'plate_no'), ''));
  end loop;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, source_document_id, note)
  values ('staff', app.my_staff_id(), 'draft_created', 'drafts', v_id, p_doc, 'purchase_invoice');
  return v_id;
end $$;
revoke all on function app.make_invoice_draft(uuid, jsonb) from public, anon, authenticated;

create or replace function app.link_certificate(p_doc uuid, p_final jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cert uuid; v_type public.cert_type; it jsonb; v_links integer := 0; n integer; v_heat text; v_plate text;
begin
  if jsonb_typeof(p_final->'items') <> 'array' or jsonb_array_length(p_final->'items') = 0 then return 0; end if;
  v_type := case p_final->>'cert_kind' when 'ibr' then 'ibr' when 'consignment_mtc' then 'consignment_mtc' else 'mill_tc' end;
  insert into public.certificates (cert_type, cert_no, document_id, issued_on, notes)
  values (v_type, nullif(btrim(p_final->>'certificate_no'), ''), p_doc,
          case when (p_final->>'issue_date') ~ '^\d{4}-\d{2}-\d{2}$' then (p_final->>'issue_date')::date end,
          nullif(btrim(concat_ws(' | ', nullif(p_final->>'mill_name', ''), nullif(p_final->>'specification', ''), nullif(p_final->>'grade', ''))), ''))
  on conflict (document_id) where document_id is not null do nothing returning id into v_cert;
  if v_cert is null then return 0; end if;
  for it in select * from jsonb_array_elements(p_final->'items') loop
    n := 0;
    v_heat := app.norm_text(it->>'heat_no'); v_plate := app.norm_text(it->>'plate_no');
    if v_plate <> '' and exists (select 1 from public.lots where app.norm_text(plate_no) = v_plate) then
      insert into public.lot_certificates (lot_id, certificate_id) select id, v_cert from public.lots where app.norm_text(plate_no) = v_plate on conflict do nothing;
    elsif v_heat <> '' then
      insert into public.lot_certificates (lot_id, certificate_id) select id, v_cert from public.lots where app.norm_text(heat_no) = v_heat on conflict do nothing;
    end if;
    get diagnostics n = row_count; v_links := v_links + n;
  end loop;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, source_document_id, note)
  values ('staff', app.my_staff_id(), 'certificate_filed', 'certificates', v_cert, p_doc, v_links || ' plate link(s)');
  return v_links;
end $$;
revoke all on function app.link_certificate(uuid, jsonb) from public, anon, authenticated;

-- the family of document decides what a confirmation produces: customer orders and enquiries a draft, vendor invoices a draft, certificates plate links
create or replace function public.review_document(p_doc uuid, p_decision text, p_final jsonb, p_changes jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.documents; v_draft uuid; v_fam text := coalesce(p_final->>'family', 'po');
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot review documents' using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('confirmed', 'corrected', 'rejected') then raise exception 'Unknown decision'; end if;
  select * into d from public.documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  if d.review_status <> 'pending' then raise exception 'This document has already been reviewed'; end if;
  if d.extraction_status not in ('needs_review', 'failed') then raise exception 'This document has not been read yet'; end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'Say why you are rejecting it'; end if;
  insert into public.document_reviews (document_id, decision, final, changes, note, reviewer_id)
  values (p_doc, p_decision, case when p_decision = 'rejected' then null else p_final end, coalesce(p_changes, '[]'), nullif(btrim(p_note), ''), app.my_staff_id());
  update public.documents set review_status = case when p_decision = 'rejected' then 'rejected' else 'confirmed' end,
                              reviewed_by = app.my_staff_id(), reviewed_at = now()
   where id = p_doc;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, source_document_id, after_data, note)
  values ('staff', app.my_staff_id(), 'document_' || p_decision, 'documents', p_doc, p_doc, p_final, nullif(btrim(p_note), ''));
  if p_decision <> 'rejected' and p_final is not null then
    if v_fam = 'invoice' then v_draft := app.make_invoice_draft(p_doc, p_final);
    elsif v_fam = 'mtc' then perform app.link_certificate(p_doc, p_final);
    else v_draft := app.make_draft(p_doc, p_final);
    end if;
  end if;
  return v_draft;
end $$;
revoke execute on function public.review_document(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.review_document(uuid, text, jsonb, jsonb, text) to authenticated;
