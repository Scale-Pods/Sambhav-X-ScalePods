-- 37: saved questions for the Ask screen: a person's own list of questions they ask again and again (with the model and "Look in" they like for it).
-- Private to the person (row rule: staff_id = me); writes go through the two checked functions.

create table public.ask_saved (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff (id),
  title      text not null,
  question   text not null,
  model      text not null default 'balanced' check (model in ('fast', 'balanced')),
  scope      text not null default 'all',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ask_saved_person on public.ask_saved (staff_id, created_at desc) where deleted_at is null;

alter table public.ask_saved enable row level security;
create policy own_saved on public.ask_saved for select to authenticated using (staff_id = (select app.my_staff_id()) and deleted_at is null);

create or replace function public.ask_save_question(p_title text, p_question text, p_model text, p_scope text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  if length(btrim(coalesce(p_question, ''))) < 2 then raise exception 'Nothing to save'; end if;
  if (select count(*) from public.ask_saved where staff_id = app.my_staff_id() and deleted_at is null) >= 50 then raise exception 'You can keep up to 50 saved questions'; end if;
  insert into public.ask_saved (staff_id, title, question, model, scope)
  values (app.my_staff_id(), coalesce(nullif(left(btrim(p_title), 80), ''), left(btrim(p_question), 60)), left(btrim(p_question), 600),
          case when p_model in ('fast', 'balanced') then p_model else 'balanced' end, coalesce(nullif(left(p_scope, 20), ''), 'all'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ask_delete_saved(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ask_saved set deleted_at = now() where id = p_id and staff_id = app.my_staff_id() and deleted_at is null;
end $$;

do $$
declare f text;
begin
  for f in select unnest(array['public.ask_save_question(text,text,text,text)', 'public.ask_delete_saved(uuid)'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
