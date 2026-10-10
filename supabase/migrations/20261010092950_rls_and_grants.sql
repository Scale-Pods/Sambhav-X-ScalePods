-- 0009 row-level security and grants
-- Model: the browser only READS (RLS below). Writes go through server code using the service role, or through
-- the security-definer RPC public.decide_approval(). Margins are visible to all internal staff by design; the
-- Ridhi Siddhi partner role sees only stock books flagged partner_visible (WB2). Each person sees their own
-- mailbox plus the counts-only summary (v_mail_summary).

-- ---------------------------------------------------------------- privileges
grant usage on schema app to authenticated;
grant usage on schema public to authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

grant select on all tables in schema public to authenticated;

-- tables created by later migrations stay closed to anon and read-only to signed-in users
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public grant select on tables to authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------- enable RLS everywhere + standard internal read policy
do $$
declare
  t text;
  custom text[] := array[
    'entities', 'stock_books', 'yards', 'grades', 'grade_aliases', 'units', 'unit_aliases', 'ref_values',
    'lots', 'stock_movements', 'lot_costs', 'lot_status_events', 'lot_certificates', 'certificates',
    'count_sessions', 'count_lines',
    'mailboxes', 'mailbox_access', 'mail_threads', 'mail_messages',
    'audit_log', 'import_batches', 'legacy_refs'
  ];
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    if t <> all (custom) then
      execute format('create policy internal_read on public.%I for select to authenticated using (app.is_internal())', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- shared reference data: internal staff and the partner
create policy ref_read on public.entities       for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy ref_read on public.yards          for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy ref_read on public.grades         for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy ref_read on public.grade_aliases  for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy ref_read on public.units          for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy ref_read on public.unit_aliases   for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy ref_read on public.ref_values     for select to authenticated using (app.is_internal() or app.my_role() = 'partner_rs');
create policy book_read on public.stock_books   for select to authenticated using (app.can_see_book(id));

-- ---------------------------------------------------------------- stock: scoped by stock book
create policy book_read on public.lots for select to authenticated using (app.can_see_book(stock_book_id));

create policy book_read on public.stock_movements for select to authenticated using (
  exists (select 1 from public.lots l where l.id = stock_movements.lot_id and app.can_see_book(l.stock_book_id)));
create policy book_read on public.lot_costs for select to authenticated using (
  exists (select 1 from public.lots l where l.id = lot_costs.lot_id and app.can_see_book(l.stock_book_id)));
create policy book_read on public.lot_status_events for select to authenticated using (
  exists (select 1 from public.lots l where l.id = lot_status_events.lot_id and app.can_see_book(l.stock_book_id)));
create policy book_read on public.lot_certificates for select to authenticated using (
  exists (select 1 from public.lots l where l.id = lot_certificates.lot_id and app.can_see_book(l.stock_book_id)));
create policy book_read on public.certificates for select to authenticated using (
  app.is_internal() or exists (
    select 1 from public.lot_certificates lc join public.lots l on l.id = lc.lot_id
     where lc.certificate_id = certificates.id and app.can_see_book(l.stock_book_id)));

create policy book_read on public.count_sessions for select to authenticated using (app.can_see_book(stock_book_id));
create policy book_read on public.count_lines for select to authenticated using (
  exists (select 1 from public.count_sessions s where s.id = count_lines.session_id and app.can_see_book(s.stock_book_id)));

-- ---------------------------------------------------------------- mail: own mailbox only (admins see all)
create policy own_mailbox on public.mailboxes for select to authenticated using (
  app.is_admin() or owner_staff_id = app.my_staff_id()
  or exists (select 1 from public.mailbox_access a where a.mailbox_id = mailboxes.id and a.staff_id = app.my_staff_id()));
create policy own_access on public.mailbox_access for select to authenticated using (
  app.is_admin() or staff_id = app.my_staff_id());
create policy own_mailbox on public.mail_threads for select to authenticated using (
  app.is_admin()
  or exists (select 1 from public.mailboxes m
              where m.id = mail_threads.mailbox_id
                and (m.owner_staff_id = app.my_staff_id()
                     or exists (select 1 from public.mailbox_access a where a.mailbox_id = m.id and a.staff_id = app.my_staff_id()))));
create policy own_mailbox on public.mail_messages for select to authenticated using (
  exists (select 1 from public.mail_threads t where t.id = mail_messages.thread_id));   -- inherits the thread policy

-- ---------------------------------------------------------------- admin-only
create policy admin_read on public.audit_log      for select to authenticated using (app.is_admin());
create policy admin_read on public.import_batches for select to authenticated using (app.is_admin());
create policy admin_read on public.legacy_refs    for select to authenticated using (app.is_admin());

-- ---------------------------------------------------------------- approvals: decided through one checked function
create or replace function public.decide_approval(
  p_id     uuid,
  p_status public.approval_status,
  p_final  jsonb default null,
  p_note   text default null)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
begin
  if p_status not in ('approved', 'rejected', 'corrected') then
    raise exception 'Invalid decision: %', p_status;
  end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if r.status <> 'pending' then
    raise exception 'Request is already %', r.status;
  end if;
  if not app.can_approve(r.kind) then
    raise exception 'You are not allowed to decide % requests', r.kind using errcode = 'insufficient_privilege';
  end if;
  if r.created_by is not null and r.created_by = app.my_staff_id() then
    raise exception 'Maker-checker: you cannot approve your own request' using errcode = 'insufficient_privilege';
  end if;
  update public.approval_requests
     set status = p_status,
         final = coalesce(p_final, proposed),
         decided_by = app.my_staff_id(),
         decided_at = now(),
         reviewer_note = p_note
   where id = p_id
   returning * into r;
  return r;
end $$;

revoke execute on function public.decide_approval(uuid, public.approval_status, jsonb, text) from public, anon;
grant execute on function public.decide_approval(uuid, public.approval_status, jsonb, text) to authenticated;
