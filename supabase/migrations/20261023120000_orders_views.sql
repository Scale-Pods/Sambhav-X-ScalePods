-- 21: orders and dispatch, as typed views over the synced Google Sheets (same flow as migration 19:
-- Google Sheets -> daily sync -> sheet_rows -> these views -> the app). Read-only; visible to the owner and administrators.
-- Sources: Dispatch FMS "FormResponses" (every order line as it was submitted), Dispatch FMS "Dispatch" (the working sheet: a status per line),
-- and DISPATCH 26-27 (the monthly vehicle / outward register, two yard blocks per month).

-- day-month-year with dashes ("9-12-2025"), as some order forms were typed
create or replace function app.sheet_date_dmy(t text) returns date language plpgsql immutable as $$
declare m text[]; d date;
begin
  m := regexp_match(btrim(coalesce(t, '')), '^(\d{1,2})-(\d{1,2})-(\d{4})$');
  if m is null then return null; end if;
  d := make_date(m[3]::int, m[2]::int, m[1]::int);
  if extract(year from d) not between 2015 and 2035 then return null; end if;
  return d;
exception when others then
  return null;
end $$;

-- the register's dates are "1-Apr" (no year: the file is the 26-27 year) or "27-08-26"
create or replace function app.dispatch_date(t text) returns date language plpgsql immutable as $$
declare s text := btrim(coalesce(t, '')); m text[]; mon int;
begin
  m := regexp_match(s, '^(\d{1,2})-([A-Za-z]{3})[a-z]*$');
  if m is not null then
    mon := position(lower(m[2]) in 'janfebmaraprmayjunjulaugsepoctnovdec');
    if mon > 0 and (mon - 1) % 3 = 0 then
      mon := (mon - 1) / 3 + 1;
      return make_date(case when mon >= 4 then 2026 else 2027 end, mon, m[1]::int);
    end if;
    return null;
  end if;
  m := regexp_match(s, '^(\d{1,2})-(\d{1,2})-(\d{2})$');
  if m is not null then return make_date(2000 + m[3]::int, m[2]::int, m[1]::int); end if;
  return null;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------- order lines: the latest submission of each line of each order
create or replace view public.v_order_lines with (security_invoker = true) as
with st as (
  select nullif(btrim(d.cells ->> 2), '') order_no, nullif(btrim(d.cells ->> 11), '') sr_no,
         bool_or(upper(btrim(d.cells ->> 0)) = 'TRUE') done,
         bool_or(upper(btrim(d.cells ->> 1)) = 'TRUE') checked,
         max(nullif(btrim(d.cells ->> 35), '')) thank_you, max(nullif(btrim(d.cells ->> 36), '')) ongoing_message, max(nullif(btrim(d.cells ->> 37), '')) completed_note
  from public.sheet_rows d
  where d.source_key = 'dispatch_fms' and d.tab = 'Dispatch' and d.deleted_at is null and d.row_no > 2 and nullif(btrim(d.cells ->> 2), '') is not null
  group by 1, 2
), f as (
  select r.row_no, r.cells c, r.links l,
         app.sheet_ts(r.cells ->> 0) entered_at, nullif(btrim(r.cells ->> 1), '') order_no, nullif(btrim(r.cells ->> 10), '') sr_no
  from public.sheet_rows r
  where r.source_key = 'dispatch_fms' and r.tab = 'FormResponses' and r.deleted_at is null and r.row_no > 2 and nullif(btrim(r.cells ->> 1), '') is not null
), ranked as (
  select f.*, row_number() over (partition by f.order_no, f.sr_no order by f.entered_at desc nulls last, f.row_no desc) rn,
         count(*) over (partition by f.order_no, f.sr_no) submissions
  from f
)
select k.row_no, k.entered_at, k.order_no, k.sr_no, k.submissions,
       nullif(btrim(k.c ->> 2), '') salesperson, upper(nullif(btrim(k.c ->> 3), '')) company, nullif(btrim(k.c ->> 4), '') po_no,
       coalesce(app.sheet_date(k.c ->> 5), app.sheet_date_dmy(k.c ->> 5)) order_date, nullif(btrim(k.c ->> 6), '') client, nullif(btrim(k.c ->> 7), '') delivery_location,
       coalesce(app.sheet_date(k.c ->> 8), app.sheet_date_dmy(k.c ->> 8)) etd, coalesce(k.l ->> '9', nullif(btrim(k.c ->> 9), '')) po_url,
       nullif(btrim(k.c ->> 11), '') grade, nullif(btrim(k.c ->> 12), '') size, app.sheet_num(k.c ->> 13) qty, nullif(btrim(k.c ->> 14), '') unit,
       app.sheet_num(k.c ->> 15) rate, lower(nullif(btrim(k.c ->> 16), '')) material, nullif(btrim(k.c ->> 17), '') plot, nullif(btrim(k.c ->> 18), '') instructions,
       nullif(btrim(k.c ->> 19), '') people_needed, nullif(btrim(k.c ->> 20), '') weighing, nullif(btrim(k.c ->> 21), '') documents,
       nullif(btrim(k.c ->> 22), '') packing, nullif(btrim(k.c ->> 23), '') loading, nullif(btrim(k.c ->> 24), '') freight, nullif(btrim(k.c ->> 25), '') extra_charges,
       nullif(btrim(k.c ->> 26), '') transporter, nullif(btrim(k.c ->> 27), '') vehicle_no, nullif(btrim(k.c ->> 28), '') transport_terms,
       nullif(btrim(k.c ->> 29), '') tests, nullif(btrim(k.c ->> 30), '') lab, nullif(btrim(k.c ->> 31), '') inspection, nullif(btrim(k.c ->> 32), '') third_party_testing,
       nullif(btrim(k.c ->> 33), '') sample_cutting,
       coalesce(st.done, false) done, coalesce(st.checked, false) checked, st.thank_you, st.ongoing_message, st.completed_note
