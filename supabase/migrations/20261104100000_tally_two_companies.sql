-- Tally for more than one company (Sambhav Pipes & Fittings and Sai Steel & Engineering, both in the same TallyPrime).
-- 1. The connector is still pinned to named companies (break-it fix 3), but the pin is now a list of name patterns separated by "|", not one pattern.
-- 2. A company seen for the first time is mapped to its own entity by name: "SAI" as a word gives Sai, "Ridhi" gives RS, everything else SPF (as before).
-- 3. The live connector may now write to "%SAMBHAV%" and "%SAI STEEL%". If Sai's company in Tally is named differently, change the second pattern:
--      update public.tally_connectors set allowed_company = '%SAMBHAV%|%<part of Sai''s name>%' where active;
-- Nothing already stored changes. Each company keeps its own ledgers, vouchers, bills and stock items (rows carry the company id).

create or replace function app.tally_company(p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ent uuid; v_pat text; v_code text;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'The company name is missing'; end if;
  select allowed_company into v_pat from public.tally_connectors where id = nullif(current_setting('app.tally_connector_id', true), '')::uuid;
  if v_pat is null then raise exception 'This connector has no company it may write to' using errcode = '42501'; end if;
  if not (p_name ilike any (string_to_array(v_pat, '|'))) then
    raise exception 'This connector may only write to companies like %, not to %', v_pat, p_name using errcode = '42501';
  end if;
  select id into v_id from public.tally_companies where tally_name = p_name;
  if v_id is null then
    v_code := case when p_name ~* '\msai\M' then 'SAI' when p_name ~* 'ridhi' then 'RS' else 'SPF' end;
    select id into v_ent from public.entities where code = v_code;
    insert into public.tally_companies (tally_name, entity_id, last_status) values (p_name, v_ent, 'created')
    on conflict (tally_name) do update set tally_name = excluded.tally_name returning id into v_id;
  end if;
  return v_id;
end $$;

update public.tally_connectors set allowed_company = '%SAMBHAV%|%SAI STEEL%' where active and allowed_company = '%SAMBHAV%';
