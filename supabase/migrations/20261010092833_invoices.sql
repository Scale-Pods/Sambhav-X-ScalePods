-- 0005 invoices: purchase invoices (create lots), sales invoices (read from Tally + workflow attributes),
-- post-invoice paperwork tracker, brokerage.  Tally stays the accounting master: nothing here is written back.

create type public.invoice_status as enum ('draft', 'pending_approval', 'posted', 'void');
create type public.purchase_kind as enum ('mill', 'market', 'other');
create type public.sales_kind as enum ('own_stock', 'supply', 'mixed', 'unknown');   -- heat/plate number on the invoice => own stock

-- ---------------------------------------------------------------- purchase invoices
create table public.purchase_invoices (
  id                       uuid primary key default gen_random_uuid(),
  entity_id                uuid not null references public.entities (id),          -- "purchased for"
  vendor_party_id          uuid not null references public.parties (id),
  kind                     public.purchase_kind not null default 'market',
  invoice_no               text not null,
  invoice_date             date not null,
  entered_at               timestamptz not null default now(),                      -- entry date is not invoice date
  irn                      text,
  taxable_value            numeric(14, 2),
  gst_amount               numeric(14, 2),
  total_amount             numeric(14, 2),
  credit_days              integer,
  due_date                 date generated always as (invoice_date + coalesce(credit_days, 0)) stored,
  broker_party_id          uuid references public.parties (id),
  purchased_by             uuid references public.staff (id),
  checked_by               uuid[] not null default '{}',
  invoice_document_id      uuid references public.documents (id),
  packing_list_document_id uuid references public.documents (id),                  -- mandatory for mill purchases before lots exist
  status                   public.invoice_status not null default 'draft',
  approval_request_id      uuid references public.approval_requests (id),
  tally_voucher_id         uuid,                                                    -- FK added in 0008
  source                   text not null default 'dashboard' check (source in ('dashboard', 'gmail', 'sheet_migration', 'tally')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- a supplier's number is only unique per supplier (and date): two vendors can both issue "1680/26-27"
create unique index purchase_invoices_uq on public.purchase_invoices (vendor_party_id, invoice_no, invoice_date)
  where status <> 'void';
create index purchase_invoices_entity_date on public.purchase_invoices (entity_id, invoice_date desc);
create trigger purchase_invoices_updated_at before update on public.purchase_invoices
  for each row execute function app.set_updated_at();
create trigger purchase_invoices_audit after insert or update on public.purchase_invoices
  for each row execute function app.audit_row();

create table public.purchase_invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.purchase_invoices (id) on delete cascade,
  line_no            integer not null,
  description        text,
  grade_id           uuid references public.grades (id),
  thickness_mm       numeric(7, 2),
  width_mm           numeric(8, 1),
  length_mm          numeric(9, 1),
  pieces             integer,
  weight_kg          numeric(12, 2),
  rate_per_kg_ex_gst numeric(12, 3),
  amount             numeric(14, 2),
  hsn_code           text,
  heat_no            text,               -- from the packing list (mill) or the MTC (market)
  plate_no           text,
  unique (invoice_id, line_no)
);

-- lots / movements point back at the line they came from
alter table public.lots
  add constraint lots_purchase_line_fk foreign key (purchase_invoice_line_id) references public.purchase_invoice_lines (id);
alter table public.stock_movements
  add constraint stock_movements_purchase_line_fk foreign key (purchase_invoice_line_id) references public.purchase_invoice_lines (id);

-- a lot from a purchase needs its identity documents: mill => packing list; market => plate number
create or replace function app.lots_require_identity_docs()
returns trigger language plpgsql as $$
declare
  v_kind text;
  v_pl   uuid;
begin
  if new.identity_status <> 'ok' or new.origin <> 'purchase' or new.purchase_invoice_line_id is null then
    return new;
  end if;
  select pi.kind::text, pi.packing_list_document_id into v_kind, v_pl
    from public.purchase_invoice_lines l join public.purchase_invoices pi on pi.id = l.invoice_id
   where l.id = new.purchase_invoice_line_id;
  if v_kind = 'mill' and v_pl is null then
    raise exception 'Mill purchase needs its packing list before a lot can be created (it carries the heat / plate numbers)'
      using errcode = 'check_violation';
  elsif v_kind = 'market' and new.plate_no is null then
    raise exception 'Market purchase: plate number must be filled in before the lot is created'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger lots_identity_docs before insert on public.lots
  for each row execute function app.lots_require_identity_docs();

-- ---------------------------------------------------------------- sales invoices (read from Tally; workflow attributes live here)
create table public.sales_invoices (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references public.entities (id),
  fy_label           text not null,                      -- '25-26'
  invoice_no         text not null,
  invoice_date       date not null,
  entered_at         timestamptz not null default now(),
  customer_party_id  uuid not null references public.parties (id),
  customer_po_no     text,
  kind               public.sales_kind not null default 'unknown',
  taxable_value      numeric(14, 2),
  gst_amount         numeric(14, 2),
  total_amount       numeric(14, 2),
  credit_days        integer,
  due_date           date generated always as (invoice_date + coalesce(credit_days, 0)) stored,
  irn                text,
  tally_voucher_id   uuid,                               -- FK added in 0008
  status             public.invoice_status not null default 'posted',
  source             text not null default 'tally' check (source in ('tally', 'sheet_migration', 'dashboard')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- our own sales invoice number is unique within entity + financial year; a repeat is a defect, not an accepted row
create unique index sales_invoices_uq on public.sales_invoices (entity_id, fy_label, invoice_no) where status <> 'void';
create index sales_invoices_customer on public.sales_invoices (customer_party_id, invoice_date desc);
create index sales_invoices_po on public.sales_invoices (customer_po_no);
create trigger sales_invoices_updated_at before update on public.sales_invoices
  for each row execute function app.set_updated_at();
create trigger sales_invoices_audit after insert or update on public.sales_invoices
  for each row execute function app.audit_row();

create table public.sales_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.sales_invoices (id) on delete cascade,
  line_no      integer not null,
  description  text,
  grade_id     uuid references public.grades (id),
  quantity     numeric(14, 3),
  unit_code    text references public.units (code),
  weight_kg    numeric(12, 2),
  rate         numeric(14, 3),
  amount       numeric(14, 2),
  hsn_code     text,
  parsed_keys  text[] not null default '{}',     -- heat / plate numbers parsed out of the free-text description
  unique (invoice_id, line_no)
);
create index sales_invoice_lines_keys on public.sales_invoice_lines using gin (parsed_keys);

alter table public.stock_movements
  add constraint stock_movements_sales_invoice_fk foreign key (sales_invoice_id) references public.sales_invoices (id);

-- attributes that exist only in the old forms and not in Tally
create table public.sales_invoice_workflow (
  invoice_id            uuid primary key references public.sales_invoices (id) on delete cascade,
  concerned_person_id   uuid references public.staff (id),
  made_by_id            uuid references public.staff (id),
  checked_by            uuid[] not null default '{}',
  tag                   text not null default 'none' check (tag in ('none', 'blocked', 'market', 'k_reminder')),
  client_informed_at    timestamptz,
  transporter_informed_at timestamptz,
  sales_group_posted_at timestamptz,
  transport_party_id    uuid references public.parties (id),
  remarks               text,
  updated_at            timestamptz not null default now()
);
create trigger sales_invoice_workflow_updated_at before update on public.sales_invoice_workflow
  for each row execute function app.set_updated_at();
create trigger sales_invoice_workflow_audit after insert or update on public.sales_invoice_workflow
  for each row execute function app.audit_row();

-- post-invoice paperwork (the old Document Tracker)
create table public.invoice_paperwork (
  invoice_id             uuid primary key references public.sales_invoices (id) on delete cascade,
  invoice_mailed_at      timestamptz,
  sent_to_transporter_at timestamptz,
  lr_no                  text,
  lr_received_at         timestamptz,
  docs_mailed_at         timestamptz,
  docs_couriered_at      timestamptz,
  courier_party_id       uuid references public.parties (id),
  docket_no              text,
  documents_url          text,
  hold_reason            text,                    -- e.g. 'mtc waiting', 'LR & mtc waiting', 'HOLD'
  completed_at           timestamptz,
  updated_at             timestamptz not null default now()
);
create trigger invoice_paperwork_updated_at before update on public.invoice_paperwork
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------- brokerage (per invoice, never per supplier)
create table public.brokerage_entries (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            uuid not null references public.entities (id),
  direction            text not null check (direction in ('purchase', 'sale')),
  purchase_invoice_id  uuid references public.purchase_invoices (id),
  sales_invoice_id     uuid references public.sales_invoices (id),
  broker_party_id      uuid not null references public.parties (id),
  basis                text not null check (basis in ('percent', 'per_kg', 'lump')),
  rate                 numeric(12, 4),
  amount               numeric(14, 2),
  tds                  numeric(14, 2),
  paid_on              date,
  payment_ref          text,
  created_at           timestamptz not null default now(),
  constraint brokerage_one_invoice_chk check ((purchase_invoice_id is null) <> (sales_invoice_id is null))
);
