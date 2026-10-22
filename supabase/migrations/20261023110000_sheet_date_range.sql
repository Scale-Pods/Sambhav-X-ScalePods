-- 20: a date typed with an impossible year ("12/3/0026", "1/1/2555") is treated as missing, not as a date in the wrong century.
create or replace function app.sheet_date(t text) returns date language plpgsql immutable as $$
declare s text := btrim(coalesce(t, '')); m text[]; mon int; d date;
begin
  if s = '' then return null; end if;
  m := regexp_match(s, '^(\d{1,2})/(\d{1,2})/(\d{4})');
  if m is not null then
    d := make_date(m[3]::int, m[1]::int, m[2]::int);
  else
    m := regexp_match(s, '^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{2,4})');
    if m is not null then
      mon := position(lower(m[2]) in 'janfebmaraprmayjunjulaugsepoctnovdec');
      if mon > 0 and (mon - 1) % 3 = 0 then
        d := make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, (mon - 1) / 3 + 1, m[1]::int);
      end if;
    else
      m := regexp_match(s, '^(\d{4})-(\d{2})-(\d{2})');
      if m is not null then d := make_date(m[1]::int, m[2]::int, m[3]::int); end if;
    end if;
  end if;
  if d is not null and extract(year from d) not between 2015 and 2035 then return null; end if;
  return d;
exception when others then
  return null;
end $$;
