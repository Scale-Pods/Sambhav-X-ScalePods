-- 35: a certificate that prints a heat number without the plate letter our books add (62754SA on the certificate, 62754SAA / 62754SAB in stock)
-- is linked to those plates too; only for heat numbers of 6 or more characters and at most 2 extra characters, so unrelated heats are not caught.
create or replace function app.link_certificate(p_doc uuid, p_final jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cert uuid; v_type public.cert_type; it jsonb; v_links integer := 0; n integer; v_heat text; v_plate text;
begin
  if jsonb_typeof(p_final->'items') <> 'array' or jsonb_array_length(p_final->'items') = 0 then return 0; end if;
  v_type := case p_final->>'cert_kind' when 'ibr' then 'ibr' when 'consignment_mtc' then 'consignment_mtc' else 'mill_tc' end;
  insert into public.certificates (cert_type, cert_no, document_id, issued_on, notes)
  values (v_type, nullif(btrim(p_final->>'certificate_no'), ''), p_doc,
          case when (p_final->>'issue_date') ~ '^\d{4}-\d{2}-\d{2}$' then (p_final->>'issue_date')::date end,
          nullif(btrim(concat_ws(' | ', nullif(p_final->>'mill_name', ''), nullif(p_final->>'specification', ''), nullif(p_final->>'grade', ''))), ''))
  on conflict (document_id) where document_id is not null do nothing returning id into v_cert;
  if v_cert is null then return 0; end if;
  for it in select * from jsonb_array_elements(p_final->'items') loop
    n := 0;
    v_heat := app.norm_text(it->>'heat_no'); v_plate := app.norm_text(it->>'plate_no');
    if v_plate <> '' and exists (select 1 from public.lots where app.norm_text(plate_no) = v_plate) then
      insert into public.lot_certificates (lot_id, certificate_id) select id, v_cert from public.lots where app.norm_text(plate_no) = v_plate on conflict do nothing;
    elsif v_heat <> '' then
      insert into public.lot_certificates (lot_id, certificate_id)
        select id, v_cert from public.lots
         where app.norm_text(heat_no) = v_heat
            or (length(v_heat) >= 6 and app.norm_text(heat_no) like v_heat || '%' and length(app.norm_text(heat_no)) <= length(v_heat) + 2)
        on conflict do nothing;
    end if;
    get diagnostics n = row_count; v_links := v_links + n;
  end loop;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, source_document_id, note)
  values ('staff', app.my_staff_id(), 'certificate_filed', 'certificates', v_cert, p_doc, v_links || ' plate link(s)');
  return v_links;
end $$;
revoke all on function app.link_certificate(uuid, jsonb) from public, anon, authenticated;
