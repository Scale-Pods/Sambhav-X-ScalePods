-- 0003 documents, approval inbox, audit log, exceptions

-- ---------------------------------------------------------------- documents (every file that enters the system)
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid references public.entities (id),
  doc_type          public.doc_type not null default 'other',
  source            public.doc_source not null,
  original_filename text,
  mime_type         text,
  size_bytes        bigint,
  sha256            text,
  storage_path      text,            -- Supabase Storage object
  drive_file_id     text,
  drive_url         text,
  gmail_message_id  text,
  mailbox_id        uuid,            -- FK added in 0007
  received_at       timestamptz,
  uploaded_by       uuid references public.staff (id),
  duplicate_of      uuid references public.documents (id),
  extraction_status text not null default 'pending'
                    check (extraction_status in ('pending', 'extracted', 'needs_review', 'failed')),
  extracted         jsonb,           -- what the AI read, before any human correction
  created_at        timestamptz not null default now()
);
create index documents_sha256 on public.documents (sha256);
create index documents_type on public.documents (doc_type, created_at desc);
create index documents_gmail on public.documents (gmail_message_id);

-- the same bill arriving twice (form double-upload, automation writing a PO twice)
create or replace function app.documents_flag_duplicate()
returns trigger language plpgsql as $$
begin
  if new.sha256 is not null and new.duplicate_of is null then
    select d.id into new.duplicate_of
      from public.documents d
     where d.sha256 = new.sha256 and d.id <> new.id and d.duplicate_of is null
     order by d.created_at limit 1;
  end if;
  return new;
end $$;
create trigger documents_duplicate before insert on public.documents
  for each row execute function app.documents_flag_duplicate();

-- ---------------------------------------------------------------- approval inbox (AI proposes, a person decides)
create table public.approval_requests (
  id                 uuid primary key default gen_random_uuid(),
  kind               public.approval_kind not null,
  status             public.approval_status not null default 'pending',
  risk_tier          public.risk_tier not null default 'medium',
  entity_id          uuid references public.entities (id),
  stock_book_id      uuid references public.stock_books (id),
  subject_table      text,
  subject_id         uuid,
  proposed           jsonb not null default '{}',     -- what the AI / system proposes
  final              jsonb,                           -- what the person approved (after corrections)
  discrepancies      jsonb not null default '[]',     -- validation flags shown beside the source document
  source_document_id uuid references public.documents (id),
  batch_id           uuid,
  created_by_type    text not null default 'system' check (created_by_type in ('system', 'ai', 'staff')),
  created_by         uuid references public.staff (id),
  decided_by         uuid references public.staff (id),
  decided_at         timestamptz,
  reviewer_note      text,
  created_at         timestamptz not null default now(),
  constraint approval_decided_chk
    check (status in ('pending', 'superseded') or (decided_by is not null and decided_at is not null)),
  constraint approval_high_risk_note_chk
    check (not (risk_tier = 'high' and status in ('approved', 'corrected') and coalesce(reviewer_note, '') = ''))
);
create index approval_requests_pending on public.approval_requests (status, risk_tier, created_at)
  where status = 'pending';
create index approval_requests_subject on public.approval_requests (subject_table, subject_id);

-- ---------------------------------------------------------------- audit log (append-only)
create table public.audit_log (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor_type      text not null default 'system' check (actor_type in ('staff', 'system', 'ai')),
  actor_staff_id  uuid,
  action          text not null,
  table_name      text,
  record_id       uuid,
  source_document_id uuid,
  before_data     jsonb,
  after_data      jsonb,
  note            text
);
create index audit_log_record on public.audit_log (table_name, record_id, at desc);
create index audit_log_actor on public.audit_log (actor_staff_id, at desc);

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.forbid_mutation();

-- generic row audit: attach to any table with an `id uuid` column
create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_staff uuid := app.my_staff_id();
  v_id    uuid;
begin
  v_id := case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'id')::uuid else (to_jsonb(new) ->> 'id')::uuid end;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, before_data, after_data)
  values (case when v_staff is null then 'system' else 'staff' end,
          v_staff,
          lower(tg_op),
          tg_table_name,
          v_id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger approval_requests_audit after insert or update or delete on public.approval_requests
  for each row execute function app.audit_row();
create trigger settings_audit after update on public.settings
  for each row execute function app.audit_row();
create trigger staff_audit after insert or update or delete on public.staff
  for each row execute function app.audit_row();
create trigger parties_audit after insert or update or delete on public.parties
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------- exceptions (failures are shown, never hidden)
create table public.exceptions (
  id          uuid primary key default gen_random_uuid(),
  kind        public.exception_kind not null,
  severity    public.severity not null default 'warning',
  entity_id   uuid references public.entities (id),
  message     text not null,
  context     jsonb not null default '{}',
  related_table text,
  related_id  uuid,
  status      text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  raised_at   timestamptz not null default now(),
  resolved_by uuid references public.staff (id),
  resolved_at timestamptz,
  resolution_note text
);
create index exceptions_open on public.exceptions (kind, raised_at desc) where status = 'open';
