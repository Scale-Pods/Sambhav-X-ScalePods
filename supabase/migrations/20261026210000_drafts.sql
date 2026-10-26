-- 33: drafts. A document that a person has confirmed (a customer order or enquiry) becomes a DRAFT order or DRAFT quotation, kept apart from the
-- orders and quotations tables of the future modules (those need a customer record and an order number that do not exist yet).
-- A draft is made in the same step as the confirmation, so the two can never disagree. Nothing here posts to anything: a person works from the draft.

create type public.draft_kind as enum ('order', 'quotation');

create table public.drafts (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null unique references public.documents (id),
  kind           public.draft_kind not null,           -- order = a firm order; quotation = an enquiry still to be quoted
  status         text not null default 'open' check (status in ('open', 'dismissed', 'promoted')),
  customer_name  text,
  customer_gstin text,
  tally_ledger   text,                                  -- the customer's ledger in Tally, found by GSTIN or by name
  po_no          text,
  doc_no         text,
  doc_date       date,
  delivery_terms text,
  payment_terms  text,
  total_amount   numeric,
  note           text,
  created_by     uuid references public.staff (id),
  created_at     timestamptz not null default now(),
  closed_by      uuid references public.staff (id),
  closed_at      timestamptz,
  close_note     text
);
create index drafts_open on public.drafts (status, created_at desc);

create table public.draft_lines (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references public.drafts (id) on delete cascade,
  line_no     integer not null,
  description text,
  grade_raw   text,
  grade_id    uuid references public.grades (id),
  thickness_mm numeric,
  width_mm    numeric,
  length_mm   numeric,
  quantity    numeric,
  unit_code   text,
  weight_kg   numeric,
  rate        numeric,
  rate_unit   text,
  amount      numeric,
  unique (draft_id, line_no)
);

alter table public.drafts enable row level security;
alter table public.draft_lines enable row level security;
create policy documents_read on public.drafts for select to authenticated using ((select app.can_read_documents()));
create policy documents_read on public.draft_lines for select to authenticated using ((select app.can_read_documents()));

-- "1,23,456.00", "148/-", "Rs. 148" or "148" -> number; anything else -> null
create or replace function app.to_num(t text)
returns numeric language sql immutable set search_path = pg_catalog as $$
  select case when regexp_replace(regexp_replace(coalesce(t, ''), '(/-|₹|rs\.?|inr)', '', 'gi'), '[,[:space:]]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
              then regexp_replace(regexp_replace(t, '(/-|₹|rs\.?|inr)', '', 'gi'), '[,[:space:]]', '', 'g')::numeric end
$$;

create or replace function app.make_draft(p_doc uuid, p_final jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents; v_kind public.draft_kind; v_id uuid; v_led text; l jsonb; i integer := 0; v_gst text; v_name text; v_unit text;
begin
  select * into d from public.documents where id = p_doc;
  if not found or d.duplicate_of is not null then return null; end if;
  if coalesce(p_final->>'direction', '') <> 'customer_orders_from_us' then return null; end if;
  if jsonb_typeof(p_final->'lines') <> 'array' or jsonb_array_length(p_final->'lines') = 0 then return null; end if;
  v_kind := case when coalesce((p_final->>'is_firm_order')::boolean, false) then 'order' else 'quotation' end;
  v_gst := upper(btrim(coalesce(p_final->>'buyer_gstin', '')));
  v_name := btrim(coalesce(p_final->>'buyer_name', ''));

  if v_gst <> '' then
    select name into v_led from public.tally_ledgers where deleted_at is null and gstin = v_gst order by (parent_group = 'Sundry Debtors') desc, name limit 1;
  end if;
  if v_led is null and v_name <> '' then
    select name into v_led from public.tally_ledgers where deleted_at is null
       and app.norm_text(regexp_replace(name, '\s*\((Sale|Pur|Rent)\)\s*$', '', 'i')) = app.norm_text(v_name) order by (parent_group = 'Sundry Debtors') desc, name limit 1;
  end if;

  insert into public.drafts (document_id, kind, customer_name, customer_gstin, tally_ledger, po_no, doc_no, doc_date, delivery_terms, payment_terms, total_amount, created_by)
  values (p_doc, v_kind, nullif(v_name, ''), nullif(v_gst, ''), v_led, nullif(btrim(p_final->>'po_number'), ''), nullif(btrim(p_final->>'document_number'), ''),
          case when (p_final->>'po_date') ~ '^\d{4}-\d{2}-\d{2}$' then (p_final->>'po_date')::date end, nullif(btrim(p_final->>'delivery_terms'), ''),
          nullif(btrim(p_final->>'payment_terms'), ''), coalesce(app.to_num(p_final->>'total_amount'), app.to_num(p_final->>'net_amount')), app.my_staff_id())
  on conflict (document_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  for l in select * from jsonb_array_elements(p_final->'lines') loop
    i := i + 1;
    insert into public.draft_lines (draft_id, line_no, description, grade_raw, grade_id, thickness_mm, width_mm, length_mm, quantity, unit_code, weight_kg, rate, rate_unit, amount)
    values (v_id, i, nullif(btrim(l->>'description'), ''), nullif(btrim(l->>'grade'), ''),
            (select g.id from public.grades g where app.norm_text(g.code) = app.norm_text(l->>'grade')
              union all select a.grade_id from public.grade_aliases a where a.alias_norm = app.norm_text(l->>'grade') limit 1),
            app.to_num(l->>'thickness_mm'), app.to_num(l->>'width_mm'), app.to_num(l->>'length_mm'), app.to_num(l->>'qty'),
            case when l->>'qty_unit' in ('not_shown', '') then null else l->>'qty_unit' end, app.to_num(l->>'weight_kg'), app.to_num(l->>'rate'),
            case when l->>'rate_unit' in ('not_shown', '') then null else l->>'rate_unit' end, app.to_num(l->>'amount'));
  end loop;

  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, source_document_id, note)
  values ('staff', app.my_staff_id(), 'draft_created', 'drafts', v_id, p_doc, v_kind::text);
  return v_id;
end $$;
revoke all on function app.make_draft(uuid, jsonb) from public, anon, authenticated;

-- confirming a document now also returns the draft it produced (or null when it produced none)
drop function public.review_document(uuid, text, jsonb, jsonb, text);
create function public.review_document(p_doc uuid, p_decision text, p_final jsonb, p_changes jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.documents; v_draft uuid;
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
  if p_decision <> 'rejected' and p_final is not null then v_draft := app.make_draft(p_doc, p_final); end if;
  return v_draft;
end $$;
revoke execute on function public.review_document(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.review_document(uuid, text, jsonb, jsonb, text) to authenticated;

-- a person sets a draft aside (it was wrong, or the work was done another way)
create or replace function public.dismiss_draft(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot change drafts' using errcode = 'insufficient_privilege';
  end if;
  update public.drafts set status = 'dismissed', closed_by = app.my_staff_id(), closed_at = now(), close_note = nullif(btrim(p_note), '') where id = p_id and status = 'open';
  if not found then raise exception 'This draft is not open'; end if;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, note) values ('staff', app.my_staff_id(), 'draft_dismissed', 'drafts', p_id, nullif(btrim(p_note), ''));
end $$;
revoke execute on function public.dismiss_draft(uuid, text) from public, anon;
grant execute on function public.dismiss_draft(uuid, text) to authenticated;
