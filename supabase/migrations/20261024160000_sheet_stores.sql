-- 22: stored copies of the sheet-based views, so pages stop recalculating every Google Sheet row on every click.
-- The sheets change once a day (the sync); the copies are refreshed at the end of each sync by app.refresh_sheet_stores().
-- Names and access stay the same: each public view now reads its stored copy, and only the owner and administrators see rows
-- (the same rule as before, through app.is_admin()). The original formulas are kept as <name>_live and are what the copies are built from.
-- The stored copies live in the app schema, which the public API does not expose.
-- v_order_lines
alter view public.v_order_lines rename to v_order_lines_live;
create materialized view app.v_order_lines_store as select * from public.v_order_lines_live;
create view public.v_order_lines with (security_invoker = true) as select * from app.v_order_lines_store where (select app.is_admin());
revoke all on public.v_order_lines_live from anon, authenticated;
revoke all on app.v_order_lines_store from public, anon;
grant select on app.v_order_lines_store to authenticated;
grant select on public.v_order_lines to authenticated;
create index v_order_lines_store_order_no on app.v_order_lines_store (order_no);
-- v_orders
alter view public.v_orders rename to v_orders_live;
create materialized view app.v_orders_store as select * from public.v_orders_live;
create view public.v_orders with (security_invoker = true) as select * from app.v_orders_store where (select app.is_admin());
revoke all on public.v_orders_live from anon, authenticated;
revoke all on app.v_orders_store from public, anon;
grant select on app.v_orders_store to authenticated;
grant select on public.v_orders to authenticated;
create index v_orders_store_order_no on app.v_orders_store (order_no);
create index v_orders_store_order_date on app.v_orders_store (order_date);
-- v_sales_invoices
alter view public.v_sales_invoices rename to v_sales_invoices_live;
create materialized view app.v_sales_invoices_store as select * from public.v_sales_invoices_live;
create view public.v_sales_invoices with (security_invoker = true) as select * from app.v_sales_invoices_store where (select app.is_admin());
revoke all on public.v_sales_invoices_live from anon, authenticated;
revoke all on app.v_sales_invoices_store from public, anon;
grant select on app.v_sales_invoices_store to authenticated;
grant select on public.v_sales_invoices to authenticated;
create index v_sales_invoices_store_invoice_date on app.v_sales_invoices_store (invoice_date);
-- v_purchase_invoices
alter view public.v_purchase_invoices rename to v_purchase_invoices_live;
create materialized view app.v_purchase_invoices_store as select * from public.v_purchase_invoices_live;
create view public.v_purchase_invoices with (security_invoker = true) as select * from app.v_purchase_invoices_store where (select app.is_admin());
revoke all on public.v_purchase_invoices_live from anon, authenticated;
revoke all on app.v_purchase_invoices_store from public, anon;
grant select on app.v_purchase_invoices_store to authenticated;
grant select on public.v_purchase_invoices to authenticated;
create index v_purchase_invoices_store_invoice_date on app.v_purchase_invoices_store (invoice_date);
-- v_expenses
alter view public.v_expenses rename to v_expenses_live;
create materialized view app.v_expenses_store as select * from public.v_expenses_live;
create view public.v_expenses with (security_invoker = true) as select * from app.v_expenses_store where (select app.is_admin());
revoke all on public.v_expenses_live from anon, authenticated;
revoke all on app.v_expenses_store from public, anon;
grant select on app.v_expenses_store to authenticated;
grant select on public.v_expenses to authenticated;
-- v_receivables
alter view public.v_receivables rename to v_receivables_live;
create materialized view app.v_receivables_store as select * from public.v_receivables_live;
create view public.v_receivables with (security_invoker = true) as select * from app.v_receivables_store where (select app.is_admin());
revoke all on public.v_receivables_live from anon, authenticated;
revoke all on app.v_receivables_store from public, anon;
grant select on app.v_receivables_store to authenticated;
grant select on public.v_receivables to authenticated;
-- v_payables
alter view public.v_payables rename to v_payables_live;
create materialized view app.v_payables_store as select * from public.v_payables_live;
create view public.v_payables with (security_invoker = true) as select * from app.v_payables_store where (select app.is_admin());
revoke all on public.v_payables_live from anon, authenticated;
revoke all on app.v_payables_store from public, anon;
grant select on app.v_payables_store to authenticated;
grant select on public.v_payables to authenticated;
-- v_gpay_payments
alter view public.v_gpay_payments rename to v_gpay_payments_live;
create materialized view app.v_gpay_payments_store as select * from public.v_gpay_payments_live;
create view public.v_gpay_payments with (security_invoker = true) as select * from app.v_gpay_payments_store where (select app.is_admin());
revoke all on public.v_gpay_payments_live from anon, authenticated;
revoke all on app.v_gpay_payments_store from public, anon;
grant select on app.v_gpay_payments_store to authenticated;
grant select on public.v_gpay_payments to authenticated;
-- v_petty_expenses
alter view public.v_petty_expenses rename to v_petty_expenses_live;
create materialized view app.v_petty_expenses_store as select * from public.v_petty_expenses_live;
create view public.v_petty_expenses with (security_invoker = true) as select * from app.v_petty_expenses_store where (select app.is_admin());
revoke all on public.v_petty_expenses_live from anon, authenticated;
revoke all on app.v_petty_expenses_store from public, anon;
grant select on app.v_petty_expenses_store to authenticated;
grant select on public.v_petty_expenses to authenticated;
-- v_brokerage
alter view public.v_brokerage rename to v_brokerage_live;
create materialized view app.v_brokerage_store as select * from public.v_brokerage_live;
create view public.v_brokerage with (security_invoker = true) as select * from app.v_brokerage_store where (select app.is_admin());
revoke all on public.v_brokerage_live from anon, authenticated;
revoke all on app.v_brokerage_store from public, anon;
grant select on app.v_brokerage_store to authenticated;
grant select on public.v_brokerage to authenticated;
-- v_pay_summary
alter view public.v_pay_summary rename to v_pay_summary_live;
create materialized view app.v_pay_summary_store as select * from public.v_pay_summary_live;
create view public.v_pay_summary with (security_invoker = true) as select * from app.v_pay_summary_store where (select app.is_admin());
revoke all on public.v_pay_summary_live from anon, authenticated;
revoke all on app.v_pay_summary_store from public, anon;
grant select on app.v_pay_summary_store to authenticated;
grant select on public.v_pay_summary to authenticated;
-- v_vehicle_register
alter view public.v_vehicle_register rename to v_vehicle_register_live;
create materialized view app.v_vehicle_register_store as select * from public.v_vehicle_register_live;
create view public.v_vehicle_register with (security_invoker = true) as select * from app.v_vehicle_register_store where (select app.is_admin());
revoke all on public.v_vehicle_register_live from anon, authenticated;
revoke all on app.v_vehicle_register_store from public, anon;
grant select on app.v_vehicle_register_store to authenticated;
grant select on public.v_vehicle_register to authenticated;
-- v_mail_inbox
alter view public.v_mail_inbox rename to v_mail_inbox_live;
create materialized view app.v_mail_inbox_store as select * from public.v_mail_inbox_live;
create view public.v_mail_inbox with (security_invoker = true) as select * from app.v_mail_inbox_store where (select app.is_admin());
revoke all on public.v_mail_inbox_live from anon, authenticated;
revoke all on app.v_mail_inbox_store from public, anon;
grant select on app.v_mail_inbox_store to authenticated;
grant select on public.v_mail_inbox to authenticated;
create index v_mail_inbox_store_received_at on app.v_mail_inbox_store (received_at);
-- v_quotations
alter view public.v_quotations rename to v_quotations_live;
create materialized view app.v_quotations_store as select * from public.v_quotations_live;
create view public.v_quotations with (security_invoker = true) as select * from app.v_quotations_store where (select app.is_admin());
revoke all on public.v_quotations_live from anon, authenticated;
revoke all on app.v_quotations_store from public, anon;
grant select on app.v_quotations_store to authenticated;
grant select on public.v_quotations to authenticated;
create index v_quotations_store_quoted_at on app.v_quotations_store (quoted_at);
-- v_leads
alter view public.v_leads rename to v_leads_live;
create materialized view app.v_leads_store as select * from public.v_leads_live;
create view public.v_leads with (security_invoker = true) as select * from app.v_leads_store where (select app.is_admin());
revoke all on public.v_leads_live from anon, authenticated;
revoke all on app.v_leads_store from public, anon;
grant select on app.v_leads_store to authenticated;
grant select on public.v_leads to authenticated;
create index v_leads_store_received_at on app.v_leads_store (received_at);
-- v_mail_clients
alter view public.v_mail_clients rename to v_mail_clients_live;
create materialized view app.v_mail_clients_store as select * from public.v_mail_clients_live;
create view public.v_mail_clients with (security_invoker = true) as select * from app.v_mail_clients_store where (select app.is_admin());
revoke all on public.v_mail_clients_live from anon, authenticated;
revoke all on app.v_mail_clients_store from public, anon;
grant select on app.v_mail_clients_store to authenticated;
grant select on public.v_mail_clients to authenticated;

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
end $$;
revoke all on function app.refresh_sheet_stores() from public, anon, authenticated;
