-- 19: invoices and payments, as typed views over the synced Google Sheets (sheet_rows).
-- Flow: Google Sheets -> daily sync -> sheet_rows (raw copy) -> these views (typed, cleaned) -> the app.
-- The views read the raw copy, so they follow the sheets automatically after each sync. Nothing is written back. Like the raw copy
-- they are visible to the owner and administrators only (security_invoker: the caller's rights apply).
-- Sources: the Form Response Sheet holds the raw entries (sales invoices, purchase invoices, expenses, payments);
-- the Payment Better sheets hold the debtors (M Sale) and creditors (M Pur) the accounts team tracks by hand.

-- ---------------------------------------------------------------- parsing helpers (the sheets store text)
create or replace function app.sheet_num(t text) returns numeric language plpgsql immutable as $$
declare s text := regexp_replace(coalesce(t, ''), '[^0-9.\-]', '', 'g');
begin
  if s ~ '^-?[0-9]+(\.[0-9]+)?$' then return s::numeric; end if;
  return null;
end $$;

-- "6/25/2025 12:39:40" (month first, as the form sheet shows it), "12-Jun-24", "12-Jun-2024", "2025-06-25". Anything else is null.
create or replace function app.sheet_date(t text) returns date language plpgsql immutable as $$
declare s text := btrim(coalesce(t, '')); m text[]; mon int;
begin
  if s = '' then return null; end if;
  m := regexp_match(s, '^(\d{1,2})/(\d{1,2})/(\d{4})');
  if m is not null then return make_date(m[3]::int, m[1]::int, m[2]::int); end if;
  m := regexp_match(s, '^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{2,4})');
  if m is not null then
    mon := position(lower(m[2]) in 'janfebmaraprmayjunjulaugsepoctnovdec');
    if mon > 0 and (mon - 1) % 3 = 0 then
      return make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, (mon - 1) / 3 + 1, m[1]::int);
    end if;
    return null;
  end if;
  m := regexp_match(s, '^(\d{4})-(\d{2})-(\d{2})');
  if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;
  return null;
exception when others then
  return null;
end $$;

create or replace function app.sheet_ts(t text) returns timestamp language plpgsql immutable as $$
declare s text := btrim(coalesce(t, '')); m text[]; d date;
begin
  d := app.sheet_date(s);
  if d is null then return null; end if;
  m := regexp_match(s, '(\d{1,2}):(\d{2})(?::(\d{2}))?');
  return d::timestamp + make_interval(hours => coalesce(m[1]::int, 0), mins => coalesce(m[2]::int, 0), secs => coalesce(m[3]::int, 0));
exception when others then
  return d::timestamp;
end $$;

-- financial year (1 April to 31 March): "FY 2025-26"
create or replace function app.fy_label(d date) returns text language sql immutable as $$
  select case when d is null then null
    else format('FY %s-%s', extract(year from d)::int - (extract(month from d) < 4)::int, lpad(((extract(year from d)::int - (extract(month from d) < 4)::int + 1) % 100)::text, 2, '0')) end
$$;

-- ---------------------------------------------------------------- sales invoices (Form Response Sheet: Spf Inv, Sai Inv)
create or replace view public.v_sales_invoices with (security_invoker = true) as
with p as (
  select case r.tab when 'Spf Inv' then 'SPF' else 'SAI' end entity, r.row_no,
         app.sheet_ts(r.cells ->> 0) entered_at,
         nullif(btrim(r.cells ->> 1), '') invoice_no, app.sheet_date(r.cells ->> 2) invoice_date,
         nullif(btrim(r.cells ->> 3), '') client, nullif(btrim(r.cells ->> 4), '') salesperson, nullif(btrim(r.cells ->> 5), '') po_no,
         app.sheet_num(r.cells ->> 6) credit_days, app.sheet_num(r.cells ->> 7) amount,
         nullif(btrim(r.cells ->> 8), '') made_by, nullif(btrim(r.cells ->> 9), '') checked_by,
         nullif(btrim(r.cells ->> 10), '') emailed, nullif(btrim(r.cells ->> 13), '') transporter
  from public.sheet_rows r
  where r.source_key = 'form_responses' and r.tab in ('Spf Inv', 'Sai Inv') and r.deleted_at is null and r.row_no > 1
)
select p.*,
       app.fy_label(p.invoice_date) fy,
       p.invoice_date + coalesce(p.credit_days, 0)::int due_date,
       row_number() over (partition by p.entity, p.invoice_no order by p.row_no) entry_no,
       count(*) over (partition by p.entity, p.invoice_no) entries,
       -- the invoice number carries its year ("222/25-26"): flag a date that disagrees with it
       (regexp_match(p.invoice_no, '/(\d{2})-(\d{2})\s*$'))[1] is not null
         and p.invoice_date is not null
         and app.fy_label(p.invoice_date) <> 'FY 20' || (regexp_match(p.invoice_no, '/(\d{2})-(\d{2})\s*$'))[1] || '-' || (regexp_match(p.invoice_no, '/(\d{2})-(\d{2})\s*$'))[2] fy_mismatch
