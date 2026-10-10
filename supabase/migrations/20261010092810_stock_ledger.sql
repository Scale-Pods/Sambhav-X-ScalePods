-- 0004 stock ledger: lots, append-only movements, certificates, status events, physical count, valuation
-- Rule: the stock balance is CALCULATED from movements, never typed. A mistake gets a reversal beside it.

create type public.lot_origin as enum ('purchase', 'coil_conversion', 'offcut', 'opening_count', 'adjustment');
create type public.movement_type as enum ('receipt', 'opening_count', 'sale', 'cut_out', 'cut_in', 'adjustment', 'reversal');
create type public.lot_status as enum ('available', 'hold', 'reserved', 'sold');
create type public.cert_type as enum ('mill_tc', 'consignment_mtc', 'ibr');

-- ---------------------------------------------------------------- lots (one row per plate / plate group, with a permanent internal ID)
create table public.lots (
  id                    uuid primary key default gen_random_uuid(),
  lot_no                bigint generated always as identity unique,      -- human-friendly internal number; never reused
  stock_book_id         uuid not null references public.stock_books (id),
  entity_id             uuid not null references public.entities (id),
  origin                public.lot_origin not null,
  parent_lot_id         uuid references public.lots (id),                -- offcut / coil-conversion parent
  grade_id              uuid references public.grades (id),
  grade_raw             text,
  thickness_mm          numeric(7, 2) not null check (thickness_mm > 0),
  width_mm              numeric(8, 1) check (width_mm > 0),
  length_mm             numeric(9, 1) check (length_mm > 0),
  heat_no               text,
  plate_no              text,
  tc_no                 text,
  match_key             text,                                            -- set by trigger from the mill's key type
  match_key_norm        text,
  identity_status       text not null default 'ok' check (identity_status in ('ok', 'legacy_missing')),
  mill_party_id         uuid references public.parties (id),
  vendor_party_id       uuid references public.parties (id),
  purchase_invoice_line_id uuid,                                         -- FK added in 0005
  receipt_date          date not null,
  pieces_received       integer check (pieces_received >= 0),
  invoice_weight_kg     numeric(12, 2) check (invoice_weight_kg >= 0),
  theoretical_weight_kg numeric(12, 2) check (theoretical_weight_kg >= 0),
  weighbridge_weight_kg numeric(12, 2) check (weighbridge_weight_kg >= 0),
  yard_id               uuid references public.yards (id),
  hsn_code              text,
  remarks               text,
  created_by            uuid references public.staff (id),
  created_at            timestamptz not null default now(),
  -- no lot is born without identity (legacy rows are flagged, not hidden)
  constraint lots_identity_chk
    check (identity_status = 'legacy_missing' or heat_no is not null or plate_no is not null),
  constraint lots_offcut_parent_chk
    check (origin not in ('offcut', 'coil_conversion') or parent_lot_id is not null)
);
create index lots_book_grade on public.lots (stock_book_id, grade_id, thickness_mm);
create index lots_match_key on public.lots (stock_book_id, match_key_norm);
create index lots_heat on public.lots (heat_no);
create index lots_plate on public.lots (plate_no);
create index lots_parent on public.lots (parent_lot_id);
create index lots_mill on public.lots (mill_party_id);

-- match key follows the mill: heat no for Evonith/Uttam, plate no for AMNS/Jindal (stored on the vendor record)
create or replace function app.lots_set_match_key()
returns trigger language plpgsql as $$
declare
  v_type public.match_key_type := 'unknown';
begin
  if new.mill_party_id is not null then
    select p.match_key_type into v_type from public.parties p where p.id = new.mill_party_id;
  end if;
  new.match_key := case
    when v_type = 'plate_no' then coalesce(new.plate_no, new.heat_no)
    else coalesce(new.heat_no, new.plate_no)
  end;
  new.match_key_norm := app.norm_text(new.match_key);
  return new;
