"use server";

import { revalidatePath } from "next/cache";
import { call, userMessage } from "@/lib/db";

export type Result = { ok: true } | { ok: false; error: string };

/** Set a draft aside (it was wrong, or the work was done another way). The reason stays on record. */
export async function dismissDraft(id: string, note: string): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Bad id" };
  try {
    await call(`select public.dismiss_draft($1::uuid, $2)`, [id, note.trim().slice(0, 300)]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/drafts");
  revalidatePath(`/drafts/${id}`);
  return { ok: true };
}