from p
where p.invoice_no is not null or p.amount is not null;

-- ---------------------------------------------------------------- purchase invoices (Spf Pur, Sai Pur)
create or replace view public.v_purchase_invoices with (security_invoker = true) as
with p as (
  select case r.tab when 'Spf Pur' then 'SPF' else 'SAI' end entity, r.row_no,
         app.sheet_ts(r.cells ->> 0) entered_at,
         nullif(btrim(r.cells ->> 1), '') invoice_no, app.sheet_date(r.cells ->> 2) invoice_date, nullif(btrim(r.cells ->> 3), '') vendor,
         app.sheet_num(r.cells ->> 4) credit_days, app.sheet_num(r.cells ->> 5) amount,
         nullif(btrim(r.cells ->> 6), '') checked_by, nullif(btrim(r.cells ->> 7), '') broker, nullif(btrim(r.cells ->> 8), '') purchased_by,
         nullif(btrim(r.cells ->> 9), '') purchased_for, coalesce(r.links ->> '10', nullif(btrim(r.cells ->> 10), '')) file_url,
         app.sheet_num(r.cells ->> 12) weight, app.sheet_num(r.cells ->> 13) rate, nullif(btrim(r.cells ->> 14), '') unit,
         app.sheet_num(r.cells ->> 15) basic_amount, app.sheet_num(r.cells ->> 16) tds
  from public.sheet_rows r
  where r.source_key = 'form_responses' and r.tab in ('Spf Pur', 'Sai Pur') and r.deleted_at is null and r.row_no > 1
)
select p.*, app.fy_label(p.invoice_date) fy, p.invoice_date + coalesce(p.credit_days, 0)::int due_date,
       row_number() over (partition by p.entity, p.vendor, p.invoice_no order by p.row_no) entry_no,
       count(*) over (partition by p.entity, p.vendor, p.invoice_no) entries
from p
where p.invoice_no is not null or p.amount is not null;

-- ---------------------------------------------------------------- expenses (Spf Exp, Sai Exp) and small cash expenses (Exp)
create or replace view public.v_expenses with (security_invoker = true) as
select case r.tab when 'Spf Exp' then 'SPF' else 'SAI' end entity, r.row_no,
       app.sheet_ts(r.cells ->> 0) entered_at, nullif(btrim(r.cells ->> 1), '') category,
       nullif(btrim(r.cells ->> 2), '') invoice_no, app.sheet_date(r.cells ->> 3) invoice_date, nullif(btrim(r.cells ->> 4), '') vendor,
       app.sheet_num(r.cells ->> 5) amount, app.sheet_num(r.cells ->> 6) tds, nullif(btrim(r.cells ->> 7), '') checked_by,
       coalesce(r.links ->> '8', nullif(btrim(r.cells ->> 8), '')) file_url,
       app.fy_label(app.sheet_date(r.cells ->> 3)) fy
from public.sheet_rows r
where r.source_key = 'form_responses' and r.tab in ('Spf Exp', 'Sai Exp') and r.deleted_at is null and r.row_no > 1
  and (nullif(btrim(r.cells ->> 2), '') is not null or app.sheet_num(r.cells ->> 5) is not null);

create or replace view public.v_petty_expenses with (security_invoker = true) as
select r.row_no, app.sheet_ts(r.cells ->> 0) entered_at, nullif(btrim(r.cells ->> 1), '') who, nullif(btrim(r.cells ->> 2), '') what,
       app.sheet_num(r.cells ->> 3) amount, coalesce(r.links ->> '4', nullif(btrim(r.cells ->> 4), '')) file_url,
       app.fy_label(app.sheet_ts(r.cells ->> 0)::date) fy
from public.sheet_rows r
where r.source_key = 'form_responses' and r.tab = 'Exp' and r.deleted_at is null and r.row_no > 1 and app.sheet_num(r.cells ->> 3) is not null;

-- ---------------------------------------------------------------- debtors: who owes us (Payment Better, tab M Sale)
create or replace view public.v_receivables with (security_invoker = true) as
select case r.source_key when 'spf_payment_better' then 'SPF' else 'SAI' end entity, r.row_no,
       nullif(btrim(r.cells ->> 1), '') kind,                       -- Blocked / K Reminder / blank
       nullif(btrim(r.cells ->> 2), '') salesperson, nullif(btrim(r.cells ->> 3), '') po_no, nullif(btrim(r.cells ->> 4), '') invoice_no,
       app.sheet_date(r.cells ->> 5) invoice_date, app.sheet_num(r.cells ->> 6) credit_days, app.sheet_date(r.cells ->> 7) due_date,
       nullif(btrim(r.cells ->> 9), '') party, app.sheet_num(r.cells ->> 10) amount, coalesce(app.sheet_num(r.cells ->> 11), 0) received,
       coalesce(app.sheet_num(r.cells ->> 12), app.sheet_num(r.cells ->> 10) - coalesce(app.sheet_num(r.cells ->> 11), 0)) pending,
       greatest(0, current_date - app.sheet_date(r.cells ->> 7)) overdue_days
