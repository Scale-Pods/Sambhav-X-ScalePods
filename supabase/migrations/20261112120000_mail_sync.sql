-- 60: mail sync. Gmail access for the mailboxes the app reads (read-only), the mill's "Dispatch details" mails picked up from them, and the stock suggestions read from those mails.
-- DRAFT: not applied until the owner says so.
--
-- The existing mail tables (mailboxes, mail_threads, mail_messages: the mail tracker) are NOT changed. A mailbox keeps its row in public.mailboxes (address, active,
-- last_synced_at, sync_cursor); the Google login for it is kept apart in mailbox_tokens, which the app's login role cannot read at all.
--
-- Nothing here changes stock by itself. A mail only ever becomes a suggestion (mill_receipts, status 'pending'). Plates are added only when a person with the
-- right role approves it (mill_receipt_approve), and a mill invoice item can be received once, whatever mail it comes in.

-- ---------------------------------------------------------------- the Google login of a mailbox (server only)
create table public.mailbox_tokens (
  mailbox_id     uuid primary key references public.mailboxes (id) on delete cascade,
  token_enc      text not null,                    -- Google's refresh token, encrypted by the server
  connected_by   uuid references public.staff (id),
  connected_at   timestamptz not null default now(),
  sender_filter  text not null default '',         -- a part of the sender's name or address; empty = any sender
  subject_filter text not null default 'dispatch detail', -- a part of the subject
  last_error     text
);

-- ---------------------------------------------------------------- the mill mails picked up (only those that match the filter)
create table public.mill_mails (
  id             uuid primary key default gen_random_uuid(),
  mailbox_id     uuid not null references public.mailboxes (id) on delete cascade,
  gmail_id       text not null,
  thread_id      text,
  from_name      text,
  from_addr      text,
  subject        text,
  received_at    timestamptz,
  attachment_names text[] not null default '{}',
  source_kind    text check (source_kind in ('attachment_html', 'attachment_text', 'body_html', 'body_text')), -- where the table was read from
  source_text    text,                             -- the table's mail text or HTML as read (capped by the server), kept so a reading can be checked and repeated
  status         text not null default 'new' check (status in ('new', 'read', 'no_table', 'failed')),
  note           text,
  created_at     timestamptz not null default now(),
  unique (mailbox_id, gmail_id)
);
create index mill_mails_received on public.mill_mails (received_at desc);

