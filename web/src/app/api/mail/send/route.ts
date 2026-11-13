import { NextResponse, type NextRequest } from "next/server";
import { canDecide, canUploadDocs, currentStaff } from "@/lib/auth";
import { canWrite, deleteDraft, forwardAttachments, liveMailboxes, parseList, saveDraft, sendDraft, sendRaw } from "@/lib/mail/live";
import { buildRaw, htmlToText, type OutAttachment } from "@/lib/mail/mime";
import { recordReminder, type ReminderMeta } from "@/lib/reminders";

const UUID = /^[0-9a-f-]{36}$/i;
const ID = /^[0-9a-zA-Z_-]{6,200}$/;
const ADDR = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_FILES_BYTES = 3_800_000; // the host accepts about 4.5 MB per request
const MAX_RECIPIENTS = 50;
const sent = new Map<string, number[]>(); // a person may send 30 mails an hour from here

/** The reminder details the mail window sends along (checked here, never trusted as they come). */
function parseReminder(s: string): ReminderMeta | null {
  try {
    const m = JSON.parse(s) as Partial<ReminderMeta>;
    if (typeof m.party !== "string" || !m.party.trim() || (m.entity !== "SPF" && m.entity !== "SAI") || (m.tone !== "statement" && m.tone !== "firm")) return null;
    if (!Array.isArray(m.invoices) || !Number.isFinite(m.total) || !Number.isFinite(m.count) || !Number.isFinite(m.oldest)) return null;
    return { party: m.party.trim().slice(0, 200), entity: m.entity, tone: m.tone, invoices: m.invoices.map((x) => String(x).slice(0, 60)).slice(0, 200), total: Math.max(0, Number(m.total)), count: Math.max(0, Math.round(Number(m.count))), oldest: Math.max(0, Math.round(Number(m.oldest))) };
  } catch { return null; }
}

const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const field = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
const recipients = (s: string) => parseList(s.replace(/;/g, ","));

/** Write a mail from a connected mailbox: send it, save it as a draft, or throw a draft away. Sending needs an approver, an administrator or the owner; drafts any staff who may change things. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me || !canUploadDocs(me.role)) return fail("Your login may read mail but not write it.", 403);
  let f: FormData;
  try { f = await req.formData(); } catch { return fail("The mail could not be read. It may be too large (attachments up to about 3.5 MB in all)."); }
  const action = field(f, "action");
  const mb = field(f, "mb");
  if (!["send", "draft", "discard"].includes(action) || !UUID.test(mb)) return fail("Bad request");
  const box = (await liveMailboxes()).find((b) => b.id === mb);
  if (!box) return fail("That mailbox is not connected.", 404);
  if (!(await canWrite(mb).catch(() => false))) return fail("This mailbox was connected with read-only access. An administrator must connect it again (Mailboxes tab) to allow sending and drafts.", 409);

  const draftId = field(f, "draftId");
  if (draftId && !ID.test(draftId)) return fail("Bad draft");
  try {
    if (action === "discard") {
      if (draftId) await deleteDraft(mb, draftId);
      return NextResponse.json({ ok: true });
    }
    if (action === "send" && !canDecide(me.role)) return fail("Only an approver, an administrator or the owner may send mail. Save it as a draft and ask one of them.", 403);
    const to = recipients(field(f, "to")), cc = recipients(field(f, "cc")), bcc = recipients(field(f, "bcc"));
    const all = [...to, ...cc, ...bcc];
    if (all.length > MAX_RECIPIENTS) return fail(`Too many recipients (the limit is ${MAX_RECIPIENTS}).`);
    const bad = all.find((a) => !ADDR.test(a.addr));
    if (bad) return fail(`“${bad.addr}” is not a mail address.`);
    if (action === "send" && to.length + cc.length + bcc.length === 0) return fail("Add at least one recipient.");
    const subject = field(f, "subject").slice(0, 300);
    const html = field(f, "html").replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 1_500_000);
    const text = field(f, "text").slice(0, 400_000) || htmlToText(html);
    if (action === "send" && !subject.trim() && !text.trim()) return fail("The mail is empty.");
    if (action === "send") {
      const now = Date.now(), recent = (sent.get(me.id) ?? []).filter((t) => now - t < 3_600_000);
      if (recent.length >= 30) return fail("Thirty mails an hour is the limit from here. Try again later.", 429);
      sent.set(me.id, [...recent, now]);
    }
    const attachments: OutAttachment[] = [];
    let total = 0;
    for (const v of f.getAll("files")) {
      if (typeof v === "string") continue;
      total += v.size;
      if (total > MAX_FILES_BYTES) return fail("The attachments are too large: about 3.5 MB in all.");
      attachments.push({ name: v.name || "attachment", mime: v.type || "application/octet-stream", bytes: Buffer.from(await v.arrayBuffer()) });
    }
    const fwd = field(f, "fwd");
    if (fwd) {
      if (!/^[0-9a-f]{8,40}$/i.test(fwd)) return fail("Bad forward");
      attachments.push(...(await forwardAttachments(mb, fwd, Math.max(0, MAX_FILES_BYTES - total))));
    }
    const threadId = field(f, "threadId");
    const raw = buildRaw({
      from: box.address, to: to.map((a) => a.addr), cc: cc.map((a) => a.addr), bcc: bcc.map((a) => a.addr), subject, html: `<div dir="ltr">${html}</div>`, text,
      inReplyTo: field(f, "inReplyTo") || undefined, references: field(f, "references") || undefined, attachments,
    });
    const tid = ID.test(threadId) ? threadId : undefined;
    if (action === "draft") {
      const d = await saveDraft(mb, raw, tid, draftId || undefined);
      return NextResponse.json({ ok: true, draftId: d.id, threadId: d.message.threadId });
    }
    // a payment reminder that goes out is remembered: who it went to, how much it asked for, which invoices
    const remember = async (s: { id: string; threadId: string }) => {
      const m = parseReminder(field(f, "reminder"));
      if (m) await recordReminder(m, { mailboxId: mb, to: to.map((a) => a.addr).join(", "), cc: cc.map((a) => a.addr).join(", "), subject, messageId: s.id, threadId: s.threadId, staffId: me.id });
    };
    // a draft that is being sent is updated first, so what goes out is what is on the screen
    if (draftId) { await saveDraft(mb, raw, tid, draftId); const s = await sendDraft(mb, draftId); await remember(s); return NextResponse.json({ ok: true, threadId: s.threadId }); }
    const s = await sendRaw(mb, raw, tid);
    await remember(s);
    return NextResponse.json({ ok: true, threadId: s.threadId });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return fail(/Gmail said 403/.test(m) ? "Google did not allow it. The mailbox may need to be connected again (Mailboxes tab)." : "Gmail could not do that. Please try again.", 502);
  }
}
