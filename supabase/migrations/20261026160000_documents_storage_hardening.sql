-- 28: the document bucket accepts only what the reader can handle, and only through the app's checked path (break-it review findings 6, 8 and 14).
-- Files now go from the browser straight to storage with a one-time signed upload link the app hands out after its own checks (type, size, role),
-- which also removes the 4.5 MB request limit of the web host. The app then reads the stored file, checks its real type from its first bytes,
-- and only then registers it. The bucket itself refuses other types and sizes, and the storage rules only allow our own file names.

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], file_size_limit = 26214400
 where id = 'documents';

drop policy if exists documents_files_insert on storage.objects;
create policy documents_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and name ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}-[A-Za-z0-9._-]{0,80}$' and (select app.can_read_documents()));

-- a person may remove a file they just uploaded (the app does this when the file turns out to be the wrong type or a copy)
drop policy if exists documents_files_delete on storage.objects;
create policy documents_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and owner_id = (select auth.uid())::text and created_at > now() - interval '1 hour' and (select app.can_read_documents()));

-- registering a document also checks the file's details, so a call that skips the app still cannot register something odd
create or replace function public.register_document(p_filename text, p_mime text, p_size bigint, p_sha256 text, p_path text)
returns table (id uuid, duplicate_of uuid)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_dup uuid;
begin
  if not coalesce(app.my_role() in ('owner', 'admin', 'approver', 'accounts', 'sales', 'office'), false) then
    raise exception 'Your role cannot upload documents' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_path, '') = '' or coalesce(p_sha256, '') = '' then raise exception 'The file details are incomplete'; end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'Only PDF, JPG, PNG and WebP files can be read'; end if;
  if p_size is null or p_size < 1 or p_size > 26214400 then raise exception 'The file must be between 1 byte and 25 MB'; end if;
  if p_path !~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}-[A-Za-z0-9._-]{0,80}$' then raise exception 'Unexpected file location'; end if;
  insert into public.documents (source, original_filename, mime_type, size_bytes, sha256, storage_path, received_at, uploaded_by)
  values ('upload', left(p_filename, 300), p_mime, p_size, p_sha256, p_path, now(), app.my_staff_id())
  returning documents.id, documents.duplicate_of into v_id, v_dup;
  return query select v_id, v_dup;
end $$;
