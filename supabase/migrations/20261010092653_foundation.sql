-- 0001 foundation: extensions, helper schema, shared enums, generic triggers
-- Conventions: uuid PKs; timestamptz; snake_case plural tables; every table has RLS (see 0009);
-- ledger tables are append-only; nothing business-critical is edited in place.

create extension if not exists pg_trgm with schema extensions;
create schema if not exists app;

-- ---------------------------------------------------------------- helpers
create or replace function app.norm_text(t text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]+', '', 'g')
$$;

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: the table is append-only (post a reversal / correcting entry instead)',
    tg_op, tg_table_name using errcode = 'restrict_violation';
end $$;

-- ---------------------------------------------------------------- shared enums
create type public.app_role as enum
  ('owner', 'admin', 'approver', 'accounts', 'sales', 'office', 'viewer', 'partner_rs');

create type public.doc_type as enum
  ('purchase_invoice', 'packing_list', 'mtc', 'ibr', 'customer_po', 'sales_invoice', 'outward_slip',
   'delivery_note', 'quotation', 'rfq', 'bank_statement', 'gst_return', 'tally_export', 'lab_report',
   'lr', 'other');

create type public.doc_source as enum ('upload', 'gmail', 'whatsapp', 'drive', 'tally', 'system');

create type public.match_key_type as enum ('heat_no', 'plate_no', 'unknown');

create type public.party_role as enum
  ('customer', 'vendor', 'mill', 'broker', 'transporter', 'courier', 'lab', 'other');

create type public.approval_kind as enum
  ('purchase_intake', 'sales_dispatch', 'offcut', 'stock_adjustment', 'count_posting', 'gst_difference',
   'client_merge', 'ownership_clash', 'quotation_outcome', 'other');

create type public.approval_status as enum ('pending', 'approved', 'rejected', 'corrected', 'superseded');
create type public.risk_tier as enum ('low', 'medium', 'high');

create type public.exception_kind as enum
  ('failed_sync', 'stale_tally', 'gst_difference', 'blocked_entry', 'ownership_clash', 'sheets_write_failed',
   'duplicate_document', 'duplicate_key', 'weight_warning', 'legacy_data', 'other');
create type public.severity as enum ('info', 'warning', 'error');
