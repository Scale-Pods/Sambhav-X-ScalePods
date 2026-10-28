-- 38: AI mode (the quick answer panel in the top search bar). Its conversations are stored as Digital Brain chats, tagged with where they started,
-- so they show in the person's history and can be searched like any other chat.

alter table public.ask_chats add column origin text not null default 'brain' check (origin in ('brain', 'ai_mode'));

drop function public.ask_new_chat(text, text, text);
create function public.ask_new_chat(p_title text, p_model text, p_scope text, p_origin text default 'brain')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  insert into public.ask_chats (staff_id, title, model, scope, origin)
  values (app.my_staff_id(), coalesce(nullif(left(btrim(p_title), 80), ''), 'New chat'), case when p_model in ('fast', 'balanced') then p_model else 'balanced' end,
          coalesce(nullif(left(p_scope, 20), ''), 'all'), case when p_origin = 'ai_mode' then 'ai_mode' else 'brain' end)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.ask_new_chat(text, text, text, text) from public, anon;
grant execute on function public.ask_new_chat(text, text, text, text) to authenticated;
