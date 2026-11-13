import Link from "next/link";
import { ArrowLeft, ChevronRight, ExternalLink, FileText, Paperclip, Search, Star } from "lucide-react";
import { Card } from "@/components/ui";
import { GmailLogo } from "@/components/GmailLogo";
import { canDecide, canUploadDocs } from "@/lib/auth";
import type { CtxMsg } from "@/lib/mail/compose";
import { LABELS, canWrite, draftOfThread, getThread, isLabelKey, listThreads, liveMailboxes, unreadCounts, PER_PAGE, type Addr, type LabelKey, type MailMessage, type MailThread, type ThreadRow } from "@/lib/mail/live";
import { InboxShell, type RailItem } from "../inbox/InboxShell";
import { ComposeButton, ComposeHost } from "./Composer";
import { LiveMailboxSelect } from "./LiveMailboxSelect";
import { MailActions } from "./MailActions";
import { MessageBody } from "./MessageBody";

const IST = "Asia/Kolkata";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
/** Today: the time. This year: "12 Nov". Earlier: "12/11/25" (India time, as in Gmail). */
function short(iso: string): string {
  const d = new Date(iso), now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { ...o, timeZone: IST }).format(d);
  if (dayKey(d) === dayKey(now)) return fmt({ hour: "numeric", minute: "2-digit", hour12: true });
  if (dayKey(d).slice(0, 4) === dayKey(now).slice(0, 4)) return fmt({ day: "numeric", month: "short" });
  return fmt({ day: "2-digit", month: "2-digit", year: "2-digit" });
}
const full = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST }).format(new Date(iso));
const size = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

const HUES = ["bg-brand-soft text-brand", "bg-ok-soft text-ok", "bg-warn-soft text-warn", "bg-info-soft text-brand-dark", "bg-bad-soft text-bad"];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const Avatar = ({ name, big }: { name: string; big?: boolean }) => <span className={`inline-flex ${big ? "h-10 w-10" : "h-9 w-9"} shrink-0 items-center justify-center rounded-full text-[0.85rem] font-semibold ${hue(name)}`}>{(name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1) || "?").toUpperCase()}</span>;
const who = (a: Addr) => (a.name && a.name !== a.addr ? `${a.name}` : a.addr);
const people = (l: Addr[]) => l.map((a) => (a.name && a.name !== a.addr ? `${a.name} <${a.addr}>` : a.addr)).join(", ");

type SP = Record<string, string | undefined>;

/** The Mailbox page: a connected Gmail mailbox read live, laid out like Gmail (labels, conversations, the reading pane). */
const ctx = (m: MailMessage): CtxMsg => ({ id: m.id, from: m.from, replyTo: m.replyTo, to: m.to, cc: m.cc, at: m.at, subject: m.subject, html: m.html, text: m.text, messageId: m.messageId, references: m.references, attachments: m.attachments.length });