-- ---------------------------------------------------------------- the suggestion a person sees: one per mail
create table public.mill_receipts (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid unique references public.mill_mails (id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rows        jsonb not null,                      -- the plates as read (lib/mill/dispatchTable.ts DispatchRow)
  consignments jsonb not null default '[]',
  totals      jsonb not null default '{}',
  warnings    jsonb not null default '[]',
  is_test     boolean not null default false,      -- made from a dummy mail
  decided_by  uuid references public.staff (id),
  decided_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);
create index mill_receipts_status on public.mill_receipts (status, created_at desc);

-- the plates a suggestion added: the mill's invoice item is unique, so the same plate group can never be received twice
create table public.mill_receipt_lines (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.mill_receipts (id) on delete cascade,
  invoice_item text not null unique,
  lot_id       uuid references public.lots (id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- who may see what
alter table public.mailbox_tokens enable row level security; -- no policy and no grant: only the server reads or writes it
alter table public.mill_mails enable row level security;
alter table public.mill_receipts enable row level security;
alter table public.mill_receipt_lines enable row level security;

create policy mill_mails_read on public.mill_mails for select to authenticated using (app.is_internal());
create policy mill_receipts_read on public.mill_receipts for select to authenticated using (app.is_internal());
create policy mill_receipt_lines_read on public.mill_receipt_lines for select to authenticated using (app.is_internal());

revoke all on public.mailbox_tokens, public.mill_mails, public.mill_receipts, public.mill_receipt_lines from anon, authenticated;
grant select on public.mill_mails, public.mill_receipts, public.mill_receipt_lines to authenticated;
-- writes happen only on the server (the sync) and through the two checked functions below

-- ---------------------------------------------------------------- approve: the only way a mail adds stock
create or replace function public.mill_receipt_approve(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  r public.mill_receipts;
  x jsonb;
  v_ent uuid; v_grade uuid; v_book uuid; v_lot uuid;
  v_added int := 0; v_skipped int := 0;
begin
  if app.my_role()::text not in ('owner', 'admin', 'approver') then raise exception 'Only an approver, an administrator or the owner may add stock from a mail'; end if;
  select * into r from public.mill_receipts where id = p_id for update;
  if not found then raise exception 'No such suggestion'; end if;
  if r.status <> 'pending' then raise exception 'This suggestion was already %', r.status; end if;

  for x in select * from jsonb_array_elements(r.rows) loop
    if exists (select 1 from public.mill_receipt_lines where invoice_item = x->>'invoice_item') then v_skipped := v_skipped + 1; continue; end if; -- received before
    if coalesce(x->>'batch', '') = '' then raise exception 'A row has no batch (heat) number: %', x->>'invoice_item'; end if;
    select e.id into v_ent from public.entities e where e.code = x->>'entity';
    if v_ent is null then raise exception 'The company "%" is not SPF or Sai', x->>'customer'; end if;
    -- the grade the mill wrote, found through the grade names (the letter O and the digit 0 are the same)
    select a.grade_id into v_grade from public.grade_aliases a
     where translate(a.alias_norm, 'O', '0') = translate(app.norm_text(x->>'grade_text'), 'O', '0') limit 1;
    if v_grade is null then raise exception 'The grade "%" is not in the grade list: add it as a name of the right grade first', x->>'grade_text'; end if;
    -- the stock book: the one that already holds this grade for this company, otherwise the company's own book
    select l.stock_book_id into v_book from public.lots l where l.grade_id = v_grade and l.entity_id = v_ent group by 1 order by count(*) desc limit 1;
    if v_book is null then select b.id into v_book from public.stock_books b where b.owner_entity_id = v_ent order by b.code limit 1; end if;
    if v_book is null then raise exception 'There is no stock book for % yet: create it first', x->>'entity'; end if;

    insert into public.lots (stock_book_id, entity_id, origin, grade_id, grade_raw, thickness_mm, width_mm, length_mm, heat_no, tc_no, receipt_date, pieces_received, invoice_weight_kg, remarks)
    values (v_book, v_ent, 'purchase', v_grade, x->>'grade_text', (x->>'thickness_mm')::numeric, (x->>'width_mm')::numeric, (x->>'length_mm')::numeric, x->>'batch', nullif(x->>'tc_no', ''),
            (x->>'invoice_date')::date, (x->>'pieces')::int, round((x->>'tonnes')::numeric * 1000, 2),
            'From the mill dispatch mail, invoice item ' || (x->>'invoice_item') || ', truck ' || coalesce(x->>'truck_no', '?') || ', rate ' || coalesce(x->>'upr', '?') || ' per tonne' || case when r.is_test then ' (TEST)' else '' end)
    returning id into v_lot;
    insert into public.stock_movements (lot_id, movement_type, pieces, weight_kg, movement_date, note)
    values (v_lot, 'receipt', (x->>'pieces')::int, round((x->>'tonnes')::numeric * 1000, 2), (x->>'invoice_date')::date, 'Mill dispatch mail, invoice item ' || (x->>'invoice_item') || ', approved by ' || coalesce((select full_name from public.staff where id = app.my_staff_id()), '?'));
    insert into public.mill_receipt_lines (receipt_id, invoice_item, lot_id) values (p_id, x->>'invoice_item', v_lot);
    v_added := v_added + 1;
  end loop;

  update public.mill_receipts set status = 'approved', decided_by = app.my_staff_id(), decided_at = now() where id = p_id;
  return jsonb_build_object('added', v_added, 'already_received', v_skipped);
end $$;

create or replace function public.mill_receipt_reject(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if app.my_role()::text not in ('owner', 'admin', 'approver') then raise exception 'Only an approver, an administrator or the owner may decide on a mail'; end if;
  update public.mill_receipts set status = 'rejected', decided_by = app.my_staff_id(), decided_at = now(), note = left(p_note, 300) where id = p_id and status = 'pending';
  if not found then raise exception 'No pending suggestion with that id'; end if;
end $$;

revoke execute on function public.mill_receipt_approve(uuid), public.mill_receipt_reject(uuid, text) from public, anon;
grant execute on function public.mill_receipt_approve(uuid), public.mill_receipt_reject(uuid, text) to authenticated;
