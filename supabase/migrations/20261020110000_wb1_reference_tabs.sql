-- 14: the two WB1 tabs that are not stock but were asked for: "Incoming" (mill purchase-order tracking) and
-- "Corten" (a vehicle weight log). Read-only reference data loaded from the sheet; there is no write function yet,
-- because the mail / purchases modules will own these records later.

create table public.mill_po_lines (
  id            uuid primary key default gen_random_uuid(),
  po_no         text not null,
  so_no         text,                       -- mill's sales-order number
  grade_raw     text,
  po_date_text  text,                       -- the sheet gives day and month only ("16-Nov"), no year: kept as written
  so_date_text  text,
  size_mm       numeric(7, 2),
  ordered_kg    numeric(12, 2),
  received_kg   numeric(12, 2),
  pending_kg    numeric(12, 2),             -- as typed in the sheet (ordered - received); negative = received more than ordered
  sheet_block   text,
  import_batch_id uuid references public.import_batches (id),
  source_tab    text,
  source_row    integer
);
create index mill_po_lines_batch on public.mill_po_lines (import_batch_id);

create table public.vehicle_weight_log (
  id            uuid primary key default gen_random_uuid(),
  logged_at     timestamptz,                -- form timestamp
  weigh_date    date,
  vehicle_no    text,
  weight_kg     numeric(12, 2),
  photo_url     text,
  import_batch_id uuid references public.import_batches (id),
  source_tab    text,
  source_row    integer
);
create index vehicle_weight_log_batch on public.vehicle_weight_log (import_batch_id);

alter table public.mill_po_lines enable row level security;
alter table public.vehicle_weight_log enable row level security;
grant select on public.mill_po_lines, public.vehicle_weight_log to authenticated;
create policy internal_read on public.mill_po_lines for select to authenticated using ((select app.is_internal()));
create policy internal_read on public.vehicle_weight_log for select to authenticated using ((select app.is_internal()));
