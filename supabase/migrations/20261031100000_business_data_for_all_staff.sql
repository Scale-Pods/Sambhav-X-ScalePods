-- money, orders, mail and Tally are open to every staff login (owner's decision, 31 Oct 2026: "keep it transparent to all the users").
-- This reverses the narrowing of migrations 22 and 27 on purpose. "Every staff login" means the roles app.is_internal() lists
-- (owner, admin, approver, accounts, sales, office, viewer). The outside partner role (partner_rs) still sees nothing of this.
-- What stays limited to the owner and administrators: the raw sheet copies (sheet_rows and friends, which also hold sheets we do not show),
-- the Tally connector record (it holds the key's hash), downloads, "Sync now", and the sheet view. Customer documents keep their own rule (27).
-- Every change of data is still recorded with who made it (audit_log); a "changed by" remark on each screen is planned with the per-person logins.

-- the stored copies of the sheet views: same views, the rule now asks "is this a staff login" instead of "is this an administrator"
create or replace view public.v_order_lines      with (security_invoker = true) as select * from app.v_order_lines_store      where (select app.is_internal());
create or replace view public.v_orders           with (security_invoker = true) as select * from app.v_orders_store           where (select app.is_internal());
create or replace view public.v_sales_invoices   with (security_invoker = true) as select * from app.v_sales_invoices_store   where (select app.is_internal());
create or replace view public.v_purchase_invoices with (security_invoker = true) as select * from app.v_purchase_invoices_store where (select app.is_internal());
create or replace view public.v_expenses         with (security_invoker = true) as select * from app.v_expenses_store         where (select app.is_internal());
create or replace view public.v_receivables      with (security_invoker = true) as select * from app.v_receivables_store      where (select app.is_internal());
create or replace view public.v_payables         with (security_invoker = true) as select * from app.v_payables_store         where (select app.is_internal());
create or replace view public.v_gpay_payments    with (security_invoker = true) as select * from app.v_gpay_payments_store    where (select app.is_internal());
create or replace view public.v_petty_expenses   with (security_invoker = true) as select * from app.v_petty_expenses_store   where (select app.is_internal());
create or replace view public.v_brokerage        with (security_invoker = true) as select * from app.v_brokerage_store        where (select app.is_internal());
create or replace view public.v_pay_summary      with (security_invoker = true) as select * from app.v_pay_summary_store      where (select app.is_internal());
create or replace view public.v_vehicle_register with (security_invoker = true) as select * from app.v_vehicle_register_store where (select app.is_internal());
create or replace view public.v_mail_inbox       with (security_invoker = true) as select * from app.v_mail_inbox_store       where (select app.is_internal());
create or replace view public.v_quotations       with (security_invoker = true) as select * from app.v_quotations_store       where (select app.is_internal());
create or replace view public.v_leads            with (security_invoker = true) as select * from app.v_leads_store            where (select app.is_internal());
create or replace view public.v_mail_clients     with (security_invoker = true) as select * from app.v_mail_clients_store     where (select app.is_internal());

-- Tally data: readable by every staff login (the connector record is not: it holds the key's hash)
do $$
declare t text;
begin
  foreach t in array array['tally_companies', 'tally_ledgers', 'tally_outstanding_bills', 'tally_stock_items', 'tally_sync_requests', 'tally_sync_runs', 'tally_voucher_items', 'tally_vouchers']
  loop
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('drop policy if exists internal_read on public.%I', t);
    execute format('create policy internal_read on public.%I for select to authenticated using ((select app.is_internal()))', t);
  end loop;
end $$;

-- the connection status of the Tally PC, without the key: only what the status screens show
create or replace function public.tally_connector_state()
returns table (seen_min integer, ok_min integer, last_seen_at timestamptz, last_status text, last_message text, last_version text, last_sync_ok_at timestamptz)
language sql stable security definer set search_path = public as $$
  select (extract(epoch from now() - c.last_seen_at) / 60)::int, (extract(epoch from now() - c.last_sync_ok_at) / 60)::int,
         c.last_seen_at, c.last_status, c.last_message, c.last_version, c.last_sync_ok_at
    from public.tally_connectors c
   where c.active and app.is_internal()
   order by c.created_at limit 1
$$;
revoke all on function public.tally_connector_state() from public, anon;
grant execute on function public.tally_connector_state() to authenticated;
