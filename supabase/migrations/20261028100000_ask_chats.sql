-- 36: chats for the Ask screen (history like Claude's): each person's own conversations and messages, with feedback, plus the model used on every logged question.
-- Chats are private to the person who had them (row rules: staff_id = me). Writes go through the checked functions below. The admin audit page reads ask_log, not the chats.

create table public.ask_chats (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff (id),
  title      text not null default 'New chat',
  model      text not null default 'balanced' check (model in ('fast', 'balanced')),
  scope      text not null default 'all',
  pinned     boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ask_chats_person on public.ask_chats (staff_id, updated_at desc) where deleted_at is null;

create table public.ask_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.ask_chats (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  meta       jsonb not null default '{}',     -- assistant: sources, follow_ups, confidence, lookups used, model, usd
  feedback   smallint check (feedback in (-1, 1)),
  created_at timestamptz not null default now()
);
create index ask_messages_chat on public.ask_messages (chat_id, created_at);

alter table public.ask_chats enable row level security;
alter table public.ask_messages enable row level security;
create policy own_chats on public.ask_chats for select to authenticated using (staff_id = (select app.my_staff_id()) and deleted_at is null);
create policy own_messages on public.ask_messages for select to authenticated
  using (exists (select 1 from public.ask_chats c where c.id = chat_id and c.staff_id = (select app.my_staff_id()) and c.deleted_at is null));

alter table public.ask_log add column model text, add column chat_id uuid;

create or replace function public.ask_new_chat(p_title text, p_model text, p_scope text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  insert into public.ask_chats (staff_id, title, model, scope)
  values (app.my_staff_id(), coalesce(nullif(left(btrim(p_title), 80), ''), 'New chat'), case when p_model in ('fast', 'balanced') then p_model else 'balanced' end, coalesce(nullif(left(p_scope, 20), ''), 'all'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ask_add_message(p_chat uuid, p_role text, p_content text, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.ask_chats where id = p_chat and staff_id = app.my_staff_id() and deleted_at is null) then raise exception 'Chat not found'; end if;
  if p_role not in ('user', 'assistant') then raise exception 'Bad role'; end if;
  insert into public.ask_messages (chat_id, role, content, meta) values (p_chat, p_role, left(p_content, 8000), coalesce(p_meta, '{}')) returning id into v_id;
  update public.ask_chats set updated_at = now() where id = p_chat;
  return v_id;
end $$;

create or replace function public.ask_update_chat(p_chat uuid, p_title text, p_pinned boolean, p_model text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ask_chats
     set title = coalesce(nullif(left(btrim(p_title), 80), ''), title), pinned = coalesce(p_pinned, pinned),
         model = case when p_model in ('fast', 'balanced') then p_model else model end, scope = coalesce(nullif(left(p_scope, 20), ''), scope)
   where id = p_chat and staff_id = app.my_staff_id() and deleted_at is null;
  if not found then raise exception 'Chat not found'; end if;
end $$;

create or replace function public.ask_delete_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ask_chats set deleted_at = now() where id = p_chat and staff_id = app.my_staff_id() and deleted_at is null;
end $$;

-- regenerate: remove the last answer of a chat so a new one can be made
create or replace function public.ask_drop_last_answer(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ask_chats where id = p_chat and staff_id = app.my_staff_id() and deleted_at is null) then raise exception 'Chat not found'; end if;
  delete from public.ask_messages where id = (select id from public.ask_messages where chat_id = p_chat and role = 'assistant' order by created_at desc limit 1);
end $$;

create or replace function public.ask_set_feedback(p_msg uuid, p_val smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ask_messages m set feedback = case when p_val in (-1, 1) then p_val end
   where m.id = p_msg and m.role = 'assistant' and exists (select 1 from public.ask_chats c where c.id = m.chat_id and c.staff_id = app.my_staff_id());
end $$;

-- the log now keeps the model and the chat
create or replace function public.record_ask2(p_question text, p_answer text, p_tools jsonb, p_in integer, p_out integer, p_usd numeric, p_seconds numeric, p_error text, p_model text, p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  insert into public.ask_log (staff_id, question, answer, tools, input_tokens, output_tokens, usd, seconds, error, model, chat_id)
  values (app.my_staff_id(), left(p_question, 1000), left(p_answer, 6000), coalesce(p_tools, '[]'), coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_usd, 0), p_seconds, left(p_error, 500), left(p_model, 20), p_chat);
end $$;

-- today's spending against the daily limit, for the owner and administrators
create or replace function public.ask_spend_today()
returns table (spent numeric, cap numeric) language sql stable security definer set search_path = public as $$
  select coalesce(sum(usd), 0), (select num from public.app_limits where key = 'ask_daily_usd')
    from public.ask_log where app.is_admin() and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
$$;

do $$
declare f text;
begin
  for f in select unnest(array['public.ask_new_chat(text,text,text)', 'public.ask_add_message(uuid,text,text,jsonb)', 'public.ask_update_chat(uuid,text,boolean,text,text)',
      'public.ask_delete_chat(uuid)', 'public.ask_drop_last_answer(uuid)', 'public.ask_set_feedback(uuid,smallint)',
      'public.record_ask2(text,text,jsonb,integer,integer,numeric,numeric,text,text,uuid)', 'public.ask_spend_today()'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
