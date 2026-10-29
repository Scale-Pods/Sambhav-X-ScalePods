-- 39: any model can be chosen for a chat or a saved question (Anthropic and OpenAI), not just "fast" and "balanced". A model is stored by its API id.
-- Old values are moved to the models they meant: fast = claude-haiku-5-5, balanced = claude-sonnet-5-5.

alter table public.ask_chats drop constraint ask_chats_model_check;
alter table public.ask_saved drop constraint ask_saved_model_check;
update public.ask_chats set model = case model when 'fast' then 'claude-haiku-5-5' when 'balanced' then 'claude-sonnet-5-5' else model end;
update public.ask_saved set model = case model when 'fast' then 'claude-haiku-5-5' when 'balanced' then 'claude-sonnet-5-5' else model end;
alter table public.ask_chats add constraint ask_chats_model_check check (model ~ '^[a-z0-9._-]{1,40}$');
alter table public.ask_saved add constraint ask_saved_model_check check (model ~ '^[a-z0-9._-]{1,40}$');
alter table public.ask_chats alter column model set default 'claude-haiku-5-5';
alter table public.ask_saved alter column model set default 'claude-haiku-5-5';

create or replace function public.ask_new_chat(p_title text, p_model text, p_scope text, p_origin text default 'brain')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  insert into public.ask_chats (staff_id, title, model, scope, origin)
  values (app.my_staff_id(), coalesce(nullif(left(btrim(p_title), 80), ''), 'New chat'), case when p_model ~ '^[a-z0-9._-]{1,40}$' then p_model else 'claude-haiku-5-5' end,
          coalesce(nullif(left(p_scope, 20), ''), 'all'), case when p_origin = 'ai_mode' then 'ai_mode' else 'brain' end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ask_update_chat(p_chat uuid, p_title text, p_pinned boolean, p_model text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ask_chats
     set title = coalesce(nullif(left(btrim(p_title), 80), ''), title), pinned = coalesce(p_pinned, pinned),
         model = case when p_model ~ '^[a-z0-9._-]{1,40}$' then p_model else model end, scope = coalesce(nullif(left(p_scope, 20), ''), scope)
   where id = p_chat and staff_id = app.my_staff_id() and deleted_at is null;
  if not found then raise exception 'Chat not found'; end if;
end $$;

create or replace function public.ask_save_question(p_title text, p_question text, p_model text, p_scope text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  if length(btrim(coalesce(p_question, ''))) < 2 then raise exception 'Nothing to save'; end if;
  if (select count(*) from public.ask_saved where staff_id = app.my_staff_id() and deleted_at is null) >= 50 then raise exception 'You can keep up to 50 saved questions'; end if;
  insert into public.ask_saved (staff_id, title, question, model, scope)
  values (app.my_staff_id(), coalesce(nullif(left(btrim(p_title), 80), ''), left(btrim(p_question), 60)), left(btrim(p_question), 600),
          case when p_model ~ '^[a-z0-9._-]{1,40}$' then p_model else 'claude-haiku-5-5' end, coalesce(nullif(left(p_scope, 20), ''), 'all'))
  returning id into v_id;
  return v_id;
end $$;
