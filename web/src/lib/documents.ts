import "server-only";
import { q } from "./db";
import type { Check, Read } from "./docreader/checks";

export type DocRow = {
  id: string; original_filename: string; doc_type: string; mime_type: string; size_bytes: number;
  extraction_status: string; review_status: string; duplicate_of: string | null; created_at: string; uploaded_by: string | null;
  kind: string | null; firm: boolean | null; direction: string | null; buyer: string | null; ref: string | null;
  doc_date: string | null; lines: number | null; total: string | null; amber: number | null; usd: number | null; second: boolean | null;
};

export const SHOWS = ["review", "done", "failed", "all"] as const;
export type Show = (typeof SHOWS)[number];

export async function documentsList(show: Show): Promise<DocRow[]> {
  const where =
    show === "review" ? "d.review_status = 'pending' and d.extraction_status in ('pending', 'needs_review') and d.duplicate_of is null"
    : show === "done" ? "d.review_status <> 'pending'"
    : show === "failed" ? "d.extraction_status = 'failed' and d.review_status = 'pending'"
    : "true";
  return q<DocRow>(`
    select d.id, d.original_filename, d.doc_type::text, d.mime_type, d.size_bytes, d.extraction_status, d.review_status, d.duplicate_of,
           d.created_at, s.full_name as uploaded_by,
           d.extracted->>'doc_kind' as kind, (d.extracted->>'is_firm_order')::boolean as firm, d.extracted->>'direction' as direction,
           nullif(d.extracted->>'buyer_name', '') as buyer,
           coalesce(nullif(d.extracted->>'po_number', ''), nullif(d.extracted->>'document_number', '')) as ref,
           nullif(d.extracted->>'po_date', '') as doc_date, jsonb_array_length(coalesce(d.extracted->'lines', '[]')) as lines,
           coalesce(nullif(d.extracted->>'total_amount', ''), nullif(d.extracted->>'net_amount', '')) as total,
           (select count(*) from jsonb_array_elements(coalesce(r.checks, '[]')) c where c->>'level' = 'amber')::int as amber,
           (select sum(usd) from public.extraction_runs x where x.document_id = d.id)::float8 as usd,
           (select count(*) > 1 from public.extraction_runs x where x.document_id = d.id) as second
    from public.documents d
    left join public.staff s on s.id = d.uploaded_by
    left join lateral (select checks from public.extraction_runs x where x.document_id = d.id order by created_at desc limit 1) r on true
    where ${where}
    order by d.created_at desc limit 200`);
}

export type RunRow = { stage: string; model: string; usd: number; seconds: number; input_tokens: number; output_tokens: number; created_at: string };
export type Detail = {
  doc: { id: string; original_filename: string; mime_type: string; storage_path: string; doc_type: string; extraction_status: string; review_status: string;
         duplicate_of: string | null; created_at: string; uploaded_by: string | null; error: string | null; reviewed_by: string | null; reviewed_at: string | null };
  read: Read | null; checks: Check[]; runs: RunRow[];
  review: { decision: string; note: string | null; reviewer: string; reviewed_at: string; changes: { field: string; from: string; to: string }[] } | null;
};

export async function documentDetail(id: string): Promise<Detail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const d = await q<Detail["doc"] & { extracted: (Read & { error?: string }) | null }>(`
    select d.id, d.original_filename, d.mime_type, d.storage_path, d.doc_type::text, d.extraction_status, d.review_status, d.duplicate_of, d.created_at,
           s.full_name as uploaded_by, rv.full_name as reviewed_by, d.reviewed_at, d.extracted, d.extracted->>'error' as error
    from public.documents d left join public.staff s on s.id = d.uploaded_by left join public.staff rv on rv.id = d.reviewed_by where d.id = $1::uuid`, [id]);
  if (!d[0]) return null;
  const runs = await q<RunRow & { checks: Check[] }>(
    `select stage, model, usd::float8 as usd, seconds::float8 as seconds, input_tokens, output_tokens, created_at, checks from public.extraction_runs where document_id = $1::uuid order by created_at`, [id]);
  const rev = await q<NonNullable<Detail["review"]>>(
    `select r.decision, r.note, s.full_name as reviewer, r.reviewed_at, r.changes from public.document_reviews r join public.staff s on s.id = r.reviewer_id where r.document_id = $1::uuid order by r.reviewed_at desc limit 1`, [id]);
  const { extracted, ...doc } = d[0];
  return { doc, read: extracted && !extracted.error ? extracted : null, checks: runs.at(-1)?.checks ?? [], runs, review: rev[0] ?? null };
}
