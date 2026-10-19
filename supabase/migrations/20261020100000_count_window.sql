-- 13: count-window mode.
-- The yard keeps selling while it is counted. Every plate that comes in or goes out while a count is open is logged
-- against the count, with the time it moved. When a plate is counted, whatever moved between the window opening and that
-- plate's count is backed out, which gives the true opening stock at the moment the window opened. The office does no sums.

create table public.count_window_movements (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.count_sessions(id),
  lot_id       uuid references public.lots(id),          -- null only when the plate number is unknown (goes to review)
  ident        text not null,                             -- plate / heat number as typed
  direction    text not null check (direction in ('in', 'out')),
  weight_kg    numeric not null check (weight_kg > 0),
  pieces       integer not null default 0 check (pieces >= 0),
  occurred_at  timestamptz not null,                      -- when the plate physically moved
  reference    text,                                      -- invoice / vehicle / slip number
  note         text,
  status       text not null default 'active' check (status in ('active', 'needs_plate', 'rejected')),
  entered_by   uuid references public.staff(id),
  entered_at   timestamptz not null default now()
);
create index count_window_movements_session on public.count_window_movements (session_id, lot_id, occurred_at);
create index count_window_movements_lot on public.count_window_movements (lot_id);
create index count_window_movements_staff on public.count_window_movements (entered_by);

alter table public.count_window_movements enable row level security;
grant select on public.count_window_movements to authenticated;
create policy book_read on public.count_window_movements for select to authenticated using (
  (select app.is_internal()) or exists (select 1 from public.count_sessions s where s.id = count_window_movements.session_id and app.can_see_book(s.stock_book_id))
);
create trigger count_window_movements_audit after insert or update on public.count_window_movements
  for each row execute function app.audit_row();

-- Log a movement during an open count. A plate the books do not know cannot be backed out, so it is saved as
-- "needs plate" and raised for review instead of being counted in the arithmetic.
create or replace function public.record_window_movement(
  p_session uuid, p_ident text, p_direction text, p_weight numeric, p_pieces integer,
  p_occurred_at timestamptz default null, p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.count_sessions; l public.lots; v_found boolean; v_norm text; v_id uuid; v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'office'), false) then
    raise exception 'You are not allowed to log movements during a count' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.count_sessions where id = p_session;
  if not found or s.status <> 'counting' then raise exception 'This count is not open'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Choose in or out'; end if;
  if p_weight is null or p_weight <= 0 then raise exception 'Weight must be more than zero'; end if;
  if v_at < s.started_at then raise exception 'That time is before the count window opened'; end if;
  if v_at > now() + interval '10 minutes' then raise exception 'That time is in the future'; end if;
  v_norm := app.norm_text(p_ident);
  if coalesce(v_norm, '') = '' then raise exception 'Enter the plate or heat number. Without it the movement cannot be backed out'; end if;

  select x.* into l from public.lots x
   where x.stock_book_id = s.stock_book_id
     and (x.match_key_norm = v_norm or app.norm_text(x.plate_no) = v_norm or app.norm_text(x.heat_no) = v_norm)
   order by (select coalesce(sum(m.weight_kg), 0) from public.stock_movements m where m.lot_id = x.id) desc
   limit 1;
  v_found := found;

  insert into public.count_window_movements (session_id, lot_id, ident, direction, weight_kg, pieces, occurred_at, reference, note, status, entered_by)
  values (p_session, case when v_found then l.id end, upper(trim(p_ident)), p_direction, p_weight, coalesce(p_pieces, 0), v_at,
          nullif(trim(p_reference), ''), nullif(trim(p_note), ''), case when v_found then 'active' else 'needs_plate' end, app.my_staff_id())
  returning id into v_id;

  if not v_found then
    insert into public.exceptions (kind, severity, message, context, related_table, related_id)
    values ('blocked_entry', 'error',
            format('Movement during the count for an unknown plate %s (%s %s kg): it cannot be backed out until the plate is identified', upper(trim(p_ident)), p_direction, p_weight),
            jsonb_build_object('session_id', p_session, 'movement_id', v_id), 'count_window_movements', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'status', case when v_found then 'active' else 'needs_plate' end, 'lot_no', case when v_found then l.lot_no end);
end $$;

create or replace function public.reject_window_movement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w public.count_window_movements; s public.count_sessions;
begin
  select * into w from public.count_window_movements where id = p_id;
  if not found then raise exception 'Movement not found'; end if;
  select * into s from public.count_sessions where id = w.session_id;
  if s.status <> 'counting' then raise exception 'This count is closed'; end if;
  if not (coalesce(app.my_role() in ('owner', 'admin'), false) or (w.entered_by is not null and w.entered_by = app.my_staff_id())) then
    raise exception 'You can only remove your own entries' using errcode = 'insufficient_privilege';
  end if;
  update public.count_window_movements set status = 'rejected' where id = p_id;