from ranked k left join st on st.order_no = k.order_no and st.sr_no = k.sr_no
where k.rn = 1;

-- ---------------------------------------------------------------- orders: one row per order number
create or replace view public.v_orders with (security_invoker = true) as
select l.order_no,
       case when l.order_no ~ '^[0-9]+$' then l.order_no::int end order_no_num,
       string_agg(distinct l.company, ' + ') company,
       (array_agg(l.salesperson order by l.row_no) filter (where l.salesperson is not null))[1] salesperson,
       (array_agg(l.po_no order by l.row_no) filter (where l.po_no is not null))[1] po_no,
       (array_agg(l.client order by l.row_no) filter (where l.client is not null))[1] client,
       (array_agg(l.delivery_location order by l.row_no) filter (where l.delivery_location is not null))[1] delivery_location,
       min(l.order_date) order_date, min(l.etd) etd, min(l.entered_at) entered_at,
       (array_agg(l.po_url order by l.row_no) filter (where l.po_url is not null))[1] po_url,
       count(*) lines, count(*) filter (where l.done) done_lines,
       case when bool_and(l.done) then 'Complete' else 'Open' end status,
       string_agg(distinct l.grade, ', ') grades, string_agg(distinct l.material, ' + ') material,
       string_agg(distinct l.transporter, ', ') transporters, string_agg(distinct l.vehicle_no, ', ') vehicles,
       bool_or(l.third_party_testing is not null and upper(l.third_party_testing) not in ('NO', 'NA', 'N/A')) has_testing
from public.v_order_lines l
group by l.order_no;

-- ---------------------------------------------------------------- vehicle / outward register (DISPATCH 26-27, monthly tabs, two yard blocks each)
create or replace view public.v_vehicle_register with (security_invoker = true) as
with hdr as (
  select r.tab, r.cells from public.sheet_rows r
  where r.source_key = 'dispatch_26_27' and r.row_no = 2 and r.deleted_at is null and r.tab ~ '^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$'
), blocks as (
  select h.tab, (e.ord - 1)::int start_col, row_number() over (partition by h.tab order by e.ord) block_no
  from hdr h, jsonb_array_elements_text(h.cells) with ordinality e(v, ord)
  where upper(btrim(e.v)) = 'V NO'
)
select r.tab month_tab, r.row_no, case b.block_no when 1 then '753' else 'D15' end plot,
       nullif(btrim(r.cells ->> b.start_col), '') vehicle_no, nullif(btrim(r.cells ->> (b.start_col + 1)), '') grade,
       app.dispatch_date(r.cells ->> (b.start_col + 2)) dispatch_date, nullif(btrim(r.cells ->> (b.start_col + 3)), '') invoice_no,
       app.sheet_num(r.cells ->> (b.start_col + 4)) weight_kg, upper(nullif(btrim(r.cells ->> (b.start_col + 5)), '')) entity
from public.sheet_rows r join blocks b on b.tab = r.tab
where r.source_key = 'dispatch_26_27' and r.deleted_at is null and r.row_no > 2
  and (nullif(btrim(r.cells ->> b.start_col), '') is not null or app.sheet_num(r.cells ->> (b.start_col + 4)) is not null);

grant select on public.v_order_lines, public.v_orders, public.v_vehicle_register to authenticated;
