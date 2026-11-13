import "server-only";
import { serviceQuery } from "../db";
import { unseal } from "./crypto";
import { accessToken, collect, gmail, header, type Message, type Part } from "./google";

// The mailbox view: a connected Gmail mailbox read live, the way Gmail shows it (labels, conversations, search, attachments).
// Nothing is copied into the database: each page asks Gmail. Read-only for now (the permission the app holds is gmail.readonly).

export type Box = { id: string; address: string };

/** The mailboxes connected to the app (active, with a Google login). */
export const liveMailboxes = () =>
  serviceQuery<Box>(`select m.id, m.address from public.mailboxes m join public.mailbox_tokens t on t.mailbox_id = m.id where m.active order by m.address`);

// a mailbox's short-lived access token is kept for most of its life, so a page of 25 conversations does not ask Google for a new login every time
const cache = new Map<string, { token: string; until: number }>();
async function tokenOf(mailboxId: string): Promise<string> {
  const hit = cache.get(mailboxId);
  if (hit && hit.until > Date.now()) return hit.token;
  const [row] = await serviceQuery<{ token_enc: string }>(`select token_enc from public.mailbox_tokens where mailbox_id = $1`, [mailboxId]);
  if (!row) throw new Error("That mailbox is not connected.");
  const token = await accessToken(unseal(row.token_enc));
  cache.set(mailboxId, { token, until: Date.now() + 45 * 60_000 });
  return token;
}
const forget = (mailboxId: string) => cache.delete(mailboxId);

/** Gmail call that logs in again once if the stored access token had expired. */
async function call<T>(mailboxId: string, path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  try {
    return await gmail<T>(await tokenOf(mailboxId), path, params);
  } catch (e) {
    if (e instanceof Error && /Gmail said 401/.test(e.message)) { forget(mailboxId); return gmail<T>(await tokenOf(mailboxId), path, params); }
    throw e;
  }
}

// ---------------------------------------------------------------- labels (the folders of the left column)
export const LABELS = [
  { key: "inbox", name: "Inbox", id: "INBOX", q: "" },
  { key: "starred", name: "Starred", id: "STARRED", q: "" },
  { key: "sent", name: "Sent", id: "SENT", q: "" },
  { key: "drafts", name: "Drafts", id: "DRAFT", q: "" },
  { key: "all", name: "All mail", id: "", q: "-in:spam -in:trash" },
  { key: "spam", name: "Spam", id: "SPAM", q: "" },
  { key: "trash", name: "Trash", id: "TRASH", q: "" },
] as const;
export type LabelKey = (typeof LABELS)[number]["key"];
export const isLabelKey = (v: string | undefined): v is LabelKey => LABELS.some((l) => l.key === v);

export async function unreadCounts(mailboxId: string): Promise<{ inbox: number; drafts: number }> {
  const [inbox, drafts] = await Promise.all([
    call<{ threadsUnread?: number }>(mailboxId, "/labels/INBOX").catch(() => ({ threadsUnread: 0 })),
    call<{ threadsTotal?: number }>(mailboxId, "/labels/DRAFT").catch(() => ({ threadsTotal: 0 })),
  ]);
  return { inbox: inbox.threadsUnread ?? 0, drafts: drafts.threadsTotal ?? 0 };
}

