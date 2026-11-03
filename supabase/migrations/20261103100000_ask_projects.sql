-- Projects for the Digital Brain, like a folder of chats with standing instructions: a project has a name and a few lines of the person's own instructions
-- ("always answer in tonnes", "focus on SPF stock"), and the chats inside it are answered with those instructions.
-- Private to the person who made it (row rule: staff_id = me), like the chats. Writes go through the checked functions below.
-- Deleting a project never deletes its chats: they go back to the plain list.

create table public.ask_projects (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff (id),
  name         text not null check (char_length(name) between 1 and 60),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index ask_projects_person on public.ask_projects (staff_id, updated_at desc) where deleted_at is null;

alter table public.ask_projects enable row level security;
create policy own_projects on public.ask_projects for select to authenticated using (staff_id = (select app.my_staff_id()) and deleted_at is null);

alter table public.ask_chats add column project_id uuid references public.ask_projects (id) on delete set null;
create index ask_chats_project on public.ask_chats (project_id) where project_id is not null;

-- create (p_id null) or change a project of the person's own
create or replace function public.ask_project_save(p_id uuid, p_name text, p_instructions text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := left(btrim(coalesce(p_name, '')), 60);
begin
  if not coalesce(app.is_internal(), false) then raise exception 'Your account cannot use this' using errcode = 'insufficient_privilege'; end if;
  if v_name = '' then raise exception 'Give the project a name'; end if;
  if p_id is null then
    insert into public.ask_projects (staff_id, name, instructions) values (app.my_staff_id(), v_name, left(btrim(coalesce(p_instructions, '')), 2000)) returning id into v_id;
  else
    update public.ask_projects set name = v_name, instructions = left(btrim(coalesce(p_instructions, '')), 2000), updated_at = now()
     where id = p_id and staff_id = app.my_staff_id() and deleted_at is null returning id into v_id;
    if v_id is null then raise exception 'Project not found'; end if;
  end if;
  return v_id;
end $$;

-- remove a project; its chats stay and go back to the plain list
create or replace function public.ask_project_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ask_projects set deleted_at = now() where id = p_id and staff_id = app.my_staff_id() and deleted_at is null;
  update public.ask_chats set project_id = null where project_id = p_id and staff_id = app.my_staff_id();
end $$;

-- put a chat of the person's own into one of their projects (p_project null: take it out)
create or replace function public.ask_set_chat_project(p_chat uuid, p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_project is not null and not exists (select 1 from public.ask_projects where id = p_project and staff_id = app.my_staff_id() and deleted_at is null) then raise exception 'Project not found'; end if;
  update public.ask_chats set project_id = p_project where id = p_chat and staff_id = app.my_staff_id() and deleted_at is null;
  if not found then raise exception 'Chat not found'; end if;
end $$;

do $$
declare f text;
begin
  for f in select unnest(array['public.ask_project_save(uuid,text,text)', 'public.ask_project_delete(uuid)', 'public.ask_set_chat_project(uuid,uuid)'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
