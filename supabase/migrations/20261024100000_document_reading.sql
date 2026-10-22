-- 19: document reading (Phase A, first slice).
-- A file is uploaded, kept in private storage, read by the AI (Haiku first, Sonnet again when unsure), checked by rules
-- in code, and waits for a person to confirm or reject it. Nothing is written to orders or invoices from here yet.
-- Every AI read is kept (extraction_runs); every human decision is kept (document_reviews, append-only).

-- ---------------------------------------------------------------- private storage for the files
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)  -- 25 MB per file
on conflict (id) do nothing;

create policy documents_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and coalesce((select app.my_role()) in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false));
create policy documents_files_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select app.is_internal()));

-- ---------------------------------------------------------------- what is kept
alter table public.documents
  add column review_status text not null default 'pending' check (review_status in ('pending', 'confirmed', 'rejected')),
  add column reviewed_by uuid references public.staff (id),
  add column reviewed_at timestamptz;
create index documents_review on public.documents (review_status, extraction_status, created_at desc);

create table public.extraction_runs (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents (id),
  stage          text not null check (stage in ('first', 'second')),   -- first = cheap model, second = stronger model
  model          text not null,
  prompt_version text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  usd            numeric(10, 5) not null default 0,
  seconds        numeric(7, 1),
  stop_reason    text,
  result         jsonb not null,           -- exactly what the model answered
  checks         jsonb not null default '[]',  -- what the rules in code found
  created_by     uuid references public.staff (id),
  created_at     timestamptz not null default now()
);
create index extraction_runs_doc on public.extraction_runs (document_id, created_at);

create table public.document_reviews (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  decision    text not null check (decision in ('confirmed', 'corrected', 'rejected')),
  final       jsonb,                        -- the values the person accepted
  changes     jsonb not null default '[]',  -- [{field, from, to}] against what the AI read
  note        text,
  reviewer_id uuid not null references public.staff (id),
  reviewed_at timestamptz not null default now()
);
create index document_reviews_doc on public.document_reviews (document_id, reviewed_at);
create trigger document_reviews_no_update before update or delete on public.document_reviews
  for each row execute function app.forbid_mutation();

alter table public.extraction_runs enable row level security;
alter table public.document_reviews enable row level security;
create policy internal_read on public.extraction_runs for select to authenticated using ((select app.is_internal()));
create policy internal_read on public.document_reviews for select to authenticated using ((select app.is_internal()));

-- ---------------------------------------------------------------- the only ways to write (checked functions)
create or replace function public.register_document(p_filename text, p_mime text, p_size bigint, p_sha256 text, p_path text)
returns table (id uuid, duplicate_of uuid)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_dup uuid;
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot upload documents' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_path, '') = '' or coalesce(p_sha256, '') = '' then raise exception 'The file details are incomplete'; end if;
  insert into public.documents (source, original_filename, mime_type, size_bytes, sha256, storage_path, received_at, uploaded_by)
  values ('upload', left(p_filename, 300), p_mime, p_size, p_sha256, p_path, now(), app.my_staff_id())
  returning documents.id, documents.duplicate_of into v_id, v_dup;
  return query select v_id, v_dup;
end $$;

-- keep one AI read; p_final = this read is the one shown for review (the later of the two)
create or replace function public.record_extraction(
  p_doc uuid, p_stage text, p_model text, p_prompt_version text, p_input integer, p_output integer, p_usd numeric,
  p_seconds numeric, p_stop text, p_result jsonb, p_checks jsonb, p_doc_type public.doc_type, p_final boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot read documents' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.documents where documents.id = p_doc) then raise exception 'Document not found'; end if;
  insert into public.extraction_runs (document_id, stage, model, prompt_version, input_tokens, output_tokens, usd, seconds,
                                      stop_reason, result, checks, created_by)
  values (p_doc, p_stage, p_model, p_prompt_version, p_input, p_output, p_usd, p_seconds, p_stop, p_result,
          coalesce(p_checks, '[]'), app.my_staff_id());
  if p_final then
    update public.documents set extracted = p_result, doc_type = p_doc_type, extraction_status = 'needs_review'
     where documents.id = p_doc and review_status = 'pending';
  end if;
end $$;

create or replace function public.fail_extraction(p_doc uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot read documents' using errcode = 'insufficient_privilege';
  end if;
  update public.documents set extraction_status = 'failed', extracted = jsonb_build_object('error', left(p_error, 300))
   where documents.id = p_doc and review_status = 'pending' and extraction_status in ('pending', 'failed');
end $$;

create or replace function public.review_document(p_doc uuid, p_decision text, p_final jsonb, p_changes jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.documents;
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot review documents' using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('confirmed', 'corrected', 'rejected') then raise exception 'Unknown decision'; end if;
  select * into d from public.documents where id = p_doc for update;
  if not found then raise exception 'Document not found'; end if;
  if d.review_status <> 'pending' then raise exception 'This document has already been reviewed'; end if;
  if d.extraction_status not in ('needs_review', 'failed') then raise exception 'This document has not been read yet'; end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'Say why you are rejecting it'; end if;
  insert into public.document_reviews (document_id, decision, final, changes, note, reviewer_id)
  values (p_doc, p_decision, case when p_decision = 'rejected' then null else p_final end, coalesce(p_changes, '[]'), nullif(btrim(p_note), ''), app.my_staff_id());
  update public.documents set review_status = case when p_decision = 'rejected' then 'rejected' else 'confirmed' end,
                              reviewed_by = app.my_staff_id(), reviewed_at = now()
   where id = p_doc;
  insert into public.audit_log (actor_type, actor_staff_id, action, table_name, record_id, source_document_id, after_data, note)
  values ('staff', app.my_staff_id(), 'document_' || p_decision, 'documents', p_doc, p_doc, p_final, nullif(btrim(p_note), ''));
end $$;

revoke execute on function public.register_document(text, text, bigint, text, text) from public, anon;
revoke execute on function public.record_extraction(uuid, text, text, text, integer, integer, numeric, numeric, text, jsonb, jsonb, public.doc_type, boolean) from public, anon;
revoke execute on function public.fail_extraction(uuid, text) from public, anon;
revoke execute on function public.review_document(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.register_document(text, text, bigint, text, text) to authenticated;
grant execute on function public.record_extraction(uuid, text, text, text, integer, integer, numeric, numeric, text, jsonb, jsonb, public.doc_type, boolean) to authenticated;
grant execute on function public.fail_extraction(uuid, text) to authenticated;
grant execute on function public.review_document(uuid, text, jsonb, jsonb, text) to authenticated;
