"use server";

import { canUploadDocs, currentStaff } from "@/lib/auth";
import { canWrite, liveMailboxes, modifyThread, trashThread, untrashThread } from "@/lib/mail/live";

export type ThreadAction = "star" | "unstar" | "read" | "unread" | "archive" | "inbox" | "trash" | "untrash" | "spam" | "notspam";
export type Result = { ok: true } | { ok: false; error: string };

/** Star, mark read, archive, trash... a whole conversation of a connected mailbox. Staff who may change things; every change can be undone in Gmail (nothing is deleted for good). */
export async function threadAction(mb: string, threadId: string, action: ThreadAction): Promise<Result> {
  const me = await currentStaff().catch(() => null);
  if (!me || !canUploadDocs(me.role)) return { ok: false, error: "Your login may read mail but not change it." };
  if (!/^[0-9a-f-]{36}$/i.test(mb) || !/^[0-9a-f]{8,40}$/i.test(threadId)) return { ok: false, error: "Bad request" };
  if (!(await liveMailboxes()).some((b) => b.id === mb)) return { ok: false, error: "That mailbox is not connected." };
  try {
    if (!(await canWrite(mb))) return { ok: false, error: "This mailbox was connected with read-only access. An administrator must connect it again (Mailboxes tab)." };
    if (action === "trash") await trashThread(mb, threadId);
    else if (action === "untrash") await untrashThread(mb, threadId);
    else if (action === "star") await modifyThread(mb, threadId, ["STARRED"], []);
    else if (action === "unstar") await modifyThread(mb, threadId, [], ["STARRED"]);
    else if (action === "read") await modifyThread(mb, threadId, [], ["UNREAD"]);
    else if (action === "unread") await modifyThread(mb, threadId, ["UNREAD"], []);
    else if (action === "archive") await modifyThread(mb, threadId, [], ["INBOX"]);
    else if (action === "inbox") await modifyThread(mb, threadId, ["INBOX"], []);
    else if (action === "spam") await modifyThread(mb, threadId, ["SPAM"], ["INBOX"]);
    else if (action === "notspam") await modifyThread(mb, threadId, ["INBOX"], ["SPAM"]);
    else return { ok: false, error: "Unknown action" };
    return { ok: true };
  } catch {
    return { ok: false, error: "Gmail could not do that. Please try again." };
  }
}
