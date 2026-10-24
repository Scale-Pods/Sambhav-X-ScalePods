-- 20: the Tally connector's receiving side.
-- A small script on the Tally PC reads TallyPrime (read-only) and sends the result here over HTTPS. It proves who it is with a
-- long secret key; only the key's SHA-256 is stored. The functions below are the ONLY way the connector can write, and they only
-- write into the tally_* tables. Nothing is ever sent back to Tally.
-- Sign convention: amounts that are balances are stored debit-positive (a customer who owes us is positive).

-- ---------------------------------------------------------------- extra columns on the existing tables
alter table public.tally_vouchers
  add column reference  text,
  add column irn        text,
  add column entered_by text,
  add column entries    jsonb,           -- ledger lines: [{ledger, amount (debit +), }]
  add column deleted_at timestamptz;     -- removed in Tally after we had read it
alter table public.tally_voucher_items
  add column godown text,
  add column batch  text;                -- batch / lot names: the likely home of heat or plate numbers
alter table public.tally_ledgers
  add column registration_type text,
  add column deleted_at timestamptz;
create unique index tally_companies_name on public.tally_companies (tally_name);

create table public.tally_stock_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.tally_companies (id),
  tally_guid    text not null,
  name          text not null,
  parent_group  text,
  unit          text,
  closing_qty   numeric(16, 3),
  closing_value numeric(16, 2),
  updated_at    timestamptz not null default now(),
  unique (company_id, tally_guid)
);

create table public.tally_connectors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  key_hash       text not null unique,       -- sha256 of the secret key, hex
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz,
  last_status    text,                       -- ok | tally_down | error
  last_message   text,
  last_version   text,
  last_sync_ok_at timestamptz
);

create table public.tally_sync_requests (
  id           uuid primary key default gen_random_uuid(),
  requested_by uuid references public.staff (id),
  requested_at timestamptz not null default now(),
  from_date    date,
  to_date      date,
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  claimed_at   timestamptz,
  finished_at  timestamptz,
  message      text
);
create index tally_sync_requests_open on public.tally_sync_requests (status, requested_at) where status in ('pending', 'running');

alter table public.tally_stock_items enable row level security;
alter table public.tally_connectors enable row level security;
alter table public.tally_sync_requests enable row level security;
create policy internal_read on public.tally_stock_items for select to authenticated using ((select app.is_internal()));
create policy internal_read on public.tally_sync_requests for select to authenticated using ((select app.is_internal()));
create policy admin_read on public.tally_connectors for select to authenticated using (coalesce((select app.my_role()) in ('owner', 'admin'), false));
-- no insert / update policies anywhere: only the functions below write

