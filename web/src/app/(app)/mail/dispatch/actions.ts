"use server";

import { revalidatePath } from "next/cache";
import { canDecide, canExport, currentStaff } from "@/lib/auth";
import { call, serviceQuery, userMessage } from "@/lib/db";
import { syncAll } from "@/lib/mill/sync";

export type Result = { ok: true; message: string } | { ok: false; error: string };
const UUID = /^[0-9a-f-]{36}$/i;

/** Look in the connected mailboxes now, without waiting for the 15-minute round. Administrators only. */
export async function syncNow(): Promise<Result> {
  const me = await currentStaff().catch(() => null);
  if (!me || !canExport(me.role)) return { ok: false, error: "Only the owner or an administrator may do this." };
  try {
    const results = await syncAll();
    if (results.length === 0) return { ok: false, error: "No mailbox is connected yet." };
    revalidatePath("/mail/dispatch"); revalidatePath("/mail/inbox"); revalidatePath("/mail/mailboxes");
    const bad = results.find((r) => r.error);
    if (bad) return { ok: false, error: `${bad.address}: ${bad.error}` };
    const n = results.reduce((a, r) => a + r.suggestions, 0), mails = results.reduce((a, r) => a + r.new_mails, 0);
    return { ok: true, message: mails === 0 ? "Looked in the mailbox: nothing new." : `${mails} new mail${mails === 1 ? "" : "s"} read, ${n} waiting for your approval.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "The mailbox could not be read." };
  }
}

/** Remove the app's access to a mailbox (the stored login is deleted; the mails already picked up stay). */
export async function disconnectMailbox(mailboxId: string): Promise<Result> {
  const me = await currentStaff().catch(() => null);
  if (!me || !canExport(me.role)) return { ok: false, error: "Only the owner or an administrator may do this." };
  if (!UUID.test(mailboxId)) return { ok: false, error: "Bad id" };
  await serviceQuery(`delete from public.mailbox_tokens where mailbox_id = $1`, [mailboxId]);
  revalidatePath("/mail/dispatch"); revalidatePath("/mail/inbox"); revalidatePath("/mail/mailboxes");
  return { ok: true, message: "Disconnected. You can also remove the app's access in your Google account." };
}

/** Add the plates of a suggestion to stock. The database function checks the role, the grade and the stock book, and adds each mill invoice item once. */
export async function approveReceipt(id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "Bad id" };
  const me = await currentStaff().catch(() => null);
  if (!me || !canDecide(me.role)) return { ok: false, error: "Only an approver, an administrator or the owner may add stock from a mail." };
  try {
    const [r] = await call<{ r: { added: number; already_received: number } }>(`select public.mill_receipt_approve($1::uuid) r`, [id]);
    revalidatePath("/mail/dispatch"); revalidatePath("/mail/inbox"); revalidatePath("/mail/mailboxes");
    revalidatePath("/plates");
    revalidatePath("/summary");
    return { ok: true, message: `${r.r.added} plate${r.r.added === 1 ? "" : "s"} added to stock${r.r.already_received ? `, ${r.r.already_received} already received before` : ""}.` };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function rejectReceipt(id: string, note: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "Bad id" };
  try {
    await call(`select public.mill_receipt_reject($1::uuid, $2)`, [id, note.trim().slice(0, 300)]);
    revalidatePath("/mail/dispatch"); revalidatePath("/mail/inbox"); revalidatePath("/mail/mailboxes");
    return { ok: true, message: "Set aside. No stock was added." };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}
