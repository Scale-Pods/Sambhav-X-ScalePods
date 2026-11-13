"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Forward, Inbox, MailOpen, MailPlus, Reply, ReplyAll, ShieldAlert, Star, Trash2, Undo2 } from "lucide-react";
import { buildInit, draftInit, openCompose, type CtxMsg } from "@/lib/mail/compose";
import { threadAction, type ThreadAction } from "./actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.82rem] font-medium hover:bg-surface disabled:opacity-50";

/** The buttons above a conversation: write (reply, reply to all, forward, edit the draft) and organise (star, mark unread, archive, trash, spam). */
export function MailActions({ mb, address, threadId, last, draft, draftId, starred, unread, inInbox, trashed, spam, writable }: {
  mb: string; address: string; threadId: string; last: CtxMsg | null; draft: CtxMsg | null; draftId: string | null;
  starred: boolean; unread: boolean; inInbox: boolean; trashed: boolean; spam: boolean; writable: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  const act = (a: ThreadAction) => start(async () => { setErr(null); const r = await threadAction(mb, threadId, a); if (r.ok) router.refresh(); else setErr(r.error); });

  // opening a conversation marks it read, as Gmail does
  useEffect(() => {
    if (!writable || !unread || done.current) return;
    done.current = true;
    void threadAction(mb, threadId, "read").then((r) => { if (r.ok) router.refresh(); });
  }, [writable, unread, mb, threadId, router]);

  if (!writable) return <p className="rounded-md bg-warn-soft px-3 py-1.5 text-[0.82rem] text-warn">This mailbox is connected with read-only access, so replying, sending and organising are off. An administrator can connect it again from the Mailboxes tab to allow them.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {last && <>
          <button type="button" className={btn} onClick={() => openCompose(buildInit("reply", mb, address, last, threadId))}><Reply className="h-4 w-4" />Reply</button>
          <button type="button" className={btn} onClick={() => openCompose(buildInit("replyall", mb, address, last, threadId))}><ReplyAll className="h-4 w-4" />Reply all</button>
          <button type="button" className={btn} onClick={() => openCompose(buildInit("forward", mb, address, last, threadId))}><Forward className="h-4 w-4" />Forward</button>
        </>}
        {draft && draftId && <button type="button" className={btn + " border-brand text-brand"} onClick={() => openCompose(draftInit(mb, address, draft, threadId, draftId))}><MailPlus className="h-4 w-4" />Edit draft</button>}
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" disabled={busy} className={btn} onClick={() => act(starred ? "unstar" : "star")} title={starred ? "Remove the star" : "Star"}><Star className={"h-4 w-4 " + (starred ? "fill-warn text-warn" : "")} /></button>
        <button type="button" disabled={busy} className={btn} onClick={() => act(unread ? "read" : "unread")} title={unread ? "Mark as read" : "Mark as unread"}><MailOpen className="h-4 w-4" /></button>
        {inInbox ? <button type="button" disabled={busy} className={btn} onClick={() => act("archive")} title="Archive"><Archive className="h-4 w-4" />Archive</button>
          : !trashed && !spam && <button type="button" disabled={busy} className={btn} onClick={() => act("inbox")} title="Move to the Inbox"><Inbox className="h-4 w-4" />Move to Inbox</button>}
        {trashed ? <button type="button" disabled={busy} className={btn} onClick={() => act("untrash")}><Undo2 className="h-4 w-4" />Restore from Trash</button>
          : <button type="button" disabled={busy} className={btn} onClick={() => { if (window.confirm("Move this conversation to Trash? It stays there for 30 days.")) act("trash"); }} title="Move to Trash"><Trash2 className="h-4 w-4" /></button>}
        {spam ? <button type="button" disabled={busy} className={btn} onClick={() => act("notspam")}>Not spam</button>
          : <button type="button" disabled={busy} className={btn} onClick={() => { if (window.confirm("Report this conversation as spam?")) act("spam"); }} title="Report spam"><ShieldAlert className="h-4 w-4" /></button>}
      </div>
      {err && <p className="text-[0.82rem] text-bad">{err}</p>}
    </div>
  );
}
