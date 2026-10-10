-- 0006 orders and dispatch (replaces Dispatch FMS) -- and the join that never existed:
-- order line -> sales invoice -> the exact plates (lots) that left the yard.

create type public.order_status as enum ('open', 'in_progress', 'completed', 'cancelled');
create type public.material_source as enum ('stock', 'purchase');    -- 'purchase' = bought to order; never enters stock
create type public.dispatch_status as enum ('pending', 'slip_uploaded', 'slip_approved', 'completed', 'cancelled');

-- ---------------------------------------------------------------- orders
create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  order_no             integer not null unique,           -- one series shared by SPF and Sai
  entity_id            uuid references public.entities (id),   -- primary entity; lines may differ
  concern_person_id    uuid references public.staff (id),
  customer_party_id    uuid not null references public.parties (id),
  customer_po_no       text,                              -- free text, may be 'VERBAL'
  po_date              date,
  delivery_location    text,
  etd                  date,
  po_document_id       uuid references public.documents (id),
  required_documents   text[] not null default '{}',      -- ref_values group 'doc_requirement'
  persons_required     text,                              -- yard staff needed for loading
  status               public.order_status not null default 'open',
  completed_at         timestamptz,
  entered_at           timestamptz not null default now(),
  source               text not null default 'dashboard' check (source in ('dashboard', 'dispatch_fms', 'sheet_migration')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index orders_customer on public.orders (customer_party_id, po_date desc);
create index orders_status on public.orders (status, etd);
create index orders_po on public.orders (customer_po_no);
create trigger orders_updated_at before update on public.orders
  for each row execute function app.set_updated_at();
create trigger orders_audit after insert or update on public.orders
  for each row execute function app.audit_row();

create table public.order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  line_no           integer not null,
  entity_id         uuid references public.entities (id),     -- some orders carry both SPF and Sai lines
  grade_id          uuid references public.grades (id),
  grade_raw         text,
  size_text         text,                                      -- as typed; parsed dimensions below when possible
  thickness_mm      numeric(7, 2),
  width_mm          numeric(8, 1),
  length_mm         numeric(9, 1),
  quantity          numeric(14, 3) not null check (quantity > 0),
  unit_code         text references public.units (code),
  rate              numeric(14, 3),
  material_source   public.material_source not null,
  yard_id           uuid references public.yards (id),
  weight_basis      text,                                      -- ref_values 'weight_basis'
  instructions      text,
  pf_charge         numeric(12, 2),
  loading_charge    numeric(12, 2),
  freight_charge    numeric(12, 2),
  extra_charge      numeric(12, 2),
  charges_note      text,                                      -- original free text ('TOO PAY BASIS', 'na')
  transporter_party_id uuid references public.parties (id),
  vehicle_no        text,
  transport_terms   text,                                      -- ref_values 'transport_terms'
  unique (order_id, line_no)
);
create index order_lines_grade on public.order_lines (grade_id);

-- testing is a routine stage with a cost and a delay
create table public.order_line_testing (
  order_line_id      uuid primary key references public.order_lines (id) on delete cascade,
  tests              text[] not null default '{}',             -- ref_values 'test_type'
  lab_party_id       uuid references public.parties (id),
  third_party_inspection boolean,
  sample_cutting     boolean,
  status             text not null default 'not_required'
                     check (status in ('not_required', 'pending', 'sample_sent', 'result_received', 'failed')),
  sample_sent_at     timestamptz,
  result_received_at timestamptz,
  cost               numeric(12, 2),
  note               text
);

create table public.order_crm_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  kind       text not null check (kind in ('thank_you', 'ongoing', 'completed', 'other')),
  channel    text not null default 'whatsapp' check (channel in ('whatsapp', 'email', 'phone')),
  text       text,
  occurred_at timestamptz not null default now(),
  by_staff   uuid references public.staff (id)
);

-- ---------------------------------------------------------------- dispatch (outward slip photo -> approved reading -> stock deducted)
create table public.dispatches (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id),
  sales_invoice_id      uuid references public.sales_invoices (id),
  status                public.dispatch_status not null default 'pending',
  dispatched_on         date,
  vehicle_no            text,
  transporter_party_id  uuid references public.parties (id),
  lr_no                 text,
  slip_document_id      uuid references public.documents (id),   -- the WhatsApp photo, uploaded by the office
  approval_request_id   uuid references public.approval_requests (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index dispatches_order on public.dispatches (order_id);
create index dispatches_invoice on public.dispatches (sales_invoice_id);
create trigger dispatches_updated_at before update on public.dispatches
  for each row execute function app.set_updated_at();
create trigger dispatches_audit after insert or update on public.dispatches
  for each row execute function app.audit_row();

create table public.dispatch_lines (
  id              uuid primary key default gen_random_uuid(),
  dispatch_id     uuid not null references public.dispatches (id) on delete cascade,
  order_line_id   uuid references public.order_lines (id),
  lot_id          uuid references public.lots (id),              -- null for supply material (never touches stock)
  pieces          integer,
  weight_kg       numeric(12, 2),
  offcut_weight_kg numeric(12, 2),                                -- written on the slip; becomes a child lot
  offcut_lot_id   uuid references public.lots (id),
  note            text
);
create index dispatch_lines_lot on public.dispatch_lines (lot_id);

alter table public.stock_movements
  add constraint stock_movements_order_line_fk foreign key (order_line_id) references public.order_lines (id),
  add constraint stock_movements_dispatch_line_fk foreign key (dispatch_line_id) references public.dispatch_lines (id);
alter table public.lot_status_events
  add constraint lot_status_events_order_line_fk foreign key (order_line_id) references public.order_lines (id);

-- open orders and what is still to be dispatched
create or replace view public.v_open_orders with (security_invoker = true) as
select o.id as order_id, o.order_no, o.customer_party_id, o.customer_po_no, o.etd, o.concern_person_id, o.status,
       count(l.id) as line_count,
       count(l.id) filter (where l.material_source = 'purchase') as bought_to_order_lines
from public.orders o
left join public.order_lines l on l.order_id = o.id
where o.status in ('open', 'in_progress')
group by o.id;
