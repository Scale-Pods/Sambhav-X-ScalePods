import "server-only";
import { q } from "./db";

// Drafts: a confirmed customer order or enquiry, kept for a person to work from (migration 33). Read-only here; writes are the database functions.

export type DraftRow = {
  id: string; kind: "order" | "quotation"; status: string; customer_name: string | null; customer_gstin: string | null; tally_ledger: string | null;
  po_no: string | null; doc_no: string | null; doc_date: string | null; total_amount: number | null; created_at: string; created_by: string | null;
  document_id: string; file: string; lines: number;
};
export const DRAFT_SHOWS = ["open", "dismissed", "all"] as const;
export type DraftShow = (typeof DRAFT_SHOWS)[number];

export async function draftsList(show: DraftShow) {
  const where = show === "all" ? "true" : `d.status = '${show}'`;
  return q<DraftRow>(`
    select d.id, d.kind::text kind, d.status, d.customer_name, d.customer_gstin, d.tally_ledger, d.po_no, d.doc_no, d.doc_date::text doc_date, d.total_amount::float8 total_amount,
           d.created_at, s.full_name created_by, d.document_id, doc.original_filename file, (select count(*)::int from public.draft_lines l where l.draft_id = d.id) lines
      from public.drafts d join public.documents doc on doc.id = d.document_id left join public.staff s on s.id = d.created_by
     where ${where} order by d.created_at desc limit 200`);
}

export type DraftLine = {
  line_no: number; description: string | null; grade_raw: string | null; grade: string | null; thickness_mm: number | null; width_mm: number | null; length_mm: number | null;
  quantity: number | null; unit_code: string | null; weight_kg: number | null; rate: number | null; rate_unit: string | null; amount: number | null;
};
export type DraftDetail = DraftRow & { delivery_terms: string | null; payment_terms: string | null; close_note: string | null; closed_at: string | null; closed_by: string | null; items: DraftLine[] };

export async function draftDetail(id: string): Promise<DraftDetail | null> {
  const [d] = await q<Omit<DraftDetail, "items">>(`
    select d.id, d.kind::text kind, d.status, d.customer_name, d.customer_gstin, d.tally_ledger, d.po_no, d.doc_no, d.doc_date::text doc_date, d.total_amount::float8 total_amount,
           d.created_at, s.full_name created_by, d.document_id, doc.original_filename file, 0 lines, d.delivery_terms, d.payment_terms, d.close_note, d.closed_at, c.full_name closed_by
      from public.drafts d join public.documents doc on doc.id = d.document_id left join public.staff s on s.id = d.created_by left join public.staff c on c.id = d.closed_by
     where d.id = $1::uuid`, [id]);
  if (!d) return null;
  const items = await q<DraftLine>(`
    select l.line_no, l.description, l.grade_raw, g.code grade, l.thickness_mm::float8, l.width_mm::float8, l.length_mm::float8, l.quantity::float8, l.unit_code,
           l.weight_kg::float8, l.rate::float8, l.rate_unit, l.amount::float8
      from public.draft_lines l left join public.grades g on g.id = l.grade_id where l.draft_id = $1::uuid order by l.line_no`, [id]);
  return { ...d, lines: items.length, items };
}

/** The draft made from a document, if any (for the link on the document page). */
export async function draftOfDocument(documentId: string) {
  const r = await q<{ id: string; kind: string; status: string }>(`select id, kind::text kind, status from public.drafts where document_id = $1::uuid`, [documentId]);
  return r[0] ?? null;
}
