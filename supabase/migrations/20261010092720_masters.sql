-- 0002 masters: entities, stock books, yards, staff, parties, grades, units, reference values, settings, import tracking

-- ---------------------------------------------------------------- entities (SPF / Sai / RS)
create table public.entities (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  gstin          text,
  pan            text,
  fy_start_month smallint not null default 4 check (fy_start_month between 1 and 12),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

insert into public.entities (code, name) values
  ('SPF', 'Sambhav Pipes & Fittings'),
  ('SAI', 'Sai Steel & Engineering'),
  ('RS',  'Ridhi Siddhi Steel Corporation');

-- ---------------------------------------------------------------- stock books (WB1 / WB2): never merged
create table public.stock_books (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null,
  owner_entity_id    uuid not null references public.entities (id),
  partner_entity_id  uuid references public.entities (id),
  partner_share_pct  numeric(5, 2) check (partner_share_pct between 0 and 100),
  partner_visible    boolean not null default false,   -- may the partner (role partner_rs) see this book
  note               text,
  active             boolean not null default true,
  constraint stock_books_partner_chk check ((partner_entity_id is null) = (partner_share_pct is null))
);

insert into public.stock_books (code, name, owner_entity_id, partner_entity_id, partner_share_pct, partner_visible, note)
select 'WB1', 'Alloy plate stock (HJ alone)', e.id, null, null, false,
       'SA 387 Gr 11/12/22/9/91/5, 16Mo3, A36'
from public.entities e where e.code = 'SPF';

insert into public.stock_books (code, name, owner_entity_id, partner_entity_id, partner_share_pct, partner_visible, note)
select 'WB2', 'Wear & high-strength stock (50/50 with Ridhi Siddhi)', e.id, r.id, 50, true,
       'Rockstar 400/500, S690QL, SA 537 Cl 1'
from public.entities e, public.entities r where e.code = 'SPF' and r.code = 'RS';

-- ---------------------------------------------------------------- yards / plots
create table public.yards (
  id      uuid primary key default gen_random_uuid(),
  code    text not null unique,
  name    text,
  address text,
  active  boolean not null default true
);
insert into public.yards (code, name) values ('D15', 'Plot D-15, Taloja MIDC'), ('753', 'Plot 753');

-- ---------------------------------------------------------------- staff (people, with or without a login)
create table public.staff (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users (id) on delete set null,
  full_name         text not null,
  email             text,
  whatsapp_number   text,
  primary_entity_id uuid references public.entities (id),
  role              public.app_role not null default 'viewer',
  job_title         text,
  approves          public.approval_kind[] not null default '{}',
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger staff_updated_at before update on public.staff
  for each row execute function app.set_updated_at();

create table public.staff_aliases (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff (id) on delete cascade,
  alias      text not null,
  alias_norm text generated always as (app.norm_text(alias)) stored,
  unique (alias_norm)
);

-- helper functions that depend on staff (created after the table; language sql is validated at creation)
create or replace function app.my_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function app.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.staff where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function app.is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office', 'viewer'), false)
$$;

create or replace function app.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.my_role() in ('owner', 'admin'), false)
$$;

create or replace function app.can_see_book(p_book uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when app.is_internal() then true
    when app.my_role() = 'partner_rs' then exists (select 1 from public.stock_books b where b.id = p_book and b.partner_visible)
    else false
  end
$$;

create or replace function app.can_approve(p_kind public.approval_kind)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.active and (s.role in ('owner', 'admin') or p_kind = any (s.approves))
       from public.staff s where s.auth_user_id = auth.uid() limit 1), false)
$$;

