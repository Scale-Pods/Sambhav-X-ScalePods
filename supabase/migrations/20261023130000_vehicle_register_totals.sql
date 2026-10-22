-- 22: the vehicle register lists trips only; the month's own total row (no vehicle number) is left out.

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
  and nullif(btrim(r.cells ->> b.start_col), '') is not null;   -- a row without a vehicle number is the month's total row

