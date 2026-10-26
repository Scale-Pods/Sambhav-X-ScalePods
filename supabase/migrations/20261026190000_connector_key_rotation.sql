-- 31: changing the Tally connector's secret key without a gap (break-it review finding 11).
-- A new key's hash is stored next to the current one. The connector keeps working with the old key until the PC first uses the new one;
-- at that moment the new key becomes the only key and the old one stops working.
alter table public.tally_connectors add column key_hash_next text;

create or replace function app.tally_connector(p_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_h text := encode(sha256(convert_to(p_key, 'utf8')), 'hex');
begin
  if coalesce(length(p_key), 0) < 32 then raise exception 'Invalid connector key' using errcode = '28000'; end if;
  select id into v_id from public.tally_connectors where key_hash = v_h and active;
  if v_id is null then
    -- the new key, used for the first time: it replaces the old one
    update public.tally_connectors set key_hash = key_hash_next, key_hash_next = null where key_hash_next = v_h and active returning id into v_id;
  end if;
  if v_id is null then raise exception 'Invalid connector key' using errcode = '28000'; end if;
  update public.tally_connectors set last_seen_at = now() where id = v_id;
  perform set_config('app.tally_connector_id', v_id::text, true);
  return v_id;
end $$;