-- ---------------------------------------------------------------- parties (customers, vendors, mills, brokers, transporters, labs)
create table public.parties (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  name_norm        text generated always as (app.norm_text(name)) stored,
  roles            public.party_role[] not null default '{}',
  gstin            text,
  pan              text,
  state_code       text,
  city             text,
  country          text not null default 'IN',
  parent_party_id  uuid references public.parties (id),   -- group company / merged duplicate
  match_key_type   public.match_key_type not null default 'unknown',   -- for mills: heat_no or plate_no
  tally_ledger_name text,
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index parties_gstin_uq on public.parties (gstin) where gstin is not null;
create index parties_name_trgm on public.parties using gin (name_norm extensions.gin_trgm_ops);
create index parties_roles_gin on public.parties using gin (roles);
create trigger parties_updated_at before update on public.parties
  for each row execute function app.set_updated_at();

create table public.party_aliases (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties (id) on delete cascade,
  alias      text not null,
  alias_norm text generated always as (app.norm_text(alias)) stored,
  unique (alias_norm)
);
create index party_aliases_trgm on public.party_aliases using gin (alias_norm extensions.gin_trgm_ops);

create table public.party_contacts (
  id           uuid primary key default gen_random_uuid(),
  party_id     uuid not null references public.parties (id) on delete cascade,
  name         text,
  email        text,
  email_domain text generated always as (nullif(split_part(lower(coalesce(email, '')), '@', 2), '')) stored,
  phone        text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index party_contacts_email on public.party_contacts (lower(email));
create index party_contacts_domain on public.party_contacts (email_domain);

-- ---------------------------------------------------------------- grades
create table public.grades (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,          -- canonical, e.g. 'SA 387 GR 11 CL 2'
  family   text,
  spec     text,
  is_plate boolean not null default true,  -- pipes / fittings / stainless are not stocked
  active   boolean not null default true,
  notes    text
);

create table public.grade_aliases (
  id         uuid primary key default gen_random_uuid(),
  grade_id   uuid not null references public.grades (id) on delete cascade,
  alias      text not null,
  alias_norm text generated always as (app.norm_text(alias)) stored,
  unique (alias_norm)
);

-- ---------------------------------------------------------------- units
create table public.units (
  code text primary key,
  name text not null
);
insert into public.units (code, name) values ('pc', 'piece'), ('kg', 'kilogram'), ('mtr', 'metre'), ('ton', 'tonne');

create table public.unit_aliases (
  alias_norm text primary key,
  unit_code  text not null references public.units (code)
);
insert into public.unit_aliases (alias_norm, unit_code) values
  ('NO', 'pc'), ('NOPC', 'pc'), ('NOS', 'pc'), ('PC', 'pc'), ('PCS', 'pc'),
  ('KG', 'kg'), ('KGS', 'kg'), ('MTR', 'mtr'), ('MT', 'mtr'), ('TON', 'ton'), ('TONS', 'ton');

-- ---------------------------------------------------------------- reference values (small closed lists)
create table public.ref_values (
  group_key text not null,
  code      text not null,
  label     text not null,
  sort      integer not null default 0,
  active    boolean not null default true,
  primary key (group_key, code)
);
insert into public.ref_values (group_key, code, label, sort) values
  ('transport_terms', 'to_pay_door',    'To pay - door delivery', 1),
  ('transport_terms', 'paid_door',      'Paid - door delivery', 2),
  ('transport_terms', 'to_pay_godown',  'To pay - godown delivery', 3),
  ('transport_terms', 'paid_godown',    'Paid - godown delivery', 4),
  ('transport_terms', 'self_pickup',    'Self pick up / Ex-Works', 5),
  ('transport_terms', 'fob',            'FOB', 6),
  ('weight_basis',    'kata',           'Weighbridge (kata)', 1),
  ('weight_basis',    'section',        'Section weight', 2),
  ('weight_basis',    'mtc',            'As per MTC', 3),
  ('doc_requirement', 'invoice',        'Invoice', 1),
  ('doc_requirement', 'lr',             'LR', 2),
  ('doc_requirement', 'mtc',            'MTCs', 3),
  ('doc_requirement', 'unpriced_po',    'Unpriced PO', 4),
  ('doc_requirement', 'qap',            'QAP', 5),
  ('doc_requirement', 'offer_list',     'Offer list', 6),
  ('test_type',       'pmi',            'PMI', 1),
  ('test_type',       'ut',             'UT', 2),
  ('test_type',       'hydro',          'Hydro', 3),
  ('test_type',       'lab',            'Lab test', 4);

-- ---------------------------------------------------------------- settings (rates, thresholds, templates are data, not code)
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  status      text not null default 'proposed' check (status in ('proposed', 'approved')),
  updated_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now()
);
create trigger settings_updated_at before update on public.settings
  for each row execute function app.set_updated_at();

insert into public.settings (key, value, description) values
  ('carrying_cost_pct_per_month', '1.5',      'Simple interest per month on landed cost, from receipt date (replaces the old 1% TODAY() column)'),
  ('density_kg_m3',               '7850',      'Steel density for theoretical weight. Old sheets used 8000; HJ to confirm'),
  ('weight_tolerance_warn_pct',   '2',         'Sale weight over purchased weight for the same lot: warn above this %'),
  ('weight_tolerance_block_pct',  '5',         'Sale weight over purchased weight for the same lot: block above this %'),
  ('followup_after_days',         '2',         'Quoted / enquiry with no reply: needs follow-up'),
  ('dead_lead_after_days',        '30',        'Quoted, never ordered'),
  ('lost_client_after_days',      '90',        'Client with no orders'),
  ('tally_sync_minutes',          '60',        'Tally read frequency'),
  ('tally_stale_after_minutes',   '180',       'Show stale-data banner after this long'),
  ('approval_batch_low_risk',     'true',      'Low-risk entries may be approved in a batch');

-- ---------------------------------------------------------------- import tracking (traceability back to the old sheets)
create table public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_tab  text,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.staff (id),
  row_count   integer,
  note        text
);

create table public.legacy_refs (
  id              uuid primary key default gen_random_uuid(),
  table_name      text not null,
  record_id       uuid not null,
  import_batch_id uuid references public.import_batches (id),
  source_tab      text,
  source_row      integer,
  raw             jsonb
);
create index legacy_refs_record on public.legacy_refs (table_name, record_id);
