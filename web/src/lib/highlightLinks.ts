import "server-only";
import { q } from "./db";
import { buildHl, type Tone } from "./highlight";

// Links to the stock sheet with the rows a change touched marked: green for what was added, red for what was taken out.
// Used right after a stock change (a mill mail approved, a challan posted or taken back) and wherever the app points at a plate.

const SHOW = "/sheets/stock/show";
const link = (moves: { seq: number; tone: Tone }[], lots: number[] = []) => {
  const hl = buildHl(moves, lots);
  return hl ? `${SHOW}?hl=${hl}` : null;
};

/** The sheet link for a dispatch just posted: its sales in red; a line only recorded (nothing moved) shows its plate in blue. */
export async function postedLink(dispatchId: string): Promise<string | null> {
  const moves = await q<{ seq: string }>(
    `select m.seq::text from public.stock_movements m join public.dispatch_lines dl on dl.id = m.dispatch_line_id
     where dl.dispatch_id = $1 and m.movement_type = 'sale' order by m.seq`, [dispatchId]);
  const rec = await q<{ lot_no: string }>(
    `select distinct l.lot_no::text from public.dispatch_lines dl join public.lots l on l.id = dl.lot_id
     where dl.dispatch_id = $1 and not exists (select 1 from public.stock_movements m where m.dispatch_line_id = dl.id)`, [dispatchId]);
  return link(moves.map((m) => ({ seq: Number(m.seq), tone: "del" as const })), rec.map((r) => Number(r.lot_no)));
}

/** The sheet link for a posting just taken back: the reversals, in green (the stock came back). */
export async function unpostedLink(dispatchId: string): Promise<string | null> {
  const moves = await q<{ seq: string }>(
    `select m.seq::text from public.stock_movements m join public.dispatch_lines dl on dl.id = m.dispatch_line_id
     where dl.dispatch_id = $1 and m.movement_type = 'reversal' order by m.seq`, [dispatchId]);
  return link(moves.map((m) => ({ seq: Number(m.seq), tone: "add" as const })));
}

/** The sheet link for the plates a mill mail just added: their receipts, in green. */
export async function receivedLink(receiptId: string): Promise<string | null> {
  const moves = await q<{ seq: string }>(
    `select m.seq::text from public.stock_movements m join public.mill_receipt_lines x on x.lot_id = m.lot_id
     where x.receipt_id = $1 and m.movement_type = 'receipt' order by m.seq`, [receiptId]);
  return link(moves.map((m) => ({ seq: Number(m.seq), tone: "add" as const })));
}

/** The sheet link that shows one plate (all of its rows, blue). */
export const plateSheetLink = (lotNo: number) => `${SHOW}?hl=l${lotNo}`;
