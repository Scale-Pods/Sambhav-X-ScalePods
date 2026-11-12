import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Inbox as InboxIcon, Search } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { MailboxFilter } from "@/components/MailboxFilter";
import { canDecide, currentStaff } from "@/lib/auth";
import { LABELS, PER_PAGE, inboxFeed, isLabel, trackerMail, type FeedItem, type Label } from "@/lib/mailFeed";
import { mailScope, TRACKER_ADDRESS } from "@/lib/mailboxes";
import { dispatchContext, receiptOfMail } from "@/lib/mill/view";
import { ReceiptCard } from "../dispatch/ReceiptCard";

export const metadata = { title: "Inbox · Sambhav Stock" };
type SP = Promise<Record<string, string | undefined>>;

export default function InboxPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

// ---------------------------------------------------------------- small helpers, in Gmail's manner
const IST = "Asia/Kolkata";
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
/** Today: the time. This year: "12 Nov". Earlier: "12/11/25". The time stamps here are India time already. */
function short(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + "Z"); // the copy and the dispatch mails both hold India wall-clock time, so it is read as it is written
  const shown = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { ...o, timeZone: "UTC" }).format(d);
  const today = ymd(new Date()), same = iso.slice(0, 10) === today;
  if (same) return shown({ hour: "numeric", minute: "2-digit", hour12: true });
  if (iso.slice(0, 4) === today.slice(0, 4)) return shown({ day: "numeric", month: "short" });
  return shown({ day: "2-digit", month: "2-digit", year: "2-digit" });
}
function full(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + "Z");
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(d);
}
const initial = (s: string | null) => (s ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
const HUES = ["bg-brand-soft text-brand", "bg-ok-soft text-ok", "bg-warn-soft text-warn", "bg-info-soft text-brand-dark", "bg-bad-soft text-bad"];
const hue = (s: string | null) => HUES[[...(s ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const Avatar = ({ name, size = "h-9 w-9" }: { name: string | null; size?: string }) => <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full text-[0.85rem] font-semibold ${hue(name)}`}>{initial(name)}</span>;

function StatusChip({ it }: { it: FeedItem }) {
  if (it.source === "dispatch") return <Badge tone={it.state === "Pending" ? "warning" : "ok"}>Mill dispatch</Badge>;
  if (it.status === "URGENT") return <Badge tone="error">Urgent</Badge>;
  if (it.status === "Follow Up") return <Badge tone="warning">Follow up</Badge>;
  return null;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const me = await currentStaff().catch(() => null);
  const scope = await mailScope(sp.mb);
  const label: Label = isLabel(sp.label) ? sp.label : "inbox";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const feed = await inboxFeed(scope, label, q, Number(sp.page) || 1);
  const sel = sp.m ?? null;

  const href = (o: Record<string, string | null>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ mb: scope.value === "all" ? null : scope.value, label: label === "inbox" ? null : label, q: q || null, page: feed.page > 1 ? String(feed.page) : null, m: sel, ...o })) if (v) u.set(k, v);
    return `/mail/inbox${u.toString() ? "?" + u : ""}`;
  };

  // the mail on the right
  let reader: React.ReactNode = null;
  if (sel?.startsWith("d:")) {
    const r = await receiptOfMail(sel.slice(2));
    const ctx = r ? await dispatchContext([r]) : null;
    const item = feed.items.find((i) => i.key === sel);
    reader = (
      <article className="space-y-4">
        <Header subject={r?.subject ?? item?.subject ?? "Dispatch details"} chips={<Badge tone="warning">Mill dispatch</Badge>} name={r?.from_name ?? r?.from_addr ?? item?.from_name ?? null} addr={r?.from_addr ?? item?.from_addr ?? null} to={r?.mailbox ?? null} at={item?.at ?? null} back={href({ m: null })} />
        {r && ctx ? <ReceiptCard r={r} ctx={ctx} canDecide={canDecide(me?.role)} showHeader={false} /> : <p className="text-[0.92rem] text-muted">No dispatch table was found in this mail. Send it again with the table attached as an HTML or text file, or pasted into the mail body.</p>}
      </article>
    );
  } else if (sel?.startsWith("t:")) {
    const m = await trackerMail(sel);
    if (m) {
      const link = m.gmail_url && /^https?:\/\//i.test(m.gmail_url) ? m.gmail_url : m.thread_id ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.thread_id)}` : null;
      reader = (
        <article className="space-y-4">
          <Header subject={m.subject ?? "(no subject)"} chips={<>{m.status === "URGENT" ? <Badge tone="error">Urgent</Badge> : m.status === "Follow Up" ? <Badge tone="warning">Follow up</Badge> : m.status ? <Badge>{m.status}</Badge> : null}<Badge tone={m.state === "Pending" ? "warning" : "neutral"}>{m.state === "Pending" ? "Waiting for a reply" : m.state === "Done" ? "Replied" : "Ignored"}</Badge></>}
            name={m.from_name ?? m.from_email} addr={m.from_email} to={TRACKER_ADDRESS} at={m.received_at} back={href({ m: null })} />
          <dl className="grid max-w-xl grid-cols-[8rem_1fr] gap-x-4 gap-y-2 rounded-lg border border-line bg-surface/50 px-4 py-3 text-[0.9rem]">
            <dt className="text-muted">Waiting</dt><dd>{m.days != null ? `${Math.round(Number(m.days))} day${Math.round(Number(m.days)) === 1 ? "" : "s"}` : "—"}</dd>
            <dt className="text-muted">Status in the tracker</dt><dd>{m.status ?? "—"}</dd>
            <dt className="text-muted">Remarks</dt><dd className="whitespace-pre-wrap">{m.remarks || "—"}</dd>
            {m.moved_at && <><dt className="text-muted">Moved on</dt><dd>{full(m.moved_at)}</dd></>}
          </dl>
          <p className="text-[0.85rem] text-muted">The Email Tracker sheet keeps the subject, sender, date, status and remarks, not the mail text. Open the mail in Gmail to read it or reply.</p>
          {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"><ExternalLink className="h-4 w-4" />Open in Gmail</a>}
        </article>
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MailboxFilter mb={sp.mb} />
        <form action="/mail/inbox" className="relative min-w-60 flex-1">
          {scope.value !== "all" && <input type="hidden" name="mb" value={scope.value} />}
          {label !== "inbox" && <input type="hidden" name="label" value={label} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search mail" className="w-full rounded-full border border-line bg-field py-2 pl-9 pr-3 text-[0.92rem]" />
        </form>
        <span className="ml-auto text-[0.82rem] text-muted">{feed.total ? `${(feed.page - 1) * PER_PAGE + 1}–${Math.min(feed.total, feed.page * PER_PAGE)} of ${feed.total.toLocaleString("en-IN")}` : "0 mails"}</span>
        <div className="flex">
          {feed.page > 1 ? <Link href={href({ page: feed.page > 2 ? String(feed.page - 1) : null, m: null })} className="rounded-full p-1.5 hover:bg-surface" aria-label="Newer"><ChevronLeft className="h-5 w-5" /></Link> : <span className="p-1.5 opacity-30"><ChevronLeft className="h-5 w-5" /></span>}
          {feed.page < feed.pages ? <Link href={href({ page: String(feed.page + 1), m: null })} className="rounded-full p-1.5 hover:bg-surface" aria-label="Older"><ChevronRight className="h-5 w-5" /></Link> : <span className="p-1.5 opacity-30"><ChevronRight className="h-5 w-5" /></span>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[12.5rem_minmax(0,27rem)_minmax(0,1fr)]">
        {/* labels, like Gmail's left side */}
        <nav aria-label="Mail labels" className={"flex gap-1 overflow-x-auto xl:flex-col xl:overflow-visible " + (sel ? "hidden xl:flex" : "")}>
          {scope.admin && <a href="/api/mail/google/connect" className="mb-1 hidden items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-[0.9rem] font-semibold text-brand hover:bg-brand hover:text-white xl:flex"><span className="text-lg leading-none">+</span> Add mailbox</a>}
          {LABELS.map((l) => {
            const n = feed.counts[l.key], on = l.key === label;
            return (
              <Link key={l.key} href={href({ label: l.key === "inbox" ? null : l.key, page: null, m: null })} title={l.info} aria-current={on ? "page" : undefined}
                className={"flex shrink-0 items-center justify-between gap-6 whitespace-nowrap rounded-full px-4 py-1.5 text-[0.9rem] " + (on ? "bg-brand-soft font-bold text-brand" : "text-ink hover:bg-surface")}>
                <span className="flex items-center gap-2">{l.key === "inbox" && <InboxIcon className="h-4 w-4" />}{l.name}</span>
                {n > 0 && <span className={"text-[0.78rem] " + (on ? "font-bold" : "text-muted")}>{n.toLocaleString("en-IN")}</span>}
              </Link>
            );
          })}
        </nav>

        {/* the list */}
        <section aria-label="Mails" className={(sel ? "hidden xl:block" : "block")}>
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            {feed.items.length === 0 && <p className="px-5 py-14 text-center text-muted">{q ? `No mail matches “${q}”.` : label === "dispatch" ? "No dispatch mail has been read yet." : "Nothing here."}</p>}
            <ul className="divide-y divide-line">
              {feed.items.map((it) => {
                const on = it.key === sel, unread = it.state === "Pending";
                return (
                  <li key={it.key}>
                    <Link href={href({ m: it.key })} className={"flex gap-3 px-4 py-2.5 hover:bg-surface/70 " + (on ? "bg-brand-soft/60" : unread ? "bg-card" : "bg-surface/40")}>
                      <Avatar name={it.from_name ?? it.from_addr} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={"truncate text-[0.9rem] " + (unread ? "font-bold" : "font-medium text-muted")}>{it.from_name ?? it.from_addr ?? "(unknown)"}</span>
                          <span className={"shrink-0 text-[0.78rem] " + (unread ? "font-bold text-ink" : "text-muted")}>{short(it.at)}</span>
                        </span>
                        <span className={"block truncate text-[0.88rem] " + (unread ? "font-semibold" : "")}>{it.subject ?? "(no subject)"}</span>
                        <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[0.82rem] text-muted">{it.preview ?? ""}</span><StatusChip it={it} /></span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* the mail being read */}
        <section aria-label="Reading pane" className={"min-w-0 rounded-xl border border-line bg-card px-5 py-5 " + (sel ? "block" : "hidden xl:block")}>
          {reader ?? <p className="flex min-h-48 items-center justify-center text-center text-[0.92rem] text-muted">Select a mail to read it.</p>}
        </section>
      </div>
    </div>
  );
}

function Header({ subject, chips, name, addr, to, at, back }: { subject: string; chips: React.ReactNode; name: string | null; addr: string | null; to: string | null; at: string | null; back: string }) {
  return (
    <header className="space-y-3 border-b border-line pb-4">
      <Link href={back} className="inline-flex items-center gap-1 text-[0.85rem] text-muted hover:text-ink xl:hidden"><ArrowLeft className="h-4 w-4" /> Back to the list</Link>
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-semibold leading-snug">{subject}</h2>{chips}</div>
      <div className="flex items-start gap-3">
        <Avatar name={name ?? addr} size="h-10 w-10" />
        <div className="min-w-0 flex-1 text-[0.88rem]">
          <p className="truncate"><span className="font-bold">{name ?? addr ?? "(unknown)"}</span>{addr && name && name !== addr ? <span className="text-muted"> &lt;{addr}&gt;</span> : null}</p>
          {to && <p className="truncate text-muted">to {to}</p>}
        </div>
        <p className="shrink-0 text-[0.8rem] text-muted">{full(at)}</p>
      </div>
    </header>
  );
}
