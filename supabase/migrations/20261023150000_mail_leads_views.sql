-- 24: mail, quotations and leads, as typed views over the synced Google Sheets (same flow as migrations 19 and 21).
-- Sources: Sambhav Pipes Email Tracker (Pending / Done / Ignored mail, Quotation Tracker, Orders Won, Client Master, Archive) and
-- IndiaMART Enquiries. Read-only; visible to the owner and administrators (names, emails and phone numbers are in here).

-- "22 Oct 2026, 06:13 PM", "22-Oct-2026 3:43:43 PM", "22 Oct 2026". Anything else is null.
create or replace function app.mail_ts(t text) returns timestamp language plpgsql immutable as $$
declare m text[]; mon int; h int;
begin
  m := regexp_match(btrim(coalesce(t, '')), '^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?)?');
  if m is null then return null; end if;
  mon := position(lower(m[2]) in 'janfebmaraprmayjunjulaugsepoctnovdec');
  if mon = 0 or (mon - 1) % 3 <> 0 then return null; end if;
  h := coalesce(m[4]::int, 0);
  if upper(m[7]) = 'PM' and h < 12 then h := h + 12; end if;
  if upper(m[7]) = 'AM' and h = 12 then h := 0; end if;
  return make_timestamp(m[3]::int, (mon - 1) / 3 + 1, m[1]::int, h, coalesce(m[5]::int, 0), coalesce(m[6]::int, 0));
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------- mail threads: Pending, Done, Ignored tabs
create or replace view public.v_mail_inbox with (security_invoker = true) as
select case r.tab when 'Pending' then 'Pending' when 'Done' then 'Done' else 'Ignored' end state, r.row_no,
       (upper(nullif(btrim(r.cells ->> 0), '')) = 'TRUE') marked_done, (upper(nullif(btrim(r.cells ->> 1), '')) = 'TRUE') no_reply,
       nullif(btrim(r.cells ->> 3), '') subject, coalesce(r.links ->> '3', null) gmail_url,
       nullif(btrim(r.cells ->> 4), '') from_name, lower(nullif(btrim(r.cells ->> 5), '')) from_email,
       app.mail_ts(r.cells ->> 6) received_at, app.sheet_num(r.cells ->> 7) days, nullif(btrim(r.cells ->> 8), '') status,
       nullif(btrim(r.cells ->> 9), '') remarks, nullif(btrim(r.cells ->> 10), '') thread_id,
       app.mail_ts(r.cells ->> 11) moved_at
from public.sheet_rows r
where r.source_key = 'email_tracker' and r.tab in ('Pending', 'Done', 'Ignored') and r.deleted_at is null and r.row_no > 1
  and nullif(btrim(r.cells ->> 3), '') is not null;

-- ---------------------------------------------------------------- quotations (Quotation Tracker + Orders Won)
create or replace view public.v_quotations with (security_invoker = true) as
select case r.tab when 'Orders Won' then 'Won' else 'Tracker' end source_tab, r.row_no,
       nullif(btrim(r.cells ->> 0), '') priority, (upper(nullif(btrim(r.cells ->> 1), '')) = 'TRUE') fu1, (upper(nullif(btrim(r.cells ->> 2), '')) = 'TRUE') fu2,
       nullif(btrim(r.cells ->> 4), '') subject, coalesce(r.links ->> '4', null) gmail_url,
       -- the quotation number sits in the subject ("QUOTATION NO - 629")
       (regexp_match(r.cells ->> 4, 'quotation\s*(?:no\.?|number|#)?\s*[-:]?\s*([0-9]+[A-Za-z0-9]*)', 'i'))[1] quote_no,
       btrim(nullif(regexp_replace(coalesce(r.cells ->> 5, ''), '^["'']+|["'']+$', '', 'g'), '')) client_name, lower(btrim(nullif(regexp_replace(coalesce(r.cells ->> 6, ''), '^["'']+|["'']+$', '', 'g'), ''))) client_email,
       app.sheet_ts(r.cells ->> 7) quoted_at, app.sheet_num(r.cells ->> 8) days,
       nullif(btrim(r.cells ->> 9), '') material, nullif(btrim(r.cells ->> 10), '') qty, app.sheet_num(r.cells ->> 11) price,
       nullif(btrim(r.cells ->> 12), '') delivery, nullif(btrim(r.cells ->> 13), '') validity, nullif(btrim(r.cells ->> 14), '') status,
       coalesce(app.sheet_num(r.cells ->> 15), 0) order_value, nullif(btrim(r.cells ->> 16), '') lost_reason,
       nullif(btrim(r.cells ->> 17), '') client_replied, nullif(btrim(r.cells ->> 18), '') repeat_client, nullif(btrim(r.cells ->> 20), '') remarks,
       nullif(btrim(r.cells ->> 21), '') thread_id
from public.sheet_rows r
where r.source_key = 'email_tracker' and r.tab in ('Quotation Tracker', 'Orders Won') and r.deleted_at is null and r.row_no > 1
  and nullif(btrim(r.cells ->> 4), '') is not null;

-- ---------------------------------------------------------------- clients (Client Master)
create or replace view public.v_mail_clients with (security_invoker = true) as
select r.row_no, nullif(btrim(r.cells ->> 0), '') client_name, lower(nullif(btrim(r.cells ->> 1), '')) email, upper(nullif(btrim(r.cells ->> 2), '')) grade,
       coalesce(app.sheet_num(r.cells ->> 3), 0) enquiries, coalesce(app.sheet_num(r.cells ->> 4), 0) quotations, coalesce(app.sheet_num(r.cells ->> 5), 0) orders_won,
       coalesce(app.sheet_num(r.cells ->> 6), 0) pipeline_value, app.mail_ts(r.cells ->> 7) last_contact
from public.sheet_rows r
where r.source_key = 'email_tracker' and r.tab = 'Client Master' and r.deleted_at is null and r.row_no > 1 and nullif(btrim(r.cells ->> 0), '') is not null;

-- ---------------------------------------------------------------- leads (IndiaMART Enquiries)
create or replace view public.v_leads with (security_invoker = true) as
select r.row_no, nullif(btrim(r.cells ->> 0), '') query_id, upper(nullif(btrim(r.cells ->> 1), '')) query_type,
       case upper(btrim(r.cells ->> 1)) when 'B' then 'Buy lead' when 'W' then 'Direct enquiry' when 'P' then 'Phone call' when 'BIZ' then 'Business enquiry' else coalesce(nullif(btrim(r.cells ->> 1), ''), 'Other') end query_kind,
       app.mail_ts(r.cells ->> 2) received_at, nullif(btrim(r.cells ->> 3), '') name, lower(nullif(btrim(r.cells ->> 4), '')) email, nullif(btrim(r.cells ->> 5), '') company,
       nullif(btrim(r.cells ->> 7), '') city, initcap(lower(nullif(btrim(r.cells ->> 8), ''))) state, nullif(btrim(r.cells ->> 9), '') country,
       nullif(btrim(r.cells ->> 10), '') mobile, nullif(btrim(r.cells ->> 13), '') product,
       nullif(btrim(regexp_replace(regexp_replace(coalesce(r.cells ->> 14, ''), '<br\s*/?>', E'\n', 'gi'), E'[\\r\\n]+\\s*', E'\n', 'g')), '') message
from public.sheet_rows r
where r.source_key = 'indiamart' and r.tab = 'Enquiries' and r.deleted_at is null and r.row_no > 1 and nullif(btrim(r.cells ->> 0), '') is not null;

grant select on public.v_mail_inbox, public.v_quotations, public.v_mail_clients, public.v_leads to authenticated;