end $$;
create trigger lots_match_key before insert or update on public.lots
  for each row execute function app.lots_set_match_key();

-- core facts of a lot cannot be edited; only location, remarks and later-discovered provenance can
create or replace function app.lots_guard_core()
returns trigger language plpgsql as $$
begin
  if (new.stock_book_id, new.entity_id, new.origin, new.parent_lot_id, new.grade_id, new.thickness_mm,
      new.width_mm, new.length_mm, new.heat_no, new.plate_no, new.receipt_date, new.pieces_received,
      new.invoice_weight_kg, new.theoretical_weight_kg)
     is distinct from
     (old.stock_book_id, old.entity_id, old.origin, old.parent_lot_id, old.grade_id, old.thickness_mm,
      old.width_mm, old.length_mm, old.heat_no, old.plate_no, old.receipt_date, old.pieces_received,
      old.invoice_weight_kg, old.theoretical_weight_kg) then
    raise exception 'Core facts of lot % cannot be edited; post a correcting entry instead', old.lot_no
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger lots_guard before update on public.lots
  for each row execute function app.lots_guard_core();
create trigger lots_no_delete before delete on public.lots
  for each row execute function app.forbid_mutation();
create trigger lots_audit after insert or update on public.lots
  for each row execute function app.audit_row();

-- cost per lot (landed cost = purchase + freight + duties + other, plus carrying cost computed on read)
create table public.lot_costs (
  lot_id               uuid primary key references public.lots (id),
  purchase_rate_per_kg numeric(12, 3) not null check (purchase_rate_per_kg >= 0),   -- Rs/kg, excluding GST
  freight_per_kg       numeric(12, 3) not null default 0,
  duties_per_kg        numeric(12, 3) not null default 0,
  other_per_kg         numeric(12, 3) not null default 0,
  updated_at           timestamptz not null default now()
);
create trigger lot_costs_audit after insert or update on public.lot_costs
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------- movements (append-only ledger)
create table public.stock_movements (
  id                       uuid primary key default gen_random_uuid(),
  seq                      bigint generated always as identity unique,
  lot_id                   uuid not null references public.lots (id),
  movement_type            public.movement_type not null,
  pieces                   integer not null default 0,              -- signed: + in, - out
  weight_kg                numeric(12, 2) not null,                 -- signed, on the authoritative weight basis
  movement_date            date not null,
  purchase_invoice_line_id uuid,                                    -- FKs added in 0005 / 0006
  sales_invoice_id         uuid,
  order_line_id            uuid,
  dispatch_line_id         uuid,
  count_line_id            uuid,
  reverses_movement_id     uuid unique references public.stock_movements (id),
  approval_request_id      uuid references public.approval_requests (id),
  source_document_id       uuid references public.documents (id),
  note                     text,
  created_by               uuid references public.staff (id),
  created_at               timestamptz not null default now(),
  constraint movement_reversal_chk check ((movement_type = 'reversal') = (reverses_movement_id is not null)),
  constraint movement_in_positive_chk
    check (movement_type not in ('receipt', 'opening_count', 'cut_in') or (weight_kg >= 0 and pieces >= 0)),
  constraint movement_out_negative_chk
    check (movement_type not in ('sale', 'cut_out') or (weight_kg <= 0 and pieces <= 0))
);
create index stock_movements_lot on public.stock_movements (lot_id, movement_date);
create index stock_movements_date on public.stock_movements (movement_date);
create index stock_movements_dispatch on public.stock_movements (dispatch_line_id);

create trigger stock_movements_no_update before update or delete on public.stock_movements
  for each row execute function app.forbid_mutation();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function app.forbid_mutation();

-- a sale may not take a lot below zero by more than the tolerance (settings); a smaller overrun is a warning
create or replace function app.movements_check_balance()
returns trigger language plpgsql as $$
declare
  v_bal    numeric;
  v_in     numeric;
  v_pieces integer;
  v_warn   numeric := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'weight_tolerance_warn_pct'), 2);
  v_block  numeric := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'weight_tolerance_block_pct'), 5);
