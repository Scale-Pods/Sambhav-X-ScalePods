-- 12: make row-level security cheap.
-- Postgres was re-running the 'who is this person' functions for every row (1-1.8 s per page query).
-- Wrapping them in (select ...) makes Postgres work them out once per query; staff who can see every book
-- skip the per-row book check entirely. What each person may see does not change.

alter policy internal_read on public.approval_requests using ((select app.is_internal()));
alter policy admin_read on public.audit_log using ((select app.is_admin()));
alter policy internal_read on public.brokerage_entries using ((select app.is_internal()));
alter policy book_read on public.certificates using ((select app.is_internal()) or (((select app.is_internal()) OR (EXISTS ( SELECT 1
   FROM (lot_certificates lc
     JOIN lots l ON ((l.id = lc.lot_id)))
  WHERE ((lc.certificate_id = certificates.id) AND app.can_see_book(l.stock_book_id)))))));
alter policy internal_read on public.client_profiles using ((select app.is_internal()));
alter policy book_read on public.count_lines using ((select app.is_internal()) or ((EXISTS ( SELECT 1
   FROM count_sessions s
  WHERE ((s.id = count_lines.session_id) AND app.can_see_book(s.stock_book_id))))));
alter policy book_read on public.count_sessions using ((select app.is_internal()) or (app.can_see_book(stock_book_id)));
alter policy internal_read on public.dispatch_lines using ((select app.is_internal()));
alter policy internal_read on public.dispatches using ((select app.is_internal()));
alter policy internal_read on public.documents using ((select app.is_internal()));
alter policy ref_read on public.entities using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
alter policy internal_read on public.exceptions using ((select app.is_internal()));
alter policy ref_read on public.grade_aliases using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
alter policy ref_read on public.grades using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
alter policy internal_read on public.gst_return_files using ((select app.is_internal()));
alter policy internal_read on public.gst_return_lines using ((select app.is_internal()));
alter policy admin_read on public.import_batches using ((select app.is_admin()));
alter policy internal_read on public.invoice_paperwork using ((select app.is_internal()));
alter policy admin_read on public.legacy_refs using ((select app.is_admin()));
alter policy book_read on public.lot_certificates using ((select app.is_internal()) or ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_certificates.lot_id) AND app.can_see_book(l.stock_book_id))))));
alter policy book_read on public.lot_costs using ((select app.is_internal()) or ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_costs.lot_id) AND app.can_see_book(l.stock_book_id))))));
alter policy book_read on public.lot_status_events using ((select app.is_internal()) or ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_status_events.lot_id) AND app.can_see_book(l.stock_book_id))))));
alter policy book_read on public.lots using ((select app.is_internal()) or (app.can_see_book(stock_book_id)));
alter policy own_mailbox on public.mail_threads using (((select app.is_admin()) OR (EXISTS ( SELECT 1
   FROM mailboxes m
  WHERE ((m.id = mail_threads.mailbox_id) AND ((m.owner_staff_id = (select app.my_staff_id())) OR (EXISTS ( SELECT 1
           FROM mailbox_access a
          WHERE ((a.mailbox_id = m.id) AND (a.staff_id = (select app.my_staff_id())))))))))));
alter policy own_access on public.mailbox_access using (((select app.is_admin()) OR (staff_id = (select app.my_staff_id()))));
alter policy own_mailbox on public.mailboxes using (((select app.is_admin()) OR (owner_staff_id = (select app.my_staff_id())) OR (EXISTS ( SELECT 1
   FROM mailbox_access a
  WHERE ((a.mailbox_id = mailboxes.id) AND (a.staff_id = (select app.my_staff_id())))))));
alter policy internal_read on public.order_crm_events using ((select app.is_internal()));
alter policy internal_read on public.order_line_testing using ((select app.is_internal()));
alter policy internal_read on public.order_lines using ((select app.is_internal()));
alter policy internal_read on public.orders using ((select app.is_internal()));
alter policy internal_read on public.ownership_clashes using ((select app.is_internal()));
alter policy internal_read on public.parties using ((select app.is_internal()));
alter policy internal_read on public.party_aliases using ((select app.is_internal()));
alter policy internal_read on public.party_contacts using ((select app.is_internal()));
alter policy internal_read on public.purchase_invoice_lines using ((select app.is_internal()));
alter policy internal_read on public.purchase_invoices using ((select app.is_internal()));
alter policy internal_read on public.quotation_lines using ((select app.is_internal()));
alter policy internal_read on public.quotation_outcomes using ((select app.is_internal()));
alter policy internal_read on public.quotations using ((select app.is_internal()));
alter policy ref_read on public.ref_values using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
alter policy internal_read on public.sales_invoice_lines using ((select app.is_internal()));
alter policy internal_read on public.sales_invoice_workflow using ((select app.is_internal()));
alter policy internal_read on public.sales_invoices using ((select app.is_internal()));
alter policy internal_read on public.settings using ((select app.is_internal()));
alter policy internal_read on public.sheets_backup_targets using ((select app.is_internal()));
alter policy internal_read on public.sheets_write_log using ((select app.is_internal()));
alter policy internal_read on public.staff using ((select app.is_internal()));
alter policy internal_read on public.staff_aliases using ((select app.is_internal()));
alter policy book_read on public.stock_books using ((select app.is_internal()) or (app.can_see_book(id)));
alter policy book_read on public.stock_movements using ((select app.is_internal()) or ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = stock_movements.lot_id) AND app.can_see_book(l.stock_book_id))))));
alter policy internal_read on public.tally_companies using ((select app.is_internal()));
alter policy internal_read on public.tally_ledgers using ((select app.is_internal()));
alter policy internal_read on public.tally_outstanding_bills using ((select app.is_internal()));
alter policy internal_read on public.tally_sync_runs using ((select app.is_internal()));
alter policy internal_read on public.tally_voucher_items using ((select app.is_internal()));
alter policy internal_read on public.tally_vouchers using ((select app.is_internal()));
alter policy ref_read on public.unit_aliases using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
alter policy ref_read on public.units using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
alter policy internal_read on public.whatsapp_messages using ((select app.is_internal()));
alter policy internal_read on public.whatsapp_templates using ((select app.is_internal()));
alter policy ref_read on public.yards using (((select app.is_internal()) OR ((select app.my_role()) = 'partner_rs'::app_role)));
