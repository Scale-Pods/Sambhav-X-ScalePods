-- 29: limits on AI reading and stuck documents (break-it review findings 7 and 10).
-- 7. a daily spending cap, a cap on re-reading one document and a cap per person per hour, all checked in the database before a read starts.
-- 10. a document whose reading was cut off (the server stopped mid-read) used to stay on "Reading..." for ever; it now becomes "Not read" after 10 minutes
--     so it can be read again or rejected from the screen.

create table public.app_limits (
  key text primary key,
  num numeric not null,
  note text
);
alter table public.app_limits enable row level security;
create policy admin_read on public.app_limits for select to authenticated using ((select app.is_admin()));
insert into public.app_limits (key, num, note) values
  ('ai_daily_usd', 10, 'most the AI may cost per day (India time), in US dollars, across all document reading'),
  ('ai_reads_per_document', 3, 'how many times one document may be read'),
  ('ai_reads_per_person_hour', 60, 'how many reads one person may start per hour');

-- null = allowed; otherwise the reason, in words a person can read
create or replace function public.ai_read_allowed(p_doc uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_day numeric; v_spent numeric; v_per_doc numeric; v_per_hour numeric; v_me uuid := app.my_staff_id();
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then return 'Your role cannot read documents'; end if;
  select num into v_day from public.app_limits where key = 'ai_daily_usd';
  select num into v_per_doc from public.app_limits where key = 'ai_reads_per_document';
  select num into v_per_hour from public.app_limits where key = 'ai_reads_per_person_hour';
  select coalesce(sum(usd), 0) into v_spent from public.extraction_runs where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  if v_day is not null and v_spent >= v_day then return 'The daily limit for reading documents has been reached. It resets at midnight, or the administrator can raise it.'; end if;
  if v_per_doc is not null and (select count(*) from public.extraction_runs where document_id = p_doc and stage = 'first') >= v_per_doc then
    return 'This document has already been read ' || v_per_doc::int || ' times. Please review or reject it.';
  end if;
  if v_per_hour is not null and (select count(*) from public.extraction_runs where created_by = v_me and stage = 'first' and created_at > now() - interval '1 hour') >= v_per_hour then
    return 'Too many documents were read in the last hour. Please wait a little.';
  end if;
  return null;
end $$;

create or replace function public.ai_spend_today()
returns numeric language sql stable security definer set search_path = public as $$
  select case when app.is_admin()
              then coalesce((select sum(usd) from public.extraction_runs where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0)
         end
$$;

create or replace function public.expire_stuck_documents()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then return 0; end if;
  update public.documents
     set extraction_status = 'failed', extracted = jsonb_build_object('error', 'The reading was interrupted. You can read it again.')
   where review_status = 'pending' and extraction_status = 'pending' and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.ai_read_allowed(uuid) from public, anon;
revoke execute on function public.ai_spend_today() from public, anon;
revoke execute on function public.expire_stuck_documents() from public, anon;
grant execute on function public.ai_read_allowed(uuid) to authenticated;
grant execute on function public.ai_spend_today() to authenticated;
grant execute on function public.expire_stuck_documents() to authenticated;
