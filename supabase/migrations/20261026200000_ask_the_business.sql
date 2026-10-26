-- 32: the "Ask" box (question in plain words, answered from read-only lookups). One row per question, with what it used and what it cost,
-- and limits (daily money, questions per person per hour) checked in the database before a question starts.
create table public.ask_log (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references public.staff (id),
  question   text not null,
  answer     text,
  tools      jsonb not null default '[]',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  usd        numeric(10, 5) not null default 0,
  seconds    numeric(7, 1),
  error      text,
  created_at timestamptz not null default now()
);
create index ask_log_created on public.ask_log (created_at desc);
alter table public.ask_log enable row level security;
create policy admin_read on public.ask_log for select to authenticated using ((select app.is_admin()));

insert into public.app_limits (key, num, note) values
  ('ask_daily_usd', 5, 'most the Ask box may cost per day (India time), in US dollars, for everyone together'),
  ('ask_per_person_hour', 40, 'how many questions one person may ask per hour');

create or replace function public.ask_allowed()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_day numeric; v_hour numeric; v_spent numeric; v_me uuid := app.my_staff_id();
begin
  if not coalesce(app.is_internal(), false) then return 'Your account cannot use this'; end if;
  select num into v_day from public.app_limits where key = 'ask_daily_usd';
  select num into v_hour from public.app_limits where key = 'ask_per_person_hour';
  select coalesce(sum(usd), 0) into v_spent from public.ask_log where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  if v_day is not null and v_spent >= v_day then return 'The daily limit for questions has been reached. It resets at midnight, or the administrator can raise it.'; end if;
  if v_hour is not null and (select count(*) from public.ask_log where staff_id = v_me and created_at > now() - interval '1 hour') >= v_hour then
    return 'Too many questions in the last hour. Please wait a little.';
  end if;
  return null;
end $$;

create or replace function public.record_ask(p_question text, p_answer text, p_tools jsonb, p_in integer, p_out integer, p_usd numeric, p_seconds numeric, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  insert into public.ask_log (staff_id, question, answer, tools, input_tokens, output_tokens, usd, seconds, error)
  values (app.my_staff_id(), left(p_question, 1000), left(p_answer, 6000), coalesce(p_tools, '[]'), coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_usd, 0), p_seconds, left(p_error, 500));
end $$;

revoke execute on function public.ask_allowed() from public, anon;
revoke execute on function public.record_ask(text, text, jsonb, integer, integer, numeric, numeric, text) from public, anon;
grant execute on function public.ask_allowed() to authenticated;
grant execute on function public.record_ask(text, text, jsonb, integer, integer, numeric, numeric, text) to authenticated;
