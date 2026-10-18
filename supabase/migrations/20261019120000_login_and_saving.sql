-- 11: login linking and the first things the front end may save.
-- Principle kept: the app role can only READ tables; every write goes through a function that checks who is asking.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. A person who signs in is matched to a staff row by e-mail address. No staff row = no data (row-level security).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function app.link_staff_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.staff
     set auth_user_id = new.id
   where auth_user_id is null and active and email is not null and lower(email) = lower(new.email);
  return new;
end $$;

drop trigger if exists link_staff_on_signup on auth.users;
create trigger link_staff_on_signup after insert on auth.users
  for each row execute function app.link_staff_on_signup();

-- the ScalePods administrator (the person building and supporting the system)
insert into public.staff (full_name, email, role, job_title)
select 'Hrishikesh (ScalePods)', 'marketing@scalepods.co', 'admin', 'ScalePods administrator'
where not exists (select 1 from public.staff where lower(email) = 'marketing@scalepods.co');

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Physical count: start, record, reject, close
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.start_count_session(p_book text, p_name text, p_planned date default null)
returns public.count_sessions language plpgsql security definer set search_path = public as $$
declare v_book uuid; r public.count_sessions;
begin
  if not coalesce(app.my_role() in ('owner', 'admin'), false) then
    raise exception 'Only the owner or an administrator can open a count' using errcode = 'insufficient_privilege';
  end if;
  select id into v_book from public.stock_books where code = p_book and active;
  if v_book is null then raise exception 'Unknown stock book %', p_book; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the count a name'; end if;
  if exists (select 1 from public.count_sessions where stock_book_id = v_book and status = 'counting') then
    raise exception 'A count is already open for %', p_book;
  end if;
  insert into public.count_sessions (stock_book_id, name, planned_date, started_at, status, created_by)
  values (v_book, trim(p_name), p_planned, now(), 'counting', app.my_staff_id())
  returning * into r;
  return r;
end $$;

create or replace function public.record_count_line(p_session uuid, p_ident text, p_weight numeric, p_pieces integer, p_yard text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.count_sessions; l public.lots; v_found boolean; v_norm text; v_books numeric; v_pcs integer;
  v_warn numeric := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'weight_tolerance_warn_pct'), 2);
  v_status text; v_line uuid; v_yard uuid;
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'office'), false) then
    raise exception 'You are not allowed to record counts' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.count_sessions where id = p_session;
  if not found or s.status <> 'counting' then raise exception 'This count is not open'; end if;
  if p_weight is null or p_weight < 0 then raise exception 'Weight must be zero or more'; end if;
  v_norm := app.norm_text(p_ident);
  if coalesce(v_norm, '') = '' then raise exception 'Enter a plate or heat number'; end if;
  if p_yard is not null then select id into v_yard from public.yards where code = p_yard; end if;

  select x.* into l from public.lots x
   where x.stock_book_id = s.stock_book_id
     and (x.match_key_norm = v_norm or app.norm_text(x.plate_no) = v_norm or app.norm_text(x.heat_no) = v_norm)
   order by (select coalesce(sum(m.weight_kg), 0) from public.stock_movements m where m.lot_id = x.id) desc
   limit 1;
  v_found := found;

  if v_found then
    select coalesce(sum(weight_kg), 0), coalesce(sum(pieces), 0) into v_books, v_pcs from public.stock_movements where lot_id = l.id;
    v_status := case when abs(p_weight - v_books) <= greatest(1, abs(v_books) * v_warn / 100) then 'matched' else 'discrepancy' end;
  else
    v_status := 'unmatched';
  end if;

  insert into public.count_lines (session_id, yard_id, grade_id, grade_raw, heat_no, plate_no, thickness_mm, width_mm, length_mm,
                                  pieces, weight_kg, counted_by, matched_lot_id, match_status)
  values (p_session, v_yard, case when v_found then l.grade_id end, case when v_found then l.grade_raw end,
          case when v_found then l.heat_no end, case when v_found then l.plate_no else upper(trim(p_ident)) end,
          case when v_found then l.thickness_mm end, case when v_found then l.width_mm end, case when v_found then l.length_mm end,
          p_pieces, p_weight, app.my_staff_id(), case when v_found then l.id end, v_status)
  returning id into v_line;

  return jsonb_build_object('id', v_line, 'match_status', v_status, 'lot_no', case when v_found then l.lot_no end,
                            'books_kg', case when v_found then v_books end, 'books_pieces', case when v_found then v_pcs end);
end $$;

create or replace function public.reject_count_line(p_line uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ln public.count_lines; s public.count_sessions;
begin
  select * into ln from public.count_lines where id = p_line;
  if not found then raise exception 'Count line not found'; end if;
  select * into s from public.count_sessions where id = ln.session_id;
  if s.status <> 'counting' then raise exception 'This count is closed'; end if;
  if not (coalesce(app.my_role() in ('owner', 'admin'), false) or (ln.counted_by is not null and ln.counted_by = app.my_staff_id())) then
    raise exception 'You can only remove your own entries' using errcode = 'insufficient_privilege';
  end if;
  update public.count_lines set match_status = 'rejected' where id = p_line;
end $$;

create or replace function public.close_count_session(p_session uuid)
returns public.count_sessions language plpgsql security definer set search_path = public as $$
declare r public.count_sessions;
begin
  if not coalesce(app.my_role() in ('owner', 'admin'), false) then
    raise exception 'Only the owner or an administrator can close a count' using errcode = 'insufficient_privilege';
  end if;
  update public.count_sessions set status = 'review', closed_at = now() where id = p_session and status = 'counting' returning * into r;
  if not found then raise exception 'This count is not open'; end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Needs-review items: approve with a reason (kept in the audit log)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.resolve_exception(p_id uuid, p_status text, p_note text)
returns public.exceptions language plpgsql security definer set search_path = public as $$
declare e public.exceptions; before_row jsonb;
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver'), false) then
    raise exception 'You are not allowed to decide review items' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('resolved', 'ignored') then raise exception 'Invalid decision %', p_status; end if;
  if length(coalesce(trim(p_note), '')) < 3 then raise exception 'Write a short reason'; end if;
  select to_jsonb(x) into before_row from public.exceptions x where x.id = p_id and x.status = 'open' for update;
  if before_row is null then raise exception 'This item is not open'; end if;
  update public.exceptions
     set status = p_status, resolved_by = app.my_staff_id(), resolved_at = now(), resolution_note = trim(p_note)
   where id = p_id returning * into e;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, before_data, after_data)
  values ('staff', app.my_staff_id(), 'update', 'exceptions', p_id, before_row, to_jsonb(e));
  return e;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Only signed-in people may call these (never the public key without a login)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.start_count_session(text, text, date) from public, anon;
revoke all on function public.record_count_line(uuid, text, numeric, integer, text) from public, anon;
revoke all on function public.reject_count_line(uuid) from public, anon;
revoke all on function public.close_count_session(uuid) from public, anon;
revoke all on function public.resolve_exception(uuid, text, text) from public, anon;
grant execute on function public.start_count_session(text, text, date) to authenticated;
grant execute on function public.record_count_line(uuid, text, numeric, integer, text) to authenticated;
grant execute on function public.reject_count_line(uuid) to authenticated;
grant execute on function public.close_count_session(uuid) to authenticated;
grant execute on function public.resolve_exception(uuid, text, text) to authenticated;
revoke all on function app.link_staff_on_signup() from public, anon, authenticated;
