-- 25: live progress of a Tally sync, so the Tally page can show a loader with a percentage while a run is going.
-- The connector reports where it is (stage, percent, what it is reading) at every step; the page reads it every few seconds.
alter table public.tally_sync_runs
  add column stage       text,
  add column progress    smallint,
  add column detail      text,
  add column progress_at timestamptz;

create or replace function public.tally_run_progress(p_key text, p_run uuid, p_stage text, p_pct integer, p_detail text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key);
begin
  update public.tally_sync_runs
     set stage = left(p_stage, 80), progress = greatest(0, least(coalesce(p_pct, 0), 99)), detail = left(p_detail, 120), progress_at = now()
   where id = p_run and status = 'running';
end $$;
revoke all on function public.tally_run_progress(text, uuid, text, integer, text) from public;
grant execute on function public.tally_run_progress(text, uuid, text, integer, text) to anon, authenticated;

-- a finished run shows 100 %, a failed one keeps where it stopped
create or replace function public.tally_run_finish(p_key text, p_run uuid, p_status text, p_records integer, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c uuid := app.tally_connector(p_key); v_co uuid;
begin
  update public.tally_sync_runs set finished_at = now(), status = case when p_status in ('ok', 'partial', 'failed') then p_status else 'failed' end,
         records_in = p_records, error = left(p_error, 500),
         progress = case when p_status = 'ok' then 100 else progress end, stage = case when p_status = 'ok' then 'Done' else stage end, progress_at = now()
   where id = p_run returning company_id into v_co;
  update public.tally_companies set last_sync_at = now(), last_status = p_status where id = v_co;
  if p_status = 'ok' then update public.tally_connectors set last_sync_ok_at = now() where id = c; end if;
end $$;
