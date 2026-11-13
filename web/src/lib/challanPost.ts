import "server-only";
import { q } from "./db";

export type Posted = { id: string; dispatched_on: string | null; posted_at: string; lines: { lot_no: number | null; heat_no: string | null; pieces: number | null; weight_kg: number | null; note: string | null }[] };

/** The posting made from a challan document (null if none, or if it was taken back). */
export async function postedOf(docId: string): Promise<Posted | null> {
  const d = await q<{ id: string; dispatched_on: string | null; posted_at: string }>(
    `select id, dispatched_on::text, created_at::text posted_at from public.dispatches where slip_document_id = $1::uuid and status <> 'cancelled' limit 1`, [docId]);
  if (!d[0]) return null;
  const lines = await q<Posted["lines"][number]>(
    `select l.lot_no::int lot_no, l.heat_no, dl.pieces, dl.weight_kg::float8 weight_kg, dl.note from public.dispatch_lines dl left join public.lots l on l.id = dl.lot_id where dl.dispatch_id = $1::uuid order by dl.id`, [d[0].id]);
  return { ...d[0], lines };
}
