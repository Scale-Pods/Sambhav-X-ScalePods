"use server";

import { revalidatePath } from "next/cache";
import { call, userMessage } from "@/lib/db";
import { stockList } from "@/lib/queries";
import { mm, num } from "@/lib/format";

export type Plate = { lot_no: number; ident: string; grade: string; size: string; kg: number; pcs: number };
export type CountResult =
  | { ok: true; match_status: "matched" | "discrepancy" | "unmatched"; lot_no: number | null; books_kg: number | null; ident: string; kg: number }
  | { ok: false; error: string };
export type Simple = { ok: true } | { ok: false; error: string };

export async function searchPlates(book: string, term: string): Promise<Plate[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  try {
    const { rows } = await stockList({ q: t, book, all: false, page: 1 }, 8);
    return rows.map((r) => ({
      lot_no: Number(r.lot_no), ident: (r.plate_no ?? r.heat_no) as string, grade: r.grade,
      size: `${mm(r.thk)} × ${mm(r.wid)} × ${mm(r.len)}`, kg: num(r.kg), pcs: num(r.pcs),
    }));
  } catch {
    return [];
  }
}

export async function recordCountLine(sessionId: string, ident: string, kg: number, pcs: number, yard: string): Promise<CountResult> {
  if (!Number.isFinite(kg) || kg < 0 || !Number.isInteger(pcs) || pcs < 0) return { ok: false, error: "Check the weight and pieces." };
  try {
    const rows = await call<{ r: { match_status: "matched" | "discrepancy" | "unmatched"; lot_no: number | null; books_kg: number | null } }>(
      "select public.record_count_line($1::uuid, $2, $3::numeric, $4::int, $5) as r", [sessionId, ident, kg, pcs, yard]);
    revalidatePath("/count");
    const r = rows[0].r;
    return { ok: true, match_status: r.match_status, lot_no: r.lot_no, books_kg: r.books_kg, ident, kg };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function rejectCountLine(lineId: string): Promise<Simple> {
  try {
    await call("select public.reject_count_line($1::uuid)", [lineId]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/count");
  return { ok: true };
}

export async function startCount(book: string, name: string): Promise<Simple> {
  try {
    await call("select public.start_count_session($1, $2)", [book, name]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/count");
  return { ok: true };
}

export async function closeCount(sessionId: string): Promise<Simple> {
  try {
    await call("select public.close_count_session($1::uuid)", [sessionId]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/count");
  return { ok: true };
}

export type MoveResult = { ok: true; status: "active" | "needs_plate"; ident: string } | { ok: false; error: string };

/** Log a plate that moved while the count is open. `occurredAt` is the local date-time typed in the yard (India time). */
export async function recordWindowMove(sessionId: string, ident: string, direction: "in" | "out", kg: number, pcs: number,
  occurredAt: string, reference: string, note: string): Promise<MoveResult> {
  if (!Number.isFinite(kg) || kg <= 0 || !Number.isInteger(pcs) || pcs < 0) return { ok: false, error: "Check the weight and pieces." };
  if (direction !== "in" && direction !== "out") return { ok: false, error: "Choose in or out." };
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occurredAt) ? `${occurredAt}:00+05:30` : null;
  try {
    const rows = await call<{ r: { status: "active" | "needs_plate" } }>(
      "select public.record_window_movement($1::uuid, $2, $3, $4::numeric, $5::int, $6::timestamptz, $7, $8) as r",
      [sessionId, ident, direction, kg, pcs, at, reference || null, note || null]);
    revalidatePath("/count");
    return { ok: true, status: rows[0].r.status, ident };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function rejectWindowMove(id: string): Promise<Simple> {
  try {
    await call("select public.reject_window_movement($1::uuid)", [id]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/count");
  return { ok: true };
}


/** Send the closed count for approval: one request per plate that differs. Owner or administrator only. */
export async function postCount(sessionId: string): Promise<Simple> {
  try {
    await call("select public.post_count_session($1::uuid)", [sessionId]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/count");
  return { ok: true };
}

/** Decide one difference. `adjustKg` approves a different amount than the one proposed (recorded as a correction). */
export async function decideAdjustment(id: string, decision: "approved" | "rejected", note: string, adjustKg?: number): Promise<Simple> {
  const n = note.trim().slice(0, 300);
  try {
    if (decision === "approved" && adjustKg != null && Number.isFinite(adjustKg)) {
      await call(
        `select public.decide_approval($1::uuid, 'corrected', (select proposed || jsonb_build_object('adjust_kg', $2::numeric) from public.approval_requests where id = $1::uuid), $3)`,
        [id, adjustKg, n || null]);
    } else {
      await call("select public.decide_approval($1::uuid, $2::public.approval_status, null, $3)", [id, decision, n || null]);
    }
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/count");
  return { ok: true };
}

/** Decide every pending difference of one kind in this count, one by one. Stops at the first error and says how far it got. */
export async function decideGroup(sessionId: string, outcome: "short" | "excess" | "missing", decision: "approved" | "rejected", note: string): Promise<Simple & { done?: number }> {
  if (!["short", "excess", "missing"].includes(outcome)) return { ok: false, error: "Unknown group." };
  const n = note.trim().slice(0, 300);
  let done = 0;
  try {
    const ids = await call<{ id: string }>(
      `select id from public.approval_requests where batch_id = $1::uuid and kind = 'count_posting' and status = 'pending' and proposed->>'outcome' = $2`, [sessionId, outcome]);
    for (const r of ids) {
      await call("select public.decide_approval($1::uuid, $2::public.approval_status, null, $3)", [r.id, decision, n || null]);
      done++;
    }
  } catch (e) {
    revalidatePath("/count");
    return { ok: false, error: `${userMessage(e)} (${done} decided before this stopped)`, done };
  }
  revalidatePath("/count");
  return { ok: true, done };
}
