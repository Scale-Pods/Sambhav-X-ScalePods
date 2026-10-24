-- 21: a name key for lining up the same customer or vendor across Tally, the sheets and orders.
-- "AAA SUPPORTS PVT. LTD." and "Aaa Supports Private Limited" give the same key; the key is only for matching, never shown as a name.
create or replace function app.party_key(t text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(lower(coalesce(t, '')), '\((sale|sales|pur|purchase|rent|exp|expense)\)', ' ', 'g'),  -- Tally keeps one ledger per kind of dealing: "NAME (Sale)", "NAME (Pur)"
                 '^\s*m\s*/\s*s\.?\s', '', 'g'),     -- leading "M/s"
               '&', ' and ', 'g'),
             '[^a-z0-9 ]', ' ', 'g'),                                                      -- punctuation to spaces
           '\m(pvt|private|ltd|limited|p|llp|co|company|inc)\M', ' ', 'g'),                -- company-type words
         '\s+', '', 'g')                                                                    -- no spaces
$$;
grant execute on function app.party_key(text) to authenticated;