from public.sheet_rows r
where r.source_key in ('spf_payment_better', 'sai_payment_better') and r.tab = 'M Sale' and r.deleted_at is null and r.row_no > 1
  and nullif(btrim(r.cells ->> 4), '') is not null and app.sheet_num(r.cells ->> 10) is not null;

-- ---------------------------------------------------------------- creditors: who we owe (Payment Better, tab M Pur)
create or replace view public.v_payables with (security_invoker = true) as
select case r.source_key when 'spf_payment_better' then 'SPF' else 'SAI' end entity, r.row_no,
       (upper(nullif(btrim(r.cells ->> 1), '')) = 'TRUE') checked,
       nullif(btrim(r.cells ->> 3), '') invoice_no, app.sheet_date(r.cells ->> 4) invoice_date, coalesce(r.links ->> '5', nullif(btrim(r.cells ->> 5), '')) file_url,
       nullif(btrim(r.cells ->> 6), '') buyer, nullif(btrim(r.cells ->> 7), '') purchased_for, app.sheet_num(r.cells ->> 8) credit_days,
       app.sheet_date(r.cells ->> 9) due_date, nullif(btrim(r.cells ->> 11), '') broker, nullif(btrim(r.cells ->> 12), '') vendor,
       app.sheet_num(r.cells ->> 13) amount, coalesce(app.sheet_num(r.cells ->> 14), 0) advance, coalesce(app.sheet_num(r.cells ->> 15), 0) tds,
       coalesce(app.sheet_num(r.cells ->> 16), app.sheet_num(r.cells ->> 13) - coalesce(app.sheet_num(r.cells ->> 14), 0) - coalesce(app.sheet_num(r.cells ->> 15), 0)) pending,
       nullif(btrim(r.cells ->> 17), '') remark,
       greatest(0, current_date - app.sheet_date(r.cells ->> 9)) overdue_days
from public.sheet_rows r
where r.source_key in ('spf_payment_better', 'sai_payment_better') and r.tab = 'M Pur' and r.deleted_at is null and r.row_no > 1
  and nullif(btrim(r.cells ->> 3), '') is not null and app.sheet_num(r.cells ->> 13) is not null;

-- ---------------------------------------------------------------- payments made by GPay, brokerage, and the totals typed on each Summary tab
create or replace view public.v_gpay_payments with (security_invoker = true) as
select r.row_no, app.sheet_ts(r.cells ->> 0) entered_at, nullif(btrim(r.cells ->> 1), '') description, nullif(btrim(r.cells ->> 2), '') for_whom,
       app.sheet_num(r.cells ->> 3) amount, nullif(btrim(r.cells ->> 4), '') paid_by, coalesce(r.links ->> '5', nullif(btrim(r.cells ->> 5), '')) file_url,
       app.fy_label(app.sheet_ts(r.cells ->> 0)::date) fy
from public.sheet_rows r
where r.source_key = 'form_responses' and r.tab = 'Gpay' and r.deleted_at is null and r.row_no > 1 and app.sheet_num(r.cells ->> 3) is not null;

create or replace view public.v_brokerage with (security_invoker = true) as
select case r.source_key when 'spf_payment_better' then 'SPF' else 'SAI' end entity, r.row_no,
       app.sheet_date(r.cells ->> 0) entry_date, nullif(btrim(r.cells ->> 1), '') party, nullif(btrim(r.cells ->> 2), '') broker,
       app.sheet_num(r.cells ->> 3) weight, app.sheet_num(r.cells ->> 4) rate, nullif(btrim(r.cells ->> 5), '') unit, app.sheet_num(r.cells ->> 6) basic_amount
from public.sheet_rows r
where r.source_key in ('spf_payment_better', 'sai_payment_better') and r.tab = 'Brokerage' and r.deleted_at is null and r.row_no > 1
  and app.sheet_num(r.cells ->> 6) is not null;

create or replace view public.v_pay_summary with (security_invoker = true) as
select case r.source_key when 'spf_payment_better' then 'SPF' else 'SAI' end entity, r.row_no,
       nullif(btrim(r.cells ->> 0), '') particulars, app.sheet_num(r.cells ->> 1) amount
from public.sheet_rows r
where r.source_key in ('spf_payment_better', 'sai_payment_better') and r.tab = 'Summary' and r.deleted_at is null and r.row_no > 1
  and nullif(btrim(r.cells ->> 0), '') is not null;

grant select on public.v_sales_invoices, public.v_purchase_invoices, public.v_expenses, public.v_petty_expenses, public.v_receivables,
                public.v_payables, public.v_gpay_payments, public.v_brokerage, public.v_pay_summary to authenticated;
