-- 17: close the count into the books.
-- A closed count (status 'review') is turned into correcting entries, never overwriting anything:
--   * a plate that was counted short or in excess of the books (beyond the tolerance)  -> an adjustment, sent for approval
--   * a plate the books show but nobody found (not counted)                              -> a write-off proposal, high risk, a reason is required
--   * a plate that was counted but is not in the books                                   -> a "needs review" item (it needs its details before a plate can be created)
-- Nothing reaches the ledger until a person other than the one who sent it approves (the existing maker-checker rule in
-- decide_approval). On approval an 'adjustment' movement is written, linked to the approval. When every request has been
-- decided the count becomes 'posted'.

create unique index approval_requests_count_plate on public.approval_requests (batch_id, subject_id) where kind = 'count_posting';

-- What would be sent for approval, per plate. Runs with the caller's rights.
create or replace function public.count_posting_preview(p_session uuid)
returns table (lot_id uuid, lot_no bigint, ident text, grade text, thickness_mm numeric, outcome text,
               books_kg numeric, opening_kg numeric, adjust_kg numeric,
               books_pcs integer, opening_pcs integer, adjust_pcs integer,
               books_now_kg numeric, window_out_kg numeric, window_in_kg numeric)
language sql stable security invoker set search_path = public as $$
  with s as (select cs.id, cs.stock_book_id, cs.started_at, (cs.started_at at time zone 'Asia/Kolkata')::date start_day
             from public.count_sessions cs where cs.id = p_session),
  rec as (select * from public.count_reconciliation(p_session)),
  bk as (select l.id lot_id,
                coalesce(sum(m.pieces) filter (where m.movement_date < s.start_day), 0)::int books_pcs,
                coalesce(sum(m.weight_kg), 0) books_now
         from public.lots l cross join s left join public.stock_movements m on m.lot_id = l.id
         where l.stock_book_id = s.stock_book_id group by l.id),
  cnt as (select c.matched_lot_id lot_id, coalesce(sum(c.pieces), 0)::int n_pcs, max(c.counted_at) last_at
          from public.count_lines c where c.session_id = p_session and c.match_status <> 'rejected' and c.matched_lot_id is not null group by 1),
  mv as (select w.lot_id,
                coalesce(sum(w.pieces) filter (where w.direction = 'out' and w.occurred_at <= cnt.last_at), 0)::int out_p,
                coalesce(sum(w.pieces) filter (where w.direction = 'in' and w.occurred_at <= cnt.last_at), 0)::int in_p,
                coalesce(sum(w.weight_kg) filter (where w.direction = 'out'), 0) out_kg,
                coalesce(sum(w.weight_kg) filter (where w.direction = 'in'), 0) in_kg
         from public.count_window_movements w left join cnt on cnt.lot_id = w.lot_id
         where w.session_id = p_session and w.status = 'active' and w.lot_id is not null group by w.lot_id)
  select rec.lot_id, rec.lot_no, rec.ident, rec.grade, rec.thickness_mm,
         case rec.status when 'short' then 'short' when 'excess' then 'excess' else 'missing' end,
         rec.books_kg, rec.opening_kg,
         case when rec.status = 'not_counted' then -round(bk.books_now, 2) else round(rec.opening_kg - rec.books_kg, 2) end,
         bk.books_pcs,
         case when rec.status = 'not_counted' then 0 else cnt.n_pcs + coalesce(mv.out_p, 0) - coalesce(mv.in_p, 0) end,
         -- pieces are only corrected when the counters typed them
         case when rec.status = 'not_counted' then 0
              when cnt.n_pcs > 0 then cnt.n_pcs + coalesce(mv.out_p, 0) - coalesce(mv.in_p, 0) - bk.books_pcs else 0 end,
         round(bk.books_now, 2), coalesce(mv.out_kg, 0), coalesce(mv.in_kg, 0)
  from rec join bk on bk.lot_id = rec.lot_id left join cnt on cnt.lot_id = rec.lot_id left join mv on mv.lot_id = rec.lot_id
  where rec.status in ('short', 'excess') or (rec.status = 'not_counted' and bk.books_now > 0.5)
$$;

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

-- When a request is decided: an approval writes the adjustment; every decision can complete the count.
create or replace function app.apply_count_posting()
returns trigger language plpgsql security definer set search_path = public as $$
declare f jsonb := coalesce(new.final, new.proposed); v_kg numeric; v_p integer;
begin
  if new.kind <> 'count_posting' or old.status <> 'pending' or new.status not in ('approved', 'corrected', 'rejected') then return new; end if;
  if new.status in ('approved', 'corrected') then
    v_kg := coalesce((f ->> 'adjust_kg')::numeric, 0);
    v_p := coalesce((f ->> 'adjust_pcs')::integer, 0);
    if v_kg <> 0 or v_p <> 0 then
      insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, approval_request_id, note, created_by)
      values (new.subject_id, 'adjustment', v_p, v_kg, (f ->> 'movement_date')::date, new.id,
              format('Physical count "%s": %s (books %s kg, counted %s kg)', f ->> 'count_name', f ->> 'outcome', f ->> 'books_kg', coalesce(f ->> 'counted_opening_kg', 'not found')),
              new.decided_by);
    end if;
  end if;
  if not exists (select 1 from public.approval_requests where batch_id = new.batch_id and kind = 'count_posting' and status = 'pending') then
    update public.count_sessions set status = 'posted' where id = new.batch_id and status = 'review';
  end if;
  return new;
end $$;
create trigger approval_apply_count_posting after update of status on public.approval_requests
  for each row execute function app.apply_count_posting();

revoke all on function public.count_posting_preview(uuid) from public, anon;
revoke all on function public.post_count_session(uuid) from public, anon;
revoke all on function app.apply_count_posting() from public, anon, authenticated;
grant execute on function public.count_posting_preview(uuid) to authenticated;
grant execute on function public.post_count_session(uuid) to authenticated;
