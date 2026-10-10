-- 0008 read-only Tally reflection, GST cross-check, Google Sheets backup log, WhatsApp CRM
-- Direction for Tally is ONE WAY: Tally -> here. Nothing in these tables is ever written back to Tally.

-- ---------------------------------------------------------------- Tally
create table public.tally_companies (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities (id),
  tally_name    text not null,
  tally_guid    text unique,
  fy_label      text,
  last_sync_at  timestamptz,
  last_status   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.tally_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.tally_companies (id),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  records_in    integer,
  high_water_mark text,                  -- Tally AlterID of the last record read
  error         text,
  trigger_type  text not null default 'schedule' check (trigger_type in ('schedule', 'manual', 'upload'))
);
create index tally_sync_runs_company on public.tally_sync_runs (company_id, started_at desc);

create table public.tally_ledgers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.tally_companies (id),
  tally_guid    text not null,
  name          text not null,
  parent_group  text,
  gstin         text,
  state         text,
  party_id      uuid references public.parties (id),     -- matched customer / vendor
  closing_balance numeric(16, 2),
  updated_at    timestamptz not null default now(),
  unique (company_id, tally_guid)
);
create index tally_ledgers_party on public.tally_ledgers (party_id);

create table public.tally_vouchers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.tally_companies (id),
  tally_guid    text not null,
  alter_id      bigint,
  voucher_type  text not null,            -- Sales, Purchase, Receipt, Payment, Credit Note, Debit Note, Journal ...
  voucher_no    text,
  voucher_date  date not null,
  party_ledger  text,
  amount        numeric(16, 2),
  narration     text,
  is_cancelled  boolean not null default false,
  raw           jsonb,
  updated_at    timestamptz not null default now(),
  unique (company_id, tally_guid)
);
create index tally_vouchers_date on public.tally_vouchers (company_id, voucher_type, voucher_date desc);
create index tally_vouchers_no on public.tally_vouchers (voucher_no);

create table public.tally_voucher_items (
  id           uuid primary key default gen_random_uuid(),
  voucher_id   uuid not null references public.tally_vouchers (id) on delete cascade,
  line_no      integer not null,
  item_name    text,
  description  text,                      -- where heat / plate numbers appear (to be confirmed with Sambhav, question G2)
  quantity     numeric(14, 3),
  unit         text,
  rate         numeric(14, 3),
  amount       numeric(16, 2),
  hsn_code     text,
  unique (voucher_id, line_no)
);

create table public.tally_outstanding_bills (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.tally_companies (id),
  kind          text not null check (kind in ('receivable', 'payable')),
  party_ledger  text not null,
  bill_ref      text,
  bill_date     date,
  due_date      date,
  pending_amount numeric(16, 2) not null,
  as_of         date not null,
  voucher_id    uuid references public.tally_vouchers (id)
);
create index tally_outstanding_party on public.tally_outstanding_bills (company_id, kind, party_ledger, as_of desc);

alter table public.sales_invoices
  add constraint sales_invoices_tally_fk foreign key (tally_voucher_id) references public.tally_vouchers (id);
alter table public.purchase_invoices
  add constraint purchase_invoices_tally_fk foreign key (tally_voucher_id) references public.tally_vouchers (id);

-- ---------------------------------------------------------------- GST cross-check (filed data is the benchmark)
create table public.gst_return_files (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references public.entities (id),
  return_type  text not null check (return_type in ('GSTR-2B', 'GSTR-1')),
  period       date not null,              -- first day of the tax month
  document_id  uuid references public.documents (id),
  route        text not null default 'upload' check (route in ('upload', 'api')),
  uploaded_by  uuid references public.staff (id),
  uploaded_at  timestamptz not null default now(),
  unique (entity_id, return_type, period)
);

create table public.gst_return_lines (
  id                   uuid primary key default gen_random_uuid(),
  file_id              uuid not null references public.gst_return_files (id) on delete cascade,
  counterparty_gstin   text,
  counterparty_name    text,
  invoice_no           text,
  invoice_date         date,
  taxable_value        numeric(16, 2),
  igst                 numeric(16, 2),
  cgst                 numeric(16, 2),
  sgst                 numeric(16, 2),
  matched_purchase_invoice_id uuid references public.purchase_invoices (id),
  matched_sales_invoice_id    uuid references public.sales_invoices (id),
  match_status         text not null default 'unchecked'
                       check (match_status in ('unchecked', 'matched', 'different', 'missing_in_system', 'missing_in_filing')),
  difference           jsonb
);
create index gst_return_lines_file on public.gst_return_lines (file_id, match_status);

-- ---------------------------------------------------------------- Google Sheets: live read-only backup
create table public.sheets_backup_targets (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                   -- e.g. 'Purchase', 'Sales', 'Balance', 'Summary'
  entity_id      uuid references public.entities (id),
  stock_book_id  uuid references public.stock_books (id),
  spreadsheet_id text,
  tab_name       text,
  last_written_at timestamptz,
  active         boolean not null default true
);

create table public.sheets_write_log (
  id          bigint generated always as identity primary key,
  target_id   uuid not null references public.sheets_backup_targets (id),
  at          timestamptz not null default now(),
  status      text not null check (status in ('ok', 'failed')),
  rows_written integer,
  error       text
);
create index sheets_write_log_target on public.sheets_write_log (target_id, at desc);

-- ---------------------------------------------------------------- WhatsApp CRM (drafts open in the salesperson's WhatsApp; a person presses send)
create table public.whatsapp_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  language    text not null default 'en',
  purpose     text,                          -- followup, order_confirmed, dispatched, delivered, internal_alert ...
  body        text not null,
  meta_status text not null default 'draft' check (meta_status in ('draft', 'submitted', 'approved', 'rejected')),
  active      boolean not null default true,
  unique (name, language)
);

create table public.whatsapp_messages (
  id            uuid primary key default gen_random_uuid(),
  direction     text not null check (direction in ('in', 'out')),
  wa_number     text not null,
  party_id      uuid references public.parties (id),
  staff_id      uuid references public.staff (id),
  template_id   uuid references public.whatsapp_templates (id),
  body          text,
  media_document_id uuid references public.documents (id),     -- e.g. outward slip photo
  related_table text,
  related_id    uuid,
  status        text not null default 'draft' check (status in ('draft', 'sent', 'delivered', 'read', 'failed', 'received')),
  provider_message_id text,
  created_at    timestamptz not null default now()
);
create index whatsapp_messages_party on public.whatsapp_messages (party_id, created_at desc);
