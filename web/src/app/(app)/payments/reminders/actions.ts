"use server";

import { canUploadDocs, currentStaff } from "@/lib/auth";
import { findThreadTarget, liveMailboxes } from "@/lib/mail/live";

export type Target = { threadId: string; inReplyTo: string | null; references: string | null } | null;

/** Finds the old conversation (by its subject) in the sending mailbox, so a reminder can be sent into it as a reply. */
export async function locateThread(mb: string, subject: string): Promise<Target> {
  const me = await currentStaff().catch(() => null);
  if (!me || !canUploadDocs(me.role) || !/^[0-9a-f-]{36}$/i.test(mb)) return null;
  if (!(await liveMailboxes()).some((b) => b.id === mb)) return null;
  try { return await findThreadTarget(mb, subject.slice(0, 300)); } catch { return null; }
}
