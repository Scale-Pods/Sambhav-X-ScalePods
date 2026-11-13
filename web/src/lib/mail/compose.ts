// Preparing a mail to write: who a reply goes to, the subject, the quoted original. Plain code, used by the buttons of the reading pane (no server parts).

export type Addr = { name: string; addr: string };
export type Mode = "new" | "reply" | "replyall" | "forward" | "draft";
export type CtxMsg = {
  id: string; from: Addr; replyTo: Addr[]; to: Addr[]; cc: Addr[]; at: string; subject: string; html: string | null; text: string | null;
  messageId: string | null; references: string | null; attachments: number;
};
export type ComposeInit = {
  mb: string; address: string; mode: Mode; title: string; to: string; cc: string; bcc: string; subject: string; html: string;
  threadId?: string; inReplyTo?: string; references?: string; draftId?: string; fwdMessageId?: string; fwdCount?: number;
  assist?: string; // when set, the AI writes the first text as soon as the window opens (an empty text means "suggest a reply")
  original?: string; // the plain text of the mail being answered, for the AI
  reminder?: { party: string; entity: "SPF" | "SAI"; invoices: string[]; total: number; count: number; oldest: number; tone: "statement" | "firm" }; // set when this mail is a payment reminder: sending it is recorded
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const fmt = (a: Addr) => (a.name && a.name !== a.addr ? `${a.name} <${a.addr}>` : a.addr);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uniq = (l: Addr[]) => l.filter((a, i) => l.findIndex((b) => same(b.addr, a.addr)) === i);
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso)).replace(",", "").replace(/(\d{4}),/, "$1 at");
const prefix = (subject: string, p: "Re" | "Fwd") => (new RegExp(`^\\s*${p}:`, "i").test(subject) ? subject.trim() : `${p}: ${subject.trim() || "(no subject)"}`);
const original = (m: CtxMsg) => m.html ?? `<div style="white-space:pre-wrap">${esc(m.text ?? "")}</div>`;

/** The plain text of a mail, for the AI (what a reply is answering). */
function plain(m: CtxMsg): string {
  if (m.text) return m.text.slice(0, 12000);
  return (m.html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").slice(0, 12000);
}

/** The starting point of a reply, reply to all, or forward of one message, written by the mailbox `address`. */
export function buildInit(mode: "reply" | "replyall" | "forward", mb: string, address: string, m: CtxMsg, threadId: string): ComposeInit {
  const me = (a: Addr) => same(a.addr, address);
  const base = { mb, address, threadId, inReplyTo: m.messageId ?? undefined, references: [m.references, m.messageId].filter(Boolean).join(" ").trim() || undefined, original: plain(m) };
  if (mode === "forward") {
    const head = `<br><br>---------- Forwarded message ---------<br>From: ${esc(fmt(m.from))}<br>Date: ${esc(when(m.at))}<br>Subject: ${esc(m.subject)}<br>To: ${esc(m.to.map(fmt).join(", "))}<br><br>`;
    return { mb, address, mode, title: "Forward", to: "", cc: "", bcc: "", subject: prefix(m.subject, "Fwd"), html: `<p><br></p><div class="mail-quote">${head}${original(m)}</div>`, fwdMessageId: m.id, fwdCount: m.attachments };
  }
  // replying to a message we wrote ourselves goes to the people it was written to
  const sender = me(m.from) ? m.to : m.replyTo.length ? m.replyTo : [m.from];
  const to = uniq(sender.filter((a) => !me(a)));
  const cc = mode === "replyall" ? uniq([...(me(m.from) ? m.cc : [...m.to, ...m.cc])].filter((a) => !me(a) && !to.some((t) => same(t.addr, a.addr)))) : [];
  const quote = `<p><br></p><div class="mail-quote">On ${esc(when(m.at))}, ${esc(fmt(m.from))} wrote:<br><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${original(m)}</blockquote></div>`;
  return { ...base, mb, address, mode, title: mode === "reply" ? "Reply" : "Reply all", to: to.map(fmt).join(", "), cc: cc.map(fmt).join(", "), bcc: "", subject: prefix(m.subject, "Re"), html: quote };
}

/** Opening a draft again for editing. */
export function draftInit(mb: string, address: string, m: CtxMsg, threadId: string, draftId: string): ComposeInit {
  const refs = (m.references ?? "").trim();
  return { mb, address, mode: "draft", title: "Draft", to: m.to.map(fmt).join(", "), cc: m.cc.map(fmt).join(", "), bcc: "", subject: m.subject, html: original(m), threadId, draftId, references: refs || undefined, inReplyTo: refs ? refs.split(/\s+/).pop() : undefined };
}

export const COMPOSE_EVENT = "mail-compose";
export const openCompose = (init: ComposeInit) => window.dispatchEvent(new CustomEvent<ComposeInit>(COMPOSE_EVENT, { detail: init }));
