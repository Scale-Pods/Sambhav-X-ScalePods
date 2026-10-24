"use server";

import { revalidatePath } from "next/cache";
import { call, userMessage } from "@/lib/db";

export type Result = { ok: true } | { ok: false; error: string };

/** "Sync now": the program on the Tally PC checks every 5 minutes and runs a sync when it finds this request. */
export async function requestTallySync(): Promise<Result> {
  try {
    await call("select public.tally_request_sync()");
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/tally");
  return { ok: true };
}
