-- 0007 mail intelligence and quotations (10 mailboxes; one client = one owner; follow-ups are lists, not auto-sent mail)

create type public.mailbox_kind as enum ('gmail_consumer', 'workspace');
create type public.mail_direction as enum ('in', 'out');
create type public.thread_status as enum ('new', 'needs_reply', 'replied', 'follow_up', 'ignored', 'done');
create type public.thread_category as enum
  ('enquiry', 'quotation', 'po', 'mtc_request', 'payment', 'bank', 'gst', 'courier', 'newsletter', 'personal', 'other');
create type public.quote_status as enum ('quoted', 'won', 'lost', 'no_reply', 'revised', 'withdrawn');

create table public.mailboxes (
  id                uuid primary key default gen_random_uuid(),
  address           text not null unique,
  kind              public.mailbox_kind not null,
  entity_id         uuid not null references public.entities (id),
  owner_staff_id    uuid references public.staff (id),
  active            boolean not null default true,
  sync_cursor       text,                          -- Gmail historyId
  last_synced_at    timestamptz,
  backfill_from     date,
  backfill_cursor   text,
  backfill_done     boolean not null default false,
  messages_total    integer,                       -- from the admin console, for the progress counter
  storage_bytes     bigint,
  created_at        timestamptz not null default now()
);

create table public.mailbox_access (
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  staff_id   uuid not null references public.staff (id) on delete cascade,
  primary key (mailbox_id, staff_id)
);

alter table public.documents
  add constraint documents_mailbox_fk foreign key (mailbox_id) references public.mailboxes (id);

-- ---------------------------------------------------------------- clients (CRM profile on top of a customer party)
create table public.client_profiles (
  party_id         uuid primary key references public.parties (id) on delete cascade,
  owner_staff_id   uuid references public.staff (id),      -- exactly one owner; anyone may resolve a clash
  lifecycle        text not null default 'prospect' check (lifecycle in ('prospect', 'active', 'dead_lead', 'lost_client')),
  last_order_date  date,
  last_contact_at  timestamptz,
  scale_note       text,
  notes            text,
  updated_at       timestamptz not null default now()
);
create trigger client_profiles_updated_at before update on public.client_profiles
  for each row execute function app.set_updated_at();

create table public.ownership_clashes (
  id             uuid primary key default gen_random_uuid(),
  party_id       uuid not null references public.parties (id),
  candidate_staff uuid[] not null,
  raised_at      timestamptz not null default now(),
  resolved_by    uuid references public.staff (id),
  resolved_to    uuid references public.staff (id),
  resolved_at    timestamptz
);

-- ---------------------------------------------------------------- threads and messages
create table public.mail_threads (
  id               uuid primary key default gen_random_uuid(),
  mailbox_id       uuid not null references public.mailboxes (id),
  gmail_thread_id  text not null,
  subject          text,
  party_id         uuid references public.parties (id),
  owner_staff_id   uuid references public.staff (id),
  category         public.thread_category not null default 'other',
  status           public.thread_status not null default 'new',
  first_message_at timestamptz,
  last_message_at  timestamptz,
  last_direction   public.mail_direction,
  last_out_at      timestamptz,                 -- follow-up clocks count from the last outgoing message
  quote_no         text,                        -- parsed from "QUOTATION NO - 629"
  created_at       timestamptz not null default now(),
  unique (mailbox_id, gmail_thread_id)
);
create index mail_threads_status on public.mail_threads (mailbox_id, status, last_message_at desc);
create index mail_threads_party on public.mail_threads (party_id);
create index mail_threads_quote on public.mail_threads (quote_no);

create table public.mail_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references public.mail_threads (id) on delete cascade,
  gmail_message_id text not null,
  direction        public.mail_direction not null,
  from_address     text,
  to_addresses     text[] not null default '{}',
  cc_addresses     text[] not null default '{}',
  sent_at          timestamptz not null,
  snippet          text,
  body_path        text,                       -- full body in Storage, not in the table
  has_attachments  boolean not null default false,
  classification   jsonb,
  unique (thread_id, gmail_message_id)
);
create index mail_messages_sent on public.mail_messages (thread_id, sent_at);