begin
  if new.weight_kg >= 0 then
    return new;
  end if;
  select coalesce(sum(weight_kg), 0), coalesce(sum(pieces), 0),
         coalesce(sum(weight_kg) filter (where weight_kg > 0), 0)
    into v_bal, v_pieces, v_in
    from public.stock_movements where lot_id = new.lot_id;
  if v_bal < 0 and v_in > 0 then
    if (-v_bal) > v_in * v_block / 100.0 then
      raise exception 'Movement would take lot % below zero by % kg (% pct of what came in; block limit % pct)',
        new.lot_id, round(-v_bal, 2), round((-v_bal) / v_in * 100, 1), v_block using errcode = 'check_violation';
    elsif (-v_bal) > v_in * v_warn / 100.0 then
      insert into public.exceptions (kind, severity, message, context, related_table, related_id)
      values ('weight_warning', 'warning',
              format('Lot sold %s kg more than received (%s%%)', round(-v_bal, 2), round((-v_bal) / v_in * 100, 1)),
              jsonb_build_object('lot_id', new.lot_id, 'movement_id', new.id), 'lots', new.lot_id);
    end if;
  end if;
  if v_pieces < 0 then
    raise exception 'Movement would make piece count negative on lot %', new.lot_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create constraint trigger stock_movements_balance after insert on public.stock_movements
  deferrable initially deferred for each row execute function app.movements_check_balance();

-- ---------------------------------------------------------------- hold / reserve (append-only events)
create table public.lot_status_events (
  id         uuid primary key default gen_random_uuid(),
  lot_id     uuid not null references public.lots (id),
  status     public.lot_status not null check (status in ('available', 'hold', 'reserved')),
  reason     text,
  order_line_id uuid,
  override   boolean not null default false,       -- a hold dispatched anyway, logged
  set_by     uuid references public.staff (id),
  set_at     timestamptz not null default now()
);
create index lot_status_events_lot on public.lot_status_events (lot_id, set_at desc);
create trigger lot_status_events_no_update before update or delete on public.lot_status_events
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------- certificates (a consignment MTC covers many lots)
create table public.certificates (
  id              uuid primary key default gen_random_uuid(),
  cert_type       public.cert_type not null,
  cert_no         text,
  vendor_party_id uuid references public.parties (id),
  document_id     uuid references public.documents (id),
  drive_url       text,
  issued_on       date,
  notes           text,
  created_at      timestamptz not null default now()
);
create table public.lot_certificates (
  lot_id         uuid not null references public.lots (id),
  certificate_id uuid not null references public.certificates (id),
  primary key (lot_id, certificate_id)
);
create index lot_certificates_cert on public.lot_certificates (certificate_id);

-- ---------------------------------------------------------------- physical count (the opening position)
create table public.count_sessions (
  id            uuid primary key default gen_random_uuid(),
  stock_book_id uuid not null references public.stock_books (id),
  name          text not null,
  planned_date  date,
  started_at    timestamptz,
  closed_at     timestamptz,
  status        text not null default 'planned' check (status in ('planned', 'counting', 'review', 'posted', 'cancelled')),
  notes         text,
  created_by    uuid references public.staff (id),
  created_at    timestamptz not null default now()
);

create table public.count_lines (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.count_sessions (id),
  yard_id        uuid references public.yards (id),
  grade_id       uuid references public.grades (id),
  grade_raw      text,
  heat_no        text,
  plate_no       text,
  thickness_mm   numeric(7, 2),
  width_mm       numeric(8, 1),
  length_mm      numeric(9, 1),
  pieces         integer,
  weight_kg      numeric(12, 2),
  counted_by     uuid references public.staff (id),
  counted_at     timestamptz not null default now(),
  photo_document_id uuid references public.documents (id),
  matched_lot_id uuid references public.lots (id),
  match_status   text not null default 'unmatched'
                 check (match_status in ('unmatched', 'matched', 'new_lot', 'discrepancy', 'rejected'))
);
create index count_lines_session on public.count_lines (session_id, match_status);

