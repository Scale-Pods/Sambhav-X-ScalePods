-- 61: delivery challans in the document reader. Confirming a challan saves the review like any document, and makes no draft: a challan is not an order, an invoice
-- or a certificate. (Before this, any family that was not an invoice or a certificate was handed to the order-draft maker.)
-- The only change to public.review_document is the new branch: elsif v_fam = 'challan' then null;
-- DRAFT: not applied until the owner says so.

create or replace function public.review_document(p_doc uuid, p_decision text, p_final jsonb, p_changes jsonb, p_note text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d public.documents; v_draft uuid; v_fam text := coalesce(p_final->>'family', 'po');
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
  if p_decision <> 'rejected' and p_final is not null then
    if v_fam = 'invoice' then v_draft := app.make_invoice_draft(p_doc, p_final);
    elsif v_fam = 'mtc' then perform app.link_certificate(p_doc, p_final);
    elsif v_fam = 'challan' then null; -- saved as checked; posting it to stock is a separate, later step
    else v_draft := app.make_draft(p_doc, p_final);
    end if;
  end if;
  return v_draft;
end $function$;
