-- 63: a challan whose sales are already in the stock book.
-- Until now the sales came into the stock book from the stock sheets (the daily load), each with its challan number in the note ("invoice 216, V.NO T808").
-- Posting such a challan from the app would take the same plates out a second time. Two changes to public.post_challan:
--   1. a line may be marked "recorded": the dispatch line is kept (the challan, the plate, the pieces) and NO stock moves, because the book already has the sale;
--   2. a line that would post a sale on a plate which already has a sale for the same challan number is refused, naming the existing sale, so it cannot be done by accident.
-- Taking a posting back (unpost_challan) is unchanged: a recorded line has no sale of its own, so nothing is reversed for it.
-- Applied.

create or replace function public.post_challan(p_doc uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  d public.documents; fin jsonb; lines jsonb; l jsonb; a jsonb;
  v_ent uuid; v_code text; v_no text; v_date date; v_dispatch uuid; v_dl uuid; v_lot uuid; v_lot_no bigint; v_n int; i int;
  v_pieces int; v_kg numeric; v_posted int := 0; v_supply int := 0; v_recorded int := 0; v_label text; v_pattern text; v_dup text;
begin
  if app.my_role()::text not in ('owner', 'admin', 'approver') then raise exception 'Only an approver, an administrator or the owner may post a challan to stock'; end if;
  -- the "not below zero" rule of the stock table is checked when a transaction ends; here it is checked at each line, so a refusal names the line and the plate
  set constraints stock_movements_balance immediate;
  select * into d from public.documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  if coalesce(d.extracted->>'family', '') <> 'challan' then raise exception 'This document is not a delivery challan'; end if;
  if d.review_status <> 'confirmed' then raise exception 'The reading has not been confirmed yet: confirm it first'; end if;
  -- the reading a person confirmed (with their corrections), never what the browser sends
  select r.final into fin from public.document_reviews r where r.document_id = p_doc and r.decision in ('confirmed', 'corrected') order by r.reviewed_at desc limit 1;
  if fin is null then raise exception 'There is no confirmed reading for this document'; end if;
  v_code := fin->>'entity';
  select e.id into v_ent from public.entities e where e.code = v_code;
  if v_ent is null then raise exception 'The challan does not say whether it is from SPF or Sai'; end if;
  v_no := btrim(coalesce(fin->>'challan_no', ''));
  if v_no = '' then raise exception 'The challan has no number'; end if;
  begin v_date := (fin->>'challan_date')::date; exception when others then v_date := null; end;
  if v_date is null then raise exception 'The challan has no valid date'; end if;
  if exists (select 1 from public.dispatches where slip_document_id = p_doc and status <> 'cancelled') then raise exception 'This challan has already been posted'; end if;
  if exists (select 1 from public.dispatches where entity_id = v_ent and lower(challan_no) = lower(v_no) and status <> 'cancelled') then
    raise exception 'Challan % of % was already posted from another upload', v_no, v_code;
  end if;
  lines := coalesce(fin->'lines', '[]'); v_n := jsonb_array_length(lines);
  if v_n = 0 then raise exception 'The challan has no lines'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> v_n then raise exception 'Every line needs a decision (a plate, "already in the stock book", or "not from our stock")'; end if;
  -- how the stock sheets write a challan number in a sale's note: V.NO T808 (the character after it must not continue the number)
  v_pattern := 'V\.?\s*NO\.?\s*' || regexp_replace(v_no, '([^A-Za-z0-9])', '\\\1', 'g') || '(?![A-Za-z0-9])';

  insert into public.dispatches (status, dispatched_on, vehicle_no, slip_document_id, challan_no, entity_id, plot)
  values ('completed', v_date, nullif(btrim(fin->>'vehicle_no'), ''), p_doc, v_no, v_ent, nullif(btrim(fin->>'plot'), ''))
  returning id into v_dispatch;

  for i in 0 .. v_n - 1 loop
    l := lines->i;
    select x into a from jsonb_array_elements(p_lines) x where (x->>'n')::int = i limit 1;
    if a is null then raise exception 'Line % has no decision', i + 1; end if;
    v_label := coalesce(nullif(btrim(l->>'heat_no'), ''), 'no number') || ' ' || coalesce(l->>'thickness_mm', '?') || 'x' || coalesce(l->>'width_mm', '?') || 'x' || coalesce(l->>'length_mm', '?');
    v_pieces := coalesce(nullif(a->>'pieces', '')::int, nullif(l->>'pieces', '')::int);
    v_kg := nullif(a->>'weight_kg', '')::numeric;
    if coalesce(a->>'lot_id', '') = '' then
      insert into public.dispatch_lines (dispatch_id, pieces, weight_kg, note) values (v_dispatch, v_pieces, v_kg, 'Not from our stock: ' || v_label);
      v_supply := v_supply + 1;
    else
      v_lot := (a->>'lot_id')::uuid;
      select lot_no into v_lot_no from public.lots where id = v_lot;
      if not found then raise exception 'Line %: that plate does not exist', i + 1; end if;
      if coalesce((a->>'recorded')::boolean, false) then
        -- the stock book already has this sale: keep the link, move nothing
        insert into public.dispatch_lines (dispatch_id, lot_id, pieces, weight_kg, note)
        values (v_dispatch, v_lot, v_pieces, v_kg, 'Already in the stock book (from the stock sheet); no stock moved. ' || v_label);
        v_recorded := v_recorded + 1;
        continue;
      end if;
      select m.note into v_dup from public.stock_movements m
       where m.lot_id = v_lot and m.movement_type = 'sale' and m.note ~* v_pattern
         and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id) limit 1;
      if found then
        raise exception 'Line % (%): plate % already has a sale for challan % in the stock book (%). Choose "Already in the stock book" for this line.', i + 1, v_label, v_lot_no, v_no, left(v_dup, 90);
      end if;
      if v_pieces is null or v_pieces < 1 then raise exception 'Line % (%): the number of pieces is missing', i + 1, v_label; end if;
      if v_kg is null or v_kg <= 0 then raise exception 'Line % (%): the weight is missing', i + 1, v_label; end if;
      insert into public.dispatch_lines (dispatch_id, lot_id, pieces, weight_kg, note)
      values (v_dispatch, v_lot, v_pieces, v_kg, nullif('Balance written: ' || btrim(coalesce(l->>'balance', '')), 'Balance written:')) returning id into v_dl;
      begin
        insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, dispatch_line_id, source_document_id, note)
        values (v_lot, 'sale', -v_pieces, -v_kg, v_date, v_dl, p_doc,
                'Challan ' || v_no || ' (' || v_code || '), vehicle ' || coalesce(nullif(btrim(fin->>'vehicle_no'), ''), '?') || case when btrim(coalesce(l->>'balance', '')) <> '' then ', balance written ' || btrim(l->>'balance') else '' end);
      exception when check_violation then
        raise exception 'Line % (%): plate % cannot take this: %', i + 1, v_label, v_lot_no, sqlerrm;
      end;
      v_posted := v_posted + 1;
    end if;
  end loop;
  return jsonb_build_object('dispatch', v_dispatch, 'posted', v_posted, 'recorded', v_recorded, 'not_from_stock', v_supply);
end $$;
