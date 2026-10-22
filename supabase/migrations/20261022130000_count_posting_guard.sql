-- 18: refuse to send a count for approval when no plate was counted (it would propose writing off the whole book).

-- Send a closed count for approval: one request per plate. Owner or administrator only.
create or replace function public.post_count_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.count_sessions; r record; u record;
  v_block numeric := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'weight_tolerance_block_pct'), 5);
  v_day date; v_tier public.risk_tier; v_entity uuid;
  n_short int := 0; n_excess int := 0; n_missing int := 0; n_unknown int := 0; v_net numeric := 0;
begin
  if not coalesce(app.my_role() in ('owner', 'admin'), false) then
    raise exception 'Only the owner or an administrator can send a count for approval' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.count_sessions where id = p_session for update;
  if not found or s.status <> 'review' then raise exception 'Close the count first. Only a closed count can be sent for approval'; end if;
  if exists (select 1 from public.approval_requests where batch_id = p_session and kind = 'count_posting') then
    raise exception 'This count has already been sent for approval';
  end if;
  v_day := (s.started_at at time zone 'Asia/Kolkata')::date;
  -- a count with nothing counted would propose writing off every plate in the books
  if not exists (select 1 from public.count_lines where session_id = p_session and match_status <> 'rejected') then
    raise exception 'Nothing was counted in this count, so there is nothing to send for approval';
  end if;

  for r in select * from public.count_posting_preview(p_session) loop
    select entity_id into v_entity from public.lots where id = r.lot_id;
    v_tier := case when r.outcome = 'missing' or abs(r.adjust_kg) > greatest(abs(r.books_kg) * v_block / 100.0, 50) then 'high' else 'medium' end;
    insert into public.approval_requests (kind, status, risk_tier, entity_id, stock_book_id, subject_table, subject_id, proposed, batch_id, created_by_type, created_by)
    values ('count_posting', 'pending', v_tier, v_entity, s.stock_book_id, 'lots', r.lot_id,
            jsonb_build_object('count_name', s.name, 'session_id', p_session, 'lot_no', r.lot_no, 'ident', r.ident, 'grade', r.grade,
                               'outcome', r.outcome, 'books_kg', r.books_kg, 'counted_opening_kg', r.opening_kg,
                               'adjust_kg', r.adjust_kg, 'adjust_pcs', r.adjust_pcs, 'movement_date', v_day,
                               'books_now_kg', r.books_now_kg, 'window_out_kg', r.window_out_kg, 'window_in_kg', r.window_in_kg),
            p_session, 'staff', app.my_staff_id());
    v_net := v_net + r.adjust_kg;
    if r.outcome = 'short' then n_short := n_short + 1; elsif r.outcome = 'excess' then n_excess := n_excess + 1; else n_missing := n_missing + 1; end if;
  end loop;

  -- counted but not in the books: it cannot become a plate without its size and grade, so it goes to the review list
  for u in select upper(coalesce(c.plate_no, c.heat_no)) ident, sum(c.weight_kg) kg, sum(coalesce(c.pieces, 0)) pcs
           from public.count_lines c where c.session_id = p_session and c.matched_lot_id is null and c.match_status <> 'rejected' group by 1 loop
    insert into public.exceptions (kind, severity, message, context, related_table, related_id)
    values ('blocked_entry', 'error',
            format('Counted plate %s (%s kg) is not in the books. Add its grade and size to create the plate', u.ident, round(u.kg)),
            jsonb_build_object('session_id', p_session, 'ident', u.ident, 'weight_kg', u.kg, 'pieces', u.pcs), 'count_sessions', p_session);
    n_unknown := n_unknown + 1;
  end loop;

  return jsonb_build_object('short', n_short, 'excess', n_excess, 'missing', n_missing, 'unknown_counted', n_unknown, 'net_kg', v_net,
                            'requests', n_short + n_excess + n_missing);
end $$;

