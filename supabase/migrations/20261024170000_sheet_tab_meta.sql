-- 23: per-tab facts for the sheet view, worked out once per sync instead of on every tab click:
-- how many rows, how wide, which row is the header, and the frozen rows above the data (what the old page computed from the first six rows).
-- Same rules as the other stored copies (migration 22): lives in the app schema, read through an admin-only public view, rebuilt by app.refresh_sheet_stores().
create materialized view app.sheet_tab_meta_store as
with r as materialized (
  select source_key, tab, row_no, cells, links, jsonb_array_length(cells) w,
         (select count(*) from jsonb_array_elements_text(cells) e where e <> '')::int filled,
         row_number() over (partition by source_key, tab order by row_no) rn
  from public.sheet_rows where deleted_at is null
),
hdr as (  -- the header is the top row (of the first six) with the most filled cells, at least three; the earliest wins a tie
  select distinct on (source_key, tab) source_key, tab, row_no header_row
  from r where rn <= 6 and filled >= 3 order by source_key, tab, filled desc, row_no
),
agg as (select source_key, tab, count(*)::int all_rows from r group by 1, 2)
select a.source_key, a.tab, a.all_rows, h.header_row,
       coalesce((select jsonb_agg(jsonb_build_object('row_no', f.row_no, 'cells', f.cells, 'links', f.links) order by f.row_no)
                   from (select * from r x where x.source_key = a.source_key and x.tab = a.tab and x.rn <= 6 and x.row_no <= h.header_row
                          order by x.row_no desc limit 3) f), '[]'::jsonb) frozen,
       (select count(*) from r x where x.source_key = a.source_key and x.tab = a.tab and x.row_no > coalesce(h.header_row, 0))::int total,
       greatest(
         coalesce((select max(x.w) from r x where x.source_key = a.source_key and x.tab = a.tab and x.row_no > coalesce(h.header_row, 0)), 0),
         coalesce((select max(x.w) from r x where x.source_key = a.source_key and x.tab = a.tab and x.rn <= 6 and x.row_no <= h.header_row), 0))::int width
from agg a left join hdr h on h.source_key = a.source_key and h.tab = a.tab;

create unique index sheet_tab_meta_store_key on app.sheet_tab_meta_store (source_key, tab);
create view public.v_sheet_tab_meta with (security_invoker = true) as select * from app.sheet_tab_meta_store where (select app.is_admin());
revoke all on app.sheet_tab_meta_store from public, anon;
grant select on app.sheet_tab_meta_store to authenticated;
grant select on public.v_sheet_tab_meta to authenticated;

create or replace function app.refresh_sheet_stores()
returns void language plpgsql security definer set search_path = public, app, pg_temp set statement_timeout = '300s' as $$
begin
  refresh materialized view app.v_order_lines_store;
  refresh materialized view app.v_orders_store;
  refresh materialized view app.v_sales_invoices_store;
  refresh materialized view app.v_purchase_invoices_store;
  refresh materialized view app.v_expenses_store;
  refresh materialized view app.v_receivables_store;
  refresh materialized view app.v_payables_store;
  refresh materialized view app.v_gpay_payments_store;
  refresh materialized view app.v_petty_expenses_store;
  refresh materialized view app.v_brokerage_store;
  refresh materialized view app.v_pay_summary_store;
  refresh materialized view app.v_vehicle_register_store;
  refresh materialized view app.v_mail_inbox_store;
  refresh materialized view app.v_quotations_store;
  refresh materialized view app.v_leads_store;
  refresh materialized view app.v_mail_clients_store;
  refresh materialized view app.sheet_tab_meta_store;
end $$;
revoke all on function app.refresh_sheet_stores() from public, anon, authenticated;
