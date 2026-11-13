-- 64: payment reminders. Two small tables, nothing else is changed.
-- Applied.
--
--   customer_contacts : who a customer's reminder goes to (To, Cc) and the subject of the old conversation to reply into, kept per customer so it is typed once.
--   payment_reminders : the history of reminders sent from the app (who, when, how much, which invoices), so the next reminder knows how many came before.
--
-- Both are written only by the server (after it has checked the person's role and sent the mail); every staff login can read them.

create table public.customer_contacts (
  id            uuid primary key default gen_random_uuid(),
  party         text not null,                        -- the customer's name as in the Debtors list
  to_emails     text not null default '',             -- as written: addresses separated by commas
  cc_emails     text not null default '',
  reply_subject text not null default '',             -- "Re: ..." of the conversation the reminder is sent into; empty = a new conversation
  updated_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now()
);
create unique index customer_contacts_party on public.customer_contacts (lower(btrim(party)));

create table public.payment_reminders (
  id               uuid primary key default gen_random_uuid(),
  party            text not null,
  entity           text not null check (entity in ('SPF', 'SAI')),
  mailbox_id       uuid references public.mailboxes (id) on delete set null,
  to_emails        text not null default '',
  cc_emails        text not null default '',
  subject          text not null,
  invoice_nos      text[] not null default '{}',      -- the invoices listed as pending in that mail
  overdue_count    int not null,
  total_pending    numeric(14, 2) not null,
  oldest_days      int,
  tone             text not null check (tone in ('statement', 'firm')),
  gmail_message_id text,
  gmail_thread_id  text,
  sent_by          uuid references public.staff (id),
  sent_at          timestamptz not null default now()
);
create index payment_reminders_party on public.payment_reminders (lower(btrim(party)), sent_at desc);

alter table public.customer_contacts enable row level security;
alter table public.payment_reminders enable row level security;
create policy customer_contacts_read on public.customer_contacts for select to authenticated using (app.is_internal());
create policy payment_reminders_read on public.payment_reminders for select to authenticated using (app.is_internal());
revoke all on public.customer_contacts, public.payment_reminders from anon, authenticated;
grant select on public.customer_contacts, public.payment_reminders to authenticated;