-- ---------------------------------------------------------------- quotations
create table public.quotations (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.entities (id),
  quote_no          text not null,
  quote_date        date not null,
  party_id          uuid references public.parties (id),
  mail_thread_id    uuid references public.mail_threads (id),
  salesperson_id    uuid references public.staff (id),
  status            public.quote_status not null default 'quoted',
  valid_until       date,
  delivery_terms    text,
  payment_terms     text,
  total_value       numeric(14, 2),
  document_id       uuid references public.documents (id),     -- the Excel / PDF sent
  source            text not null default 'mail_backfill' check (source in ('mail_backfill', 'dashboard', 'sheet_migration')),
  created_at        timestamptz not null default now(),
  unique (entity_id, quote_no)
);
create index quotations_party on public.quotations (party_id, quote_date desc);

create table public.quotation_lines (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references public.quotations (id) on delete cascade,
  line_no       integer not null,
  grade_id      uuid references public.grades (id),
  grade_raw     text,
  size_text     text,
  quantity      numeric(14, 3),
  unit_code     text references public.units (code),
  rate          numeric(14, 3),
  rate_unit     text,
  unique (quotation_id, line_no)
);

-- won / lost / no reply, plus the competitor and their rate (the one manual habit)
create table public.quotation_outcomes (
  id               uuid primary key default gen_random_uuid(),
  quotation_id     uuid not null references public.quotations (id) on delete cascade,
  outcome          public.quote_status not null check (outcome in ('won', 'lost', 'no_reply')),
  order_id         uuid references public.orders (id),
  competitor_name  text,
  competitor_rate  numeric(14, 3),
  lost_reason      text,
  recorded_by      uuid references public.staff (id),
  recorded_at      timestamptz not null default now()
);
create index quotation_outcomes_q on public.quotation_outcomes (quotation_id, recorded_at desc);

-- ---------------------------------------------------------------- follow-up lists (rules come from settings)
create or replace view public.v_followup_list with (security_invoker = true) as
select t.id as thread_id, t.mailbox_id, t.party_id, t.owner_staff_id, t.subject, t.quote_no, t.last_out_at,
       (current_date - t.last_out_at::date) as days_waiting
from public.mail_threads t
where t.last_direction = 'out'
  and t.category in ('enquiry', 'quotation')
  and t.status not in ('ignored', 'done')
  and t.last_out_at::date <= current_date
        - coalesce((select (value #>> '{}')::integer from public.settings where key = 'followup_after_days'), 2);

create or replace view public.v_dead_leads with (security_invoker = true) as
select q.id as quotation_id, q.entity_id, q.party_id, q.quote_no, q.quote_date, q.salesperson_id
from public.quotations q
where q.status = 'quoted'
  and q.quote_date <= current_date
        - coalesce((select (value #>> '{}')::integer from public.settings where key = 'dead_lead_after_days'), 30)
  and not exists (select 1 from public.orders o
                   where o.customer_party_id = q.party_id and o.po_date >= q.quote_date);

create or replace view public.v_lost_clients with (security_invoker = true) as
select c.party_id, c.owner_staff_id, c.last_order_date
from public.client_profiles c
where c.last_order_date is not null
  and c.last_order_date <= current_date
        - coalesce((select (value #>> '{}')::integer from public.settings where key = 'lost_client_after_days'), 90);

-- per-person mailbox view plus a company-wide summary that exposes counts only
create or replace view public.v_mail_summary as
select m.id as mailbox_id, m.address, m.entity_id,
       count(*) filter (where t.status in ('new', 'needs_reply')) as awaiting_reply,
       count(*) filter (where t.status = 'follow_up')              as follow_up,
       count(*)                                                    as threads
from public.mailboxes m
left join public.mail_threads t on t.mailbox_id = m.id
where app.is_internal()
group by m.id;   -- no security_invoker on purpose: counts are visible to all internal staff, nothing else