export async function MailboxView({ sp, admin, role, path = "/mail/mailbox" }: { sp: SP; admin: boolean; role?: string; path?: string }) {
  const boxes = await liveMailboxes();
  if (boxes.length === 0) {
    return (
      <Card><div className="px-5 py-12 text-center text-[0.95rem] text-muted">
        <p>No mailbox is connected yet.</p>
        {admin ? <a href="/api/mail/google/connect" className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Connect a Gmail mailbox</a> : <p className="mt-1">Ask an administrator to connect one.</p>}
      </div></Card>
    );
  }
  const box = boxes.find((b) => b.id === sp.mb) ?? boxes[0];
  const label: LabelKey = isLabelKey(sp.label) ? sp.label : "inbox";
  const q = (sp.q ?? "").trim().slice(0, 120);
  const pt = sp.pt && /^[A-Za-z0-9_-]{4,300}$/.test(sp.pt) ? sp.pt : null;
  const sel = sp.t && /^[0-9a-f]{8,40}$/i.test(sp.t) ? sp.t : null;

  const href = (o: Record<string, string | null>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ mb: box.id, label: label === "inbox" ? null : label, q: q || null, pt, t: sel, ...o })) if (v) u.set(k, v);
    return `${path}?${u}`;
  };

  let error: string | null = null;
  let rows: ThreadRow[] = [], next: string | null = null;
  let counts = { inbox: 0, drafts: 0 };
  let thread: MailThread | null = null;
  let tokenWrites = false;
  try {
    const [list, c, t, w] = await Promise.all([listThreads(box.id, label, q, pt), unreadCounts(box.id), sel ? getThread(box.id, sel, box.address).catch(() => null) : Promise.resolve(null), canWrite(box.id).catch(() => false)]);
    rows = list.rows; next = list.next; counts = c; thread = t; tokenWrites = w;
  } catch (e) {
    error = e instanceof Error ? e.message : "Gmail could not be reached.";
  }

  // writing and organising: the mailbox's login must hold the permission, and so must the person's role (sending needs an approver)
  const writable = tokenWrites && canUploadDocs(role);
  const canSend = canDecide(role);
  const msgs = thread?.messages ?? [];
  const lastMsg = [...msgs].reverse().find((m) => !m.isDraft) ?? null;
  const draftMsg = [...msgs].reverse().find((m) => m.isDraft) ?? null;
  const draftId = writable && thread && draftMsg ? await draftOfThread(box.id, thread.id).catch(() => null) : null;
  const flag = (l: string) => msgs.some((m) => m.labels.includes(l));

  const gmailLink = (id: string) => `https://mail.google.com/mail/u/${encodeURIComponent(box.address)}/#all/${id}`;

  const toolbar = (
    <>
      <ComposeButton mb={box.id} address={box.address} disabled={!writable} why={tokenWrites ? "Your login may read mail but not write it" : "This mailbox is connected read-only: an administrator must connect it again"} />
      <LiveMailboxSelect value={box.id} options={boxes.map((b) => ({ value: b.id, label: b.address }))} canAdd={admin} />
      <form action={path} className="relative min-w-60 flex-1">
        <input type="hidden" name="mb" value={box.id} />
        {label !== "inbox" && <input type="hidden" name="label" value={label} />}
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input name="q" defaultValue={q} placeholder="Search mail (like Gmail: from:name, has:attachment, subject:...)" className="w-full rounded-full border border-line bg-field py-2 pl-9 pr-3 text-[0.92rem]" />
      </form>
      <span className="ml-auto flex items-center gap-2 text-[0.82rem] text-muted">
        {pt && <Link href={href({ pt: null, t: null })} className="hover:text-ink hover:underline">First page</Link>}
        {next && <Link href={href({ pt: next, t: null })} className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 hover:bg-surface hover:text-ink">Older<ChevronRight className="h-4 w-4" /></Link>}
      </span>
    </>
  );

  const items: RailItem[] = LABELS.map((l) => ({
    key: l.key, name: l.name, info: l.name === "Inbox" ? "Unread conversations" : `${l.name} of ${box.address}`,
    count: l.key === "inbox" ? counts.inbox : l.key === "drafts" ? counts.drafts : 0, on: l.key === label, href: href({ label: l.key === "inbox" ? null : l.key, pt: null, t: null }),
  }));

  const list = (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      {error && <p className="px-5 py-10 text-center text-[0.92rem] text-bad">{error.startsWith("Gmail said 4") ? `${error}. The mailbox may need to be connected again (Mailboxes tab).` : error}</p>}
      {!error && rows.length === 0 && <p className="px-5 py-14 text-center text-muted">{q ? `No mail matches “${q}”.` : "Nothing here."}</p>}
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const on = r.id === sel;
          return (
            <li key={r.id}>
              <Link href={href({ t: r.id })} className={"flex gap-3 px-4 py-2.5 hover:bg-surface/70 " + (on ? "bg-brand-soft/60" : r.unread ? "bg-card" : "bg-surface/40")}>
                <Avatar name={r.last.name || r.last.addr} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={"truncate text-[0.9rem] " + (r.unread ? "font-bold" : "font-medium text-muted")}>{r.who}{r.count > 1 && <span className="ml-1 text-[0.78rem] font-normal text-muted">{r.count}</span>}</span>
                    <span className={"shrink-0 text-[0.78rem] " + (r.unread ? "font-bold text-ink" : "text-muted")}>{short(r.at)}</span>
                  </span>
                  <span className={"flex items-center gap-1 truncate text-[0.88rem] " + (r.unread ? "font-semibold" : "")}>{r.starred && <Star className="h-3.5 w-3.5 shrink-0 fill-warn text-warn" />}<span className="truncate">{r.subject}</span></span>
                  <span className="block truncate text-[0.82rem] text-muted">{r.snippet}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[0.76rem] text-muted">{rows.length ? `Showing up to ${PER_PAGE} per page. ` : ""}Read live from {box.address}.</p>
    </div>
  );

  const reader = thread ? (
    <article className="space-y-4">
      <header className="space-y-2 border-b border-line pb-3">
        <Link href={href({ t: null })} className="inline-flex items-center gap-1 text-[0.85rem] text-muted hover:text-ink xl:hidden"><ArrowLeft className="h-4 w-4" /> Back to the list</Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-semibold leading-snug">{thread.subject}</h2>
          <a href={gmailLink(thread.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[0.85rem] font-medium hover:bg-surface"><ExternalLink className="h-4 w-4" />Open in Gmail</a>
        </div>
        <MailActions mb={box.id} address={box.address} threadId={thread.id} last={lastMsg ? ctx(lastMsg) : null} draft={draftMsg ? ctx(draftMsg) : null} draftId={draftId}
          starred={flag("STARRED")} unread={flag("UNREAD")} inInbox={flag("INBOX")} trashed={flag("TRASH")} spam={flag("SPAM")} writable={writable} />
        <p className="flex items-center gap-1.5 text-[0.8rem] text-muted"><GmailLogo className="h-3 w-auto" />{box.address} · {thread.messages.length + thread.hidden} {thread.messages.length + thread.hidden === 1 ? "message" : "messages"}</p>
        {thread.hidden > 0 && <p className="text-[0.82rem] text-muted">The latest {thread.messages.length} are shown. The {thread.hidden} earlier ones are in Gmail: use “Open in Gmail”.</p>}
      </header>
      {thread.messages.map((m) => (
        <section key={m.id} className="space-y-3 rounded-lg border border-line p-4">
          <div className="flex items-start gap-3">
            <Avatar name={m.from.name || m.from.addr} big />
            <div className="min-w-0 flex-1 text-[0.88rem]">
              <p className="truncate">{m.isDraft && <span className="mr-1.5 rounded bg-warn-soft px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase text-warn">Draft</span>}<span className="font-bold">{who(m.from)}</span>{m.from.name && m.from.name !== m.from.addr ? <span className="text-muted"> &lt;{m.from.addr}&gt;</span> : null}</p>
              <p className="truncate text-muted" title={people(m.to)}>to {m.to.length ? m.to.map(who).join(", ") : "—"}</p>
              {m.cc.length > 0 && <p className="truncate text-muted" title={people(m.cc)}>cc {m.cc.map(who).join(", ")}</p>}
            </div>
            <p className="shrink-0 text-[0.8rem] text-muted">{full(m.at)}</p>
          </div>
          <MessageBody html={m.html} text={m.text} />
          {m.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2 border-t border-line pt-3">
              {m.attachments.map((a, i) => {
                const url = `/api/mail/attachment?${new URLSearchParams({ mb: box.id, m: m.id, a: a.attachmentId, name: a.name, mime: a.mime, view: "1" })}`;
                return (
                  <li key={i}>
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-xs items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.82rem] hover:border-brand">
                      {/pdf|image/i.test(a.mime) ? <FileText className="h-4 w-4 shrink-0 text-bad" /> : <Paperclip className="h-4 w-4 shrink-0 text-muted" />}<span className="truncate">{a.name}</span><span className="shrink-0 text-muted">{size(a.size)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </article>
  ) : sel && !error ? <p className="text-[0.92rem] text-muted">That conversation could not be opened.</p> : null;

  return (
    <>
      <InboxShell toolbar={toolbar} items={items} admin={admin} list={list} reading={Boolean(reader)}
        reader={reader ?? <p className="flex min-h-48 items-center justify-center text-center text-[0.92rem] text-muted">Select a conversation to read it.</p>} />
      <ComposeHost canSend={canSend} />
    </>
  );
}
