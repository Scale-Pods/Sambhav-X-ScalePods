-- 27: who may read what through the database API (break-it review finding 5).
-- The screens already limited Tally to the owner and administrators; the database now does too, so a staff login of any other role
-- (sales, office, accounts, viewer ...) cannot read the books by calling the API directly. Customer documents are limited to the roles
-- that work with them (those who may upload); a view-only login no longer sees customer POs.

do $$
declare t text;
begin
  foreach t in array array['tally_companies', 'tally_ledgers', 'tally_outstanding_bills', 'tally_stock_items', 'tally_sync_requests', 'tally_sync_runs', 'tally_voucher_items', 'tally_vouchers']
  loop
    execute format('drop policy if exists internal_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select app.is_admin()))', t);
  end loop;
end $$;

create or replace function app.can_read_documents()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false)
$$;
revoke all on function app.can_read_documents() from public, anon;
grant execute on function app.can_read_documents() to authenticated;

drop policy if exists internal_read on public.documents;
create policy documents_read on public.documents for select to authenticated using ((select app.can_read_documents()));
drop policy if exists internal_read on public.document_reviews;
create policy documents_read on public.document_reviews for select to authenticated using ((select app.can_read_documents()));
drop policy if exists documents_files_read on storage.objects;
create policy documents_files_read on storage.objects for select to authenticated using (bucket_id = 'documents' and (select app.can_read_documents()));