-- ---------------------------------------------------------------- who is calling
create or replace function app.tally_connector(p_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(length(p_key), 0) < 32 then raise exception 'Invalid connector key' using errcode = '28000'; end if;
  select id into v_id from public.tally_connectors
   where key_hash = encode(sha256(convert_to(p_key, 'utf8')), 'hex') and active;
  if v_id is null then raise exception 'Invalid connector key' using errcode = '28000'; end if;
  update public.tally_connectors set last_seen_at = now() where id = v_id;
  return v_id;
end $$;

-- the company the data belongs to (created on first sight, mapped to the Sambhav Pipes & Fittings entity)
create or replace function app.tally_company(p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ent uuid;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'The company name is missing'; end if;
  select id into v_id from public.tally_companies where tally_name = p_name;
  if v_id is null then
    select id into v_ent from public.entities where code = 'SPF';
    insert into public.tally_companies (tally_name, entity_id, last_status) values (p_name, v_ent, 'created')
    on conflict (tally_name) do update set tally_name = excluded.tally_name returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- heartbeat + "is anyone waiting for a sync?"
create or replace function public.tally_check(p_key text, p_status text, p_message text, p_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key); r public.tally_sync_requests;
begin
  update public.tally_connectors set last_status = left(coalesce(p_status, 'ok'), 20), last_message = left(p_message, 300), last_version = left(p_version, 40) where id = c;
  select * into r from public.tally_sync_requests where status = 'pending' order by requested_at limit 1 for update skip locked;
  if found then
    update public.tally_sync_requests set status = 'running', claimed_at = now() where id = r.id;
    return jsonb_build_object('request', jsonb_build_object('id', r.id, 'from', r.from_date, 'to', r.to_date));
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.tally_request_done(p_key text, p_request uuid, p_ok boolean, p_message text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key);
begin
  update public.tally_sync_requests set status = case when p_ok then 'done' else 'failed' end, finished_at = now(), message = left(p_message, 300)
   where id = p_request and status = 'running';
end $$;

-- the app's "Sync now" button (owner or administrator)
create or replace function public.tally_request_sync(p_from date default null, p_to date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not coalesce(app.my_role() in ('owner', 'admin'), false) then
    raise exception 'Only the owner or an administrator can ask for a Tally sync' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.tally_sync_requests where status in ('pending', 'running')) then
    raise exception 'A sync is already waiting or running';
  end if;
  insert into public.tally_sync_requests (requested_by, from_date, to_date) values (app.my_staff_id(), p_from, p_to) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- runs
create or replace function public.tally_run_start(p_key text, p_company text, p_trigger text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); v_id uuid;
begin
  insert into public.tally_sync_runs (company_id, trigger_type) values (v_co, case when p_trigger in ('schedule', 'manual', 'upload') then p_trigger else 'schedule' end) returning id into v_id;
  return v_id;
end $$;

create or replace function public.tally_run_finish(p_key text, p_run uuid, p_status text, p_records integer, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key); v_co uuid;
begin
  update public.tally_sync_runs set finished_at = now(), status = case when p_status in ('ok', 'partial', 'failed') then p_status else 'failed' end,
         records_in = p_records, error = left(p_error, 500)
   where id = p_run returning company_id into v_co;
  update public.tally_companies set last_sync_at = now(), last_status = p_status where id = v_co;
  if p_status = 'ok' then update public.tally_connectors set last_sync_ok_at = now() where id = c; end if;
end $$;

-- ---------------------------------------------------------------- masters
create or replace function public.tally_ingest_ledgers(p_key text, p_company text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int;
begin
  insert into public.tally_ledgers (company_id, tally_guid, name, parent_group, gstin, state, closing_balance, registration_type, updated_at, deleted_at)
  select v_co, coalesce(nullif(x.guid, ''), 'name:' || x.name), x.name, nullif(x.parent, ''), nullif(x.gstin, ''), nullif(x.state, ''),
         -x.closing, nullif(x.regtype, ''), now(), null
  from jsonb_to_recordset(p_items) as x(guid text, name text, parent text, gstin text, state text, closing numeric, regtype text)
  where coalesce(x.name, '') <> ''
  on conflict (company_id, tally_guid) do update set name = excluded.name, parent_group = excluded.parent_group, gstin = excluded.gstin, state = excluded.state,
    closing_balance = excluded.closing_balance, registration_type = excluded.registration_type, updated_at = now(), deleted_at = null;
  get diagnostics n = row_count;
  return jsonb_build_object('ledgers', n);
end $$;

create or replace function public.tally_ingest_stock(p_key text, p_company text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int;
begin
  insert into public.tally_stock_items (company_id, tally_guid, name, parent_group, unit, closing_qty, closing_value, updated_at)
  select v_co, coalesce(nullif(x.guid, ''), 'name:' || x.name), x.name, nullif(x.parent, ''), nullif(x.unit, ''), x.qty, x.value, now()
  from jsonb_to_recordset(p_items) as x(guid text, name text, parent text, unit text, qty numeric, value numeric)
  where coalesce(x.name, '') <> ''
  on conflict (company_id, tally_guid) do update set name = excluded.name, parent_group = excluded.parent_group, unit = excluded.unit,
    closing_qty = excluded.closing_qty, closing_value = excluded.closing_value, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('stock_items', n);
end $$;

-- outstanding bills are a snapshot: the whole list for one kind replaces the previous one
create or replace function public.tally_ingest_bills(p_key text, p_company text, p_kind text, p_as_of date, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int;
begin
  if p_kind not in ('receivable', 'payable') then raise exception 'Unknown bill kind'; end if;
  delete from public.tally_outstanding_bills where company_id = v_co and kind = p_kind;
  insert into public.tally_outstanding_bills (company_id, kind, party_ledger, bill_ref, bill_date, due_date, pending_amount, as_of)
  select v_co, p_kind, x.party, nullif(x.ref, ''), nullif(x.bill_date, '')::date, nullif(x.due_date, '')::date, abs(x.pending), p_as_of
  from jsonb_to_recordset(p_items) as x(party text, ref text, bill_date text, due_date text, pending numeric)
  where coalesce(x.party, '') <> '';
  get diagnostics n = row_count;
  return jsonb_build_object('bills', n);
end $$;

-- ---------------------------------------------------------------- vouchers
create or replace function public.tally_ingest_vouchers(p_key text, p_company text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int; m int := 0; r record;
begin
  create temp table _tv on commit drop as
  select x.guid, x.alter_id, x.vtype, x.vno, to_date(x.vdate, 'YYYYMMDD') vdate, x.party, x.amount, x.narration, coalesce(x.cancelled, false) cancelled,
         x.reference, x.irn, x.entered_by, x.entries, x.items
  from jsonb_to_recordset(p_items) as x(guid text, alter_id bigint, vtype text, vno text, vdate text, party text, amount numeric, narration text,
                                        cancelled boolean, reference text, irn text, entered_by text, entries jsonb, items jsonb)
  where coalesce(x.guid, '') <> '' and coalesce(x.vtype, '') <> '' and coalesce(x.vdate, '') <> '';

  insert into public.tally_vouchers (company_id, tally_guid, alter_id, voucher_type, voucher_no, voucher_date, party_ledger, amount, narration, is_cancelled,
                                     reference, irn, entered_by, entries, updated_at, deleted_at)
  select v_co, guid, alter_id, vtype, nullif(vno, ''), vdate, nullif(party, ''), amount, nullif(narration, ''), cancelled, nullif(reference, ''), nullif(irn, ''),
         nullif(entered_by, ''), entries, now(), null
  from _tv
  on conflict (company_id, tally_guid) do update set alter_id = excluded.alter_id, voucher_type = excluded.voucher_type, voucher_no = excluded.voucher_no,
    voucher_date = excluded.voucher_date, party_ledger = excluded.party_ledger, amount = excluded.amount, narration = excluded.narration,
    is_cancelled = excluded.is_cancelled, reference = excluded.reference, irn = excluded.irn, entered_by = excluded.entered_by, entries = excluded.entries,
    updated_at = now(), deleted_at = null;
  get diagnostics n = row_count;

  -- item lines are replaced as a set (a voucher edited in Tally may have fewer lines than before)
  delete from public.tally_voucher_items where voucher_id in (select v.id from public.tally_vouchers v join _tv t on t.guid = v.tally_guid where v.company_id = v_co);
  insert into public.tally_voucher_items (voucher_id, line_no, item_name, description, quantity, unit, rate, amount, godown, batch)
  select v.id, e.ord::int, nullif(e.obj->>'item', ''), nullif(e.obj->>'descr', ''), nullif(e.obj->>'qty', '')::numeric, nullif(e.obj->>'unit', ''),
         nullif(e.obj->>'rate', '')::numeric, nullif(e.obj->>'amount', '')::numeric, nullif(e.obj->>'godown', ''), nullif(e.obj->>'batch', '')
  from _tv t join public.tally_vouchers v on v.company_id = v_co and v.tally_guid = t.guid,
       jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) with ordinality as e(obj, ord);
  get diagnostics m = row_count;
  return jsonb_build_object('vouchers', n, 'item_lines', m);
end $$;

-- vouchers in a date range that Tally no longer returns were deleted there: mark them, never delete them here
create or replace function public.tally_close_range(p_key text, p_company text, p_from date, p_to date, p_guids text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Bad date range'; end if;
  update public.tally_vouchers set deleted_at = now()
   where company_id = v_co and voucher_date between p_from and p_to and deleted_at is null and not (tally_guid = any(coalesce(p_guids, '{}')));
  get diagnostics n = row_count;
  return jsonb_build_object('marked_deleted', n);
end $$;

-- ---------------------------------------------------------------- permissions
do $$
declare f text;
begin
  for f in select unnest(array[
    'public.tally_check(text,text,text,text)', 'public.tally_request_done(text,uuid,boolean,text)', 'public.tally_request_sync(date,date)',
    'public.tally_run_start(text,text,text)', 'public.tally_run_finish(text,uuid,text,integer,text)',
    'public.tally_ingest_ledgers(text,text,jsonb)', 'public.tally_ingest_stock(text,text,jsonb)', 'public.tally_ingest_bills(text,text,text,date,jsonb)',
    'public.tally_ingest_vouchers(text,text,jsonb)', 'public.tally_close_range(text,text,date,date,text[])'])
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);  -- the connector arrives as anon; the key is the proof
  end loop;
  revoke all on function app.tally_connector(text) from public;
  revoke all on function app.tally_company(text) from public;
end $$;
-- the app button must not be callable without a signed-in person
revoke execute on function public.tally_request_sync(date, date) from anon;