end $$;

-- Per plate: books when the window opened, what was counted, what moved before it was counted, the true opening stock
-- worked back from the count, and the difference. Runs with the caller's rights (row-level security applies).
create or replace function public.count_reconciliation(p_session uuid)
returns table (lot_id uuid, lot_no bigint, ident text, grade text, thickness_mm numeric, books_kg numeric, counted_kg numeric,
               count_lines integer, last_counted_at timestamptz, out_before_kg numeric, in_before_kg numeric,
               opening_kg numeric, diff_kg numeric, status text)
language sql stable security invoker set search_path = public as $$
  with s as (select cs.id, cs.stock_book_id, cs.started_at, (cs.started_at at time zone 'Asia/Kolkata')::date start_day
             from public.count_sessions cs where cs.id = p_session),
  tol as (select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'weight_tolerance_warn_pct'), 2) pct),
  books as (select l.id lot_id, coalesce(sum(m.weight_kg) filter (where m.movement_date < s.start_day), 0) kg
            from public.lots l cross join s left join public.stock_movements m on m.lot_id = l.id
            where l.stock_book_id = s.stock_book_id group by l.id),
  cnt as (select c.matched_lot_id lot_id, sum(c.weight_kg) kg, count(*)::int n, max(c.counted_at) last_at
          from public.count_lines c where c.session_id = p_session and c.match_status <> 'rejected' and c.matched_lot_id is not null
          group by 1),
  mv as (select w.lot_id,
                coalesce(sum(w.weight_kg) filter (where w.direction = 'out'), 0) out_kg,
                coalesce(sum(w.weight_kg) filter (where w.direction = 'in'), 0) in_kg
         from public.count_window_movements w join cnt on cnt.lot_id = w.lot_id cross join s
         where w.session_id = p_session and w.status = 'active' and w.occurred_at >= s.started_at and w.occurred_at <= cnt.last_at
         group by w.lot_id),
  r as (select l.id, l.lot_no, coalesce(l.plate_no, l.heat_no) ident, g.code grade, l.thickness_mm, b.kg books, cnt.kg counted,
               coalesce(cnt.n, 0) n, cnt.last_at, coalesce(mv.out_kg, 0) out_kg, coalesce(mv.in_kg, 0) in_kg,
               cnt.kg + coalesce(mv.out_kg, 0) - coalesce(mv.in_kg, 0) opening
        from books b join public.lots l on l.id = b.lot_id join public.grades g on g.id = l.grade_id
        left join cnt on cnt.lot_id = b.lot_id left join mv on mv.lot_id = b.lot_id
        where b.kg > 0.5 or cnt.lot_id is not null)
  select r.id, r.lot_no, r.ident, r.grade, r.thickness_mm, r.books, r.counted, r.n, r.last_at, r.out_kg, r.in_kg, r.opening,
         r.opening - r.books,
         case when r.counted is null then 'not_counted'
              when abs(r.opening - r.books) <= greatest(1, abs(r.books) * (select pct from tol) / 100) then 'matched'
              when r.opening < r.books then 'short' else 'excess' end
  from r
$$;

revoke all on function public.record_window_movement(uuid, text, text, numeric, integer, timestamptz, text, text) from public, anon;
revoke all on function public.reject_window_movement(uuid) from public, anon;
revoke all on function public.count_reconciliation(uuid) from public, anon;
grant execute on function public.record_window_movement(uuid, text, text, numeric, integer, timestamptz, text, text) to authenticated;
grant execute on function public.reject_window_movement(uuid) to authenticated;
grant execute on function public.count_reconciliation(uuid) to authenticated;

-- The instant check on the count screen now allows for what was already logged as moving during the window,
-- so a plate partly sold before it was counted shows "matches" rather than "differs".
create or replace function public.record_count_line(p_session uuid, p_ident text, p_weight numeric, p_pieces integer, p_yard text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.count_sessions; l public.lots; v_found boolean; v_norm text; v_books numeric; v_pcs integer; v_moved numeric := 0;
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
    select coalesce(sum(case when direction = 'in' then weight_kg else -weight_kg end), 0) into v_moved
      from public.count_window_movements
     where session_id = p_session and lot_id = l.id and status = 'active' and occurred_at >= s.started_at and occurred_at <= now();
    v_books := v_books + v_moved;
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
                            'books_kg', case when v_found then v_books end, 'books_pieces', case when v_found then v_pcs end,
                            'moved_in_window_kg', v_moved);
end $$;
