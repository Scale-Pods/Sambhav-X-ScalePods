-- 26: guards on what the Tally connector may write (break-it review findings 2, 3 and 4).
-- A connector that reads wrongly (a changed field name, the wrong Tally on the wrong port) must not be able to damage what is already here.

-- 4. a connector may write to one company only: the key proves who it is, `allowed_company` says which company it may touch (an ilike pattern)
alter table public.tally_connectors add column allowed_company text;
update public.tally_connectors set allowed_company = '%SAMBHAV%' where allowed_company is null;

create or replace function app.tally_connector(p_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(length(p_key), 0) < 32 then raise exception 'Invalid connector key' using errcode = '28000'; end if;
  select id into v_id from public.tally_connectors
   where key_hash = encode(sha256(convert_to(p_key, 'utf8')), 'hex') and active;
  if v_id is null then raise exception 'Invalid connector key' using errcode = '28000'; end if;
  update public.tally_connectors set last_seen_at = now() where id = v_id;
  perform set_config('app.tally_connector_id', v_id::text, true);   -- for app.tally_company, this transaction only
  return v_id;
end $$;

create or replace function app.tally_company(p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ent uuid; v_pat text;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'The company name is missing'; end if;
  select allowed_company into v_pat from public.tally_connectors where id = nullif(current_setting('app.tally_connector_id', true), '')::uuid;
  if v_pat is null then raise exception 'This connector has no company it may write to' using errcode = '42501'; end if;
  if p_name not ilike v_pat then raise exception 'This connector may only write to companies like %, not to %', v_pat, p_name using errcode = '42501'; end if;
  select id into v_id from public.tally_companies where tally_name = p_name;
  if v_id is null then
    select id into v_ent from public.entities where code = 'SPF';
    insert into public.tally_companies (tally_name, entity_id, last_status) values (p_name, v_ent, 'created')
    on conflict (tally_name) do update set tally_name = excluded.tally_name returning id into v_id;
  end if;
  return v_id;
end $$;

-- 3. the outstanding bills are replaced as a whole list: refuse a list that is empty or a fraction of what we hold (a reading failure, not real payments)
create or replace function public.tally_ingest_bills(p_key text, p_company text, p_kind text, p_as_of date, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int; v_old int; v_new int;
begin
  if p_kind not in ('receivable', 'payable') then raise exception 'Unknown bill kind'; end if;
  select count(*) into v_old from public.tally_outstanding_bills where company_id = v_co and kind = p_kind;
  select count(*) into v_new from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(party text) where coalesce(x.party, '') <> '';
  if (v_old >= 5 and v_new = 0) or (v_old >= 20 and v_new < v_old * 0.5) then
    raise exception 'Refusing to replace % % bills with only %: that looks like a reading failure, not real payments', v_old, p_kind, v_new using errcode = '22023';
  end if;
  delete from public.tally_outstanding_bills where company_id = v_co and kind = p_kind;
  insert into public.tally_outstanding_bills (company_id, kind, party_ledger, bill_ref, bill_date, due_date, pending_amount, as_of)
  select v_co, p_kind, x.party, nullif(x.ref, ''), nullif(x.bill_date, '')::date, nullif(x.due_date, '')::date, abs(x.pending), p_as_of
  from jsonb_to_recordset(p_items) as x(party text, ref text, bill_date text, due_date text, pending numeric)
  where coalesce(x.party, '') <> '';
  get diagnostics n = row_count;
  return jsonb_build_object('bills', n);
end $$;

-- 2. vouchers Tally no longer returns are marked deleted, but never a large share of a window: that is a reading failure, not deletions
create or replace function public.tally_close_range(p_key text, p_company text, p_from date, p_to date, p_guids text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key); v_co uuid := app.tally_company(p_company); n int; v_live int; v_gone int;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Bad date range'; end if;
  select count(*), count(*) filter (where not (tally_guid = any(coalesce(p_guids, '{}')))) into v_live, v_gone
    from public.tally_vouchers where company_id = v_co and voucher_date between p_from and p_to and deleted_at is null;
  if v_gone > greatest(5, v_live * 0.3) then
    raise exception 'Refusing to mark % of % vouchers as deleted (% to %): Tally returned % vouchers, which looks like a reading failure, not real deletions',
      v_gone, v_live, p_from, p_to, coalesce(cardinality(p_guids), 0) using errcode = '22023';
  end if;
  update public.tally_vouchers set deleted_at = now()
   where company_id = v_co and voucher_date between p_from and p_to and deleted_at is null and not (tally_guid = any(coalesce(p_guids, '{}')));
  get diagnostics n = row_count;
  return jsonb_build_object('marked_deleted', n);
end $$;