// ---------------------------------------------------------------- addresses
export type Addr = { name: string; addr: string };
export function parseAddr(v: string | null | undefined): Addr {
  const s = (v ?? "").trim();
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].replace(/^["']+|["']+$/g, "").trim() || m[2], addr: m[2].trim() };
  return { name: s, addr: s };
}
export const parseList = (v: string | null | undefined): Addr[] => (v ? v.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(parseAddr).filter((a) => a.addr) : []);

// ---------------------------------------------------------------- the list of conversations
export type ThreadRow = { id: string; subject: string; who: string; last: Addr; snippet: string; at: string; unread: boolean; starred: boolean; count: number };

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export const PER_PAGE = 25;

export async function listThreads(mailboxId: string, label: LabelKey, q: string, pageToken: string | null): Promise<{ rows: ThreadRow[]; next: string | null; estimate: number }> {
  const def = LABELS.find((l) => l.key === label)!;
  const query = [q, def.q].filter(Boolean).join(" ");
  const list = await call<{ threads?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>(mailboxId, "/threads", {
    maxResults: String(PER_PAGE), ...(def.id ? { labelIds: def.id } : {}), ...(query ? { q: query } : {}), ...(pageToken ? { pageToken } : {}),
  });
  const ids = (list.threads ?? []).map((t) => t.id);
  const rows = await pool(ids, 8, async (id): Promise<ThreadRow | null> => {
    try {
      const t = await call<{ messages?: (Message & { labelIds?: string[]; snippet?: string })[] }>(mailboxId, `/threads/${id}`, { format: "metadata", metadataHeaders: ["From", "Subject"] });
      const ms = t.messages ?? [];
      if (ms.length === 0) return null;
      const last = ms[ms.length - 1];
      const names: string[] = [];
      for (const m of ms) { const a = parseAddr(header(m, "From")); const n = (a.name.split(/\s+/)[0] || a.addr).replace(/[<>"]/g, ""); if (n && !names.includes(n)) names.push(n); }
      return {
        id, subject: (header(ms[0], "Subject") ?? "").trim() || "(no subject)", who: names.slice(-3).join(", "), last: parseAddr(header(last, "From")), snippet: (last.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        at: new Date(Number(last.internalDate ?? 0)).toISOString(), unread: ms.some((m) => m.labelIds?.includes("UNREAD")), starred: ms.some((m) => m.labelIds?.includes("STARRED")), count: ms.length,
      };
    } catch { return null; }
  });
  const ok = rows.filter((r): r is ThreadRow => r != null);
  return { rows: ok, next: list.nextPageToken ?? null, estimate: list.resultSizeEstimate ?? ok.length };
}

// ---------------------------------------------------------------- one conversation, in full
export type Attachment = { name: string; mime: string; size: number; attachmentId: string };
export type MailMessage = { id: string; from: Addr; to: Addr[]; cc: Addr[]; at: string; subject: string; html: string | null; text: string | null; attachments: Attachment[]; labels: string[]; messageId: string | null };
export type MailThread = { id: string; subject: string; messages: MailMessage[]; address: string; hidden: number };
const MAX_SHOWN = 25; // a very long conversation shows its latest messages; the rest is one click away in Gmail

const b64std = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/");

type Walked = { attachments: Attachment[]; cids: Map<string, { attachmentId: string; mime: string; size: number }> };
function walk(p: Part, out: Walked = { attachments: [], cids: new Map() }): Walked {
  const mime = (p.mimeType ?? "").toLowerCase();
  const cid = p.headers?.find((h) => h.name.toLowerCase() === "content-id")?.value?.replace(/[<>\s]/g, "");
  if (p.body?.attachmentId) {
    if (cid && mime.startsWith("image/")) out.cids.set(cid.toLowerCase(), { attachmentId: p.body.attachmentId, mime, size: p.body.size ?? 0 });
    else if (p.filename) out.attachments.push({ name: p.filename, mime: mime || "application/octet-stream", size: p.body.size ?? 0, attachmentId: p.body.attachmentId });
  }
  for (const c of p.parts ?? []) walk(c, out);
  return out;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function getThread(mailboxId: string, threadId: string, address: string): Promise<MailThread> {
  const t = await call<{ messages?: (Message & { labelIds?: string[] })[] }>(mailboxId, `/threads/${threadId}`, { format: "full" });
  const messages: MailMessage[] = [];
  const all = t.messages ?? [];
  for (const m of all.slice(-MAX_SHOWN)) {
    const f = collect(m.payload);
    const w = walk(m.payload);
    let html = f.html.length ? f.html.join("\n<hr>\n") : null;
    // pictures that sit inside the mail (cid:) are put in as data, so they show without any outside request
    if (html && w.cids.size) {
      const wanted = [...new Set([...html.matchAll(/cid:([^"'\s)>]+)/gi)].map((x) => decodeURIComponent(x[1]).toLowerCase()))].filter((c) => w.cids.has(c)).slice(0, 12);
      const data = new Map<string, string>();
      await pool(wanted, 4, async (c) => {
        const a = w.cids.get(c)!;
        if (a.size > 900_000) return;
        try { const j = await call<{ data?: string }>(mailboxId, `/messages/${m.id}/attachments/${a.attachmentId}`); if (j.data) data.set(c, `data:${a.mime};base64,${b64std(j.data)}`); } catch { /* the picture just does not show */ }
      });
      html = html.replace(/cid:([^"'\s)>]+)/gi, (all, c: string) => data.get(decodeURIComponent(c).toLowerCase()) ?? all);
    }
    messages.push({
      id: m.id, from: parseAddr(header(m, "From")), to: parseList(header(m, "To")), cc: parseList(header(m, "Cc")),
      at: new Date(Number(m.internalDate ?? 0)).toISOString(), subject: header(m, "Subject") ?? "", html,
      text: f.text.length ? f.text.join("\n\n") : html ? null : (m as { snippet?: string }).snippet ? escHtml((m as { snippet?: string }).snippet!) : null,
      attachments: w.attachments, labels: m.labelIds ?? [], messageId: header(m, "Message-ID") ?? header(m, "Message-Id"),
    });
  }
  const subject = (all[0] ? header(all[0], "Subject") : null)?.trim() || messages[0]?.subject.trim() || "(no subject)";
  return { id: threadId, subject, messages, address, hidden: Math.max(0, all.length - messages.length) };
}

/** The bytes of one attachment, for the download route. */
export async function attachmentBytes(mailboxId: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const j = await call<{ data?: string }>(mailboxId, `/messages/${messageId}/attachments/${attachmentId}`);
  if (!j.data) throw new Error("The attachment is empty.");
  return Buffer.from(b64std(j.data), "base64");
}