alter table public.stock_movements
  add constraint stock_movements_count_line_fk foreign key (count_line_id) references public.count_lines (id);

-- ---------------------------------------------------------------- derived views (balance is never stored)
create or replace view public.v_lot_balance with (security_invoker = true) as
select l.id as lot_id,
       l.stock_book_id,
       coalesce(sum(m.weight_kg), 0)::numeric(14, 2) as balance_kg,
       coalesce(sum(m.pieces), 0)::integer           as balance_pieces,
       max(m.movement_date)                          as last_movement_date
from public.lots l
left join public.stock_movements m on m.lot_id = l.id
group by l.id, l.stock_book_id;

create or replace view public.v_lots_current with (security_invoker = true) as
select l.*,
       b.balance_kg,
       b.balance_pieces,
       case
         when b.balance_kg <= 0.5 and b.balance_pieces <= 0 then 'sold'::public.lot_status
         else coalesce(s.status, 'available'::public.lot_status)
       end as current_status,
       s.reason as status_reason
from public.lots l
join public.v_lot_balance b on b.lot_id = l.id
left join lateral (
  select e.status, e.reason from public.lot_status_events e
  where e.lot_id = l.id order by e.set_at desc, e.id desc limit 1
) s on true;

-- the "Summary" screen: balance per book / entity / grade / thickness
create or replace view public.v_stock_summary with (security_invoker = true) as
select l.stock_book_id, l.entity_id, l.grade_id, l.thickness_mm,
       count(*) filter (where c.balance_kg > 0.5)       as open_lots,
       coalesce(sum(c.balance_kg), 0)::numeric(14, 2)   as balance_kg,
       coalesce(sum(c.balance_pieces), 0)::integer      as balance_pieces
from public.lots l
join public.v_lot_balance c on c.lot_id = l.id
group by l.stock_book_id, l.entity_id, l.grade_id, l.thickness_mm;

-- landed cost with carrying cost accrued to a date (simple interest, rate is a setting)
create or replace function public.fn_lot_valuation(p_as_of date default current_date)
returns table (lot_id uuid, balance_kg numeric, base_rate_per_kg numeric, carrying_per_kg numeric,
               landed_rate_per_kg numeric, days_held integer, value_inr numeric)
language sql stable security invoker as $$
  with cfg as (
    select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'carrying_cost_pct_per_month'), 1.5) as pct
  )
  select b.lot_id,
         b.balance_kg,
         (c.purchase_rate_per_kg + c.freight_per_kg + c.duties_per_kg + c.other_per_kg) as base_rate_per_kg,
         round((c.purchase_rate_per_kg + c.freight_per_kg + c.duties_per_kg + c.other_per_kg)
               * cfg.pct / 100.0 * greatest(p_as_of - l.receipt_date, 0) / 30.0, 3)    as carrying_per_kg,
         round((c.purchase_rate_per_kg + c.freight_per_kg + c.duties_per_kg + c.other_per_kg)
               * (1 + cfg.pct / 100.0 * greatest(p_as_of - l.receipt_date, 0) / 30.0), 3) as landed_rate_per_kg,
         greatest(p_as_of - l.receipt_date, 0)                                          as days_held,
         round(b.balance_kg * (c.purchase_rate_per_kg + c.freight_per_kg + c.duties_per_kg + c.other_per_kg)
               * (1 + cfg.pct / 100.0 * greatest(p_as_of - l.receipt_date, 0) / 30.0), 2) as value_inr
  from public.v_lot_balance b
  join public.lots l on l.id = b.lot_id
  join public.lot_costs c on c.lot_id = b.lot_id
  cross join cfg
$$;
