"use server";

import { revalidatePath } from "next/cache";
import { call, userMessage } from "@/lib/db";

export type Result = { ok: true } | { ok: false; error: string };

export async function approveException(id: string, note: string): Promise<Result> {
  try {
    await call("select public.resolve_exception($1::uuid, 'resolved', $2)", [id, note]);
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/review");
  revalidatePath("/");
  return { ok: true };
}
