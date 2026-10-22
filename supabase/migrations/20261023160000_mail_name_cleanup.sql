-- 25: strip stray quote marks from sender and client names and emails in the mail views.

create or replace view public.v_mail_inbox with (security_invoker = true) as
select case r.tab when 'Pending' then 'Pending' when 'Done' then 'Done' else 'Ignored' end state, r.row_no,
       (upper(nullif(btrim(r.cells ->> 0), '')) = 'TRUE') marked_done, (upper(nullif(btrim(r.cells ->> 1), '')) = 'TRUE') no_reply,
       nullif(btrim(r.cells ->> 3), '') subject, coalesce(r.links ->> '3', null) gmail_url,
       btrim(nullif(regexp_replace(coalesce(r.cells ->> 4, ''), '^["'']+|["'']+$', '', 'g'), '')) from_name, lower(btrim(nullif(regexp_replace(coalesce(r.cells ->> 5, ''), '^["'']+|["'']+$', '', 'g'), ''))) from_email,
       app.mail_ts(r.cells ->> 6) received_at, app.sheet_num(r.cells ->> 7) days, nullif(btrim(r.cells ->> 8), '') status,
       nullif(btrim(r.cells ->> 9), '') remarks, nullif(btrim(r.cells ->> 10), '') thread_id,
       app.mail_ts(r.cells ->> 11) moved_at
from public.sheet_rows r
where r.source_key = 'email_tracker' and r.tab in ('Pending', 'Done', 'Ignored') and r.deleted_at is null and r.row_no > 1
  and nullif(btrim(r.cells ->> 3), '') is not null;

create or replace view public.v_mail_clients with (security_invoker = true) as
select r.row_no, btrim(nullif(regexp_replace(coalesce(r.cells ->> 0, ''), '^["'']+|["'']+$', '', 'g'), '')) client_name, lower(btrim(nullif(regexp_replace(coalesce(r.cells ->> 1, ''), '^["'']+|["'']+$', '', 'g'), ''))) email, upper(nullif(btrim(r.cells ->> 2), '')) grade,
       coalesce(app.sheet_num(r.cells ->> 3), 0) enquiries, coalesce(app.sheet_num(r.cells ->> 4), 0) quotations, coalesce(app.sheet_num(r.cells ->> 5), 0) orders_won,
       coalesce(app.sheet_num(r.cells ->> 6), 0) pipeline_value, app.mail_ts(r.cells ->> 7) last_contact
from public.sheet_rows r
where r.source_key = 'email_tracker' and r.tab = 'Client Master' and r.deleted_at is null and r.row_no > 1 and nullif(btrim(r.cells ->> 0), '') is not null;
