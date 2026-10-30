import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { loadControl, loadMail, loadNegatives, loadOrders, loadPay, loadStock, loadTallyStatus, type Attention } from "@/lib/business";
import { unitLabel, weight } from "@/lib/filters";
import { rupeesShort } from "@/lib/money";
import { Card, Stat } from "@/components/ui";
import { ago, carry, f0, safe, TileLink, type OverviewProps } from "./shared";

// Where Tally stands, in one word and one line, from what the Tally PC last reported.
export type TallyState = { tone: "ok" | "warn" | "wait"; word: string; line: string };
export function tallyState(s: Awaited<ReturnType<typeof loadTallyStatus>>): TallyState {
  const seen = s.connector?.last_seen_at;
  const okMin = s.connector?.ok_min;
  if (!seen || s.connector?.last_sync_ok_at == null) return { tone: "wait", word: "Waiting", line: "Waiting for the first sync from the Tally PC" };
  if (s.connector?.last_status === "tally_down") return { tone: "warn", word: "Tally off", line: "Tally is not open on the PC" };
  if (okMin != null && okMin > 3 * 1440) return { tone: "warn", word: "Stale", line: `Last good sync ${ago(okMin)}` };
  return { tone: "ok", word: "Connected", line: `Last good sync ${ago(okMin)}` };
}

/** Eight tiles, one per part of the business. Each opens its page. */
export async function Headline({ f, pay, ord, sp }: OverviewProps) {
  return safe("The headline figures", async () => {
    const [k, p, o, m, c, t] = await Promise.all([loadStock(f), loadPay(pay), loadOrders(ord), loadMail(f), loadControl(), loadTallyStatus()]);
    const ts = tallyState(t);
    const waiting = c.decide + c.docs_review + c.drafts;
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TileLink href={carry(sp, "/stock", {}, ["p", "from", "to"])}><Stat label="Stock" value={weight(k.stock, f.unit)} unit={unitLabel(f.unit)} sub={`${f0.format(k.plates)} plates with material left`} /></TileLink>
        <TileLink href={carry(sp, "/payments/receivables")}><Stat label="Customers owe us" value={rupeesShort(p.rec.total)} sub={`${rupeesShort(p.rec.overdue)} past the due date`} tone="accent" /></TileLink>
        <TileLink href={carry(sp, "/payments/payables")}><Stat label="We owe suppliers" value={rupeesShort(p.pay.total)} sub={`${rupeesShort(p.pay.overdue)} past the due date`} /></TileLink>
        <TileLink href={carry(sp, "/orders/list", { show: "open" })}><Stat label="Open orders" value={f0.format(o.open.n)} sub={`${f0.format(o.open.late)} past the delivery date`} /></TileLink>
        <TileLink href={carry(sp, "/mail/quotations", { show: "followup" }, ["p", "from", "to"])}><Stat label="Quotes to follow up" value={f0.format(m.quotes.followup)} sub={`${f0.format(m.quotes.n)} quotations sent in the period`} /></TileLink>
        <TileLink href="/mail/inbox"><Stat label="Mails waiting for a reply" value={f0.format(m.inbox.pending)} sub={`${f0.format(m.inbox.urgent)} urgent`} /></TileLink>
        <TileLink href="/review"><Stat label="Needs a decision" value={f0.format(waiting)} sub={`${f0.format(c.decide)} review ${c.decide === 1 ? "item" : "items"} · ${f0.format(c.docs_review)} ${c.docs_review === 1 ? "document" : "documents"} · ${f0.format(c.drafts)} ${c.drafts === 1 ? "draft" : "drafts"}`} /></TileLink>
        <TileLink href="/tally"><Stat label="Tally" value={ts.word} sub={ts.line} /></TileLink>
      </div>
    );
  });
}

/** What to act on today, most serious first. Each line opens the place to act. A line is shown only when there is something to act on. */
export async function AttentionList({ f, pay, ord, sp }: OverviewProps) {
  return safe("The attention list", async () => {
    const [p, o, m, c, t, neg] = await Promise.all([loadPay(pay), loadOrders(ord), loadMail(f), loadControl(), loadTallyStatus(), loadNegatives()]);
    const ts = tallyState(t);
    const over90 = p.ageing.find((a) => a.label.startsWith("Over 90"));
    const items: Attention[] = [];
    const add = (tone: Attention["tone"], n: number, text: string, href: string) => { if (n > 0) items.push({ tone, text, href }); };
    const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

    add("bad", o.open.late, `${f0.format(o.open.late)} open ${s(o.open.late, "order is", "orders are")} past the delivery date`, carry(sp, "/orders/list", { show: "late" }));
    add("bad", over90?.value ?? 0, `${rupeesShort(over90?.value ?? 0)} is more than 90 days late, over ${f0.format(over90?.count ?? 0)} ${s(over90?.count ?? 0, "invoice", "invoices")}`, carry(sp, "/payments/receivables", { show: "overdue" }));
    add("bad", m.inbox.urgent, `${f0.format(m.inbox.urgent)} urgent ${s(m.inbox.urgent, "mail has", "mails have")} no reply`, "/mail/inbox");
    add("warn", m.quotes.followup, `${f0.format(m.quotes.followup)} ${s(m.quotes.followup, "quotation has", "quotations have")} had no follow-up for three days or more`, carry(sp, "/mail/quotations", { show: "followup" }, ["p", "from", "to"]));
    add("warn", c.decide, `${f0.format(c.decide)} ${s(c.decide, "item waits", "items wait")} for a decision in Needs review`, "/review");
    add("warn", c.docs_review, `${f0.format(c.docs_review)} ${s(c.docs_review, "document waits", "documents wait")} for review`, "/documents");
    add("warn", c.docs_failed, `${f0.format(c.docs_failed)} ${s(c.docs_failed, "document could", "documents could")} not be read`, "/documents");
    add("warn", neg, `${f0.format(neg)} grade and thickness ${s(neg, "line shows", "lines show")} more sold than bought`, "/summary");
    if (ts.tone === "warn") items.push({ tone: "warn", text: `Tally: ${ts.line.toLowerCase()}`, href: "/tally" });
    add("info", c.drafts, `${f0.format(c.drafts)} ${s(c.drafts, "draft is", "drafts are")} open`, "/drafts");
    if (c.session?.status === "review") items.push({ tone: "info", text: `The physical count "${c.session.name}" is ready for review`, href: "/count" });
    if (ts.tone === "wait") items.push({ tone: "info", text: "Tally figures are waiting for the first sync from the Tally PC", href: "/tally" });

    const order = { bad: 0, warn: 1, info: 2 } as const;
    items.sort((a, b) => order[a.tone] - order[b.tone]);
    const cls = { bad: "text-bad", warn: "text-accent", info: "text-muted" } as const;
    return (
      <Card title="Needs your attention today" help="Worked out from the same records as the rest of this page. A line appears only when there is something to do, and opens the place to do it.">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-[0.95rem] text-muted"><CheckCircle2 className="h-4 w-4 text-ok" /> Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.text}>
                <Link href={i.href} className="flex items-center gap-3 px-5 py-3 text-[0.95rem] hover:bg-surface/60">
                  {i.tone === "info" ? <Info className={"h-4 w-4 shrink-0 " + cls[i.tone]} /> : <AlertTriangle className={"h-4 w-4 shrink-0 " + cls[i.tone]} />}
                  <span className="min-w-0 flex-1">{i.text}</span>
                  <span className="shrink-0 text-[0.82rem] text-brand">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  });
}

const NAV = [["stock", "Stock"], ["money", "Money"], ["orders", "Orders and dispatch"], ["mail", "Mail and leads"], ["tally", "Tally"], ["control", "Count and control"], ["ask", "Ask the business"]] as const;

/** Jump links to each part of the page. */
export function SectionNav() {
  return (
    <nav aria-label="Parts of this page" className="mt-6 flex flex-wrap gap-2">
      {NAV.map(([id, label]) => (
        <a key={id} href={`#${id}`} className="rounded-full border border-line bg-field px-3.5 py-1.5 text-[0.85rem] font-medium text-muted hover:border-brand hover:text-brand">{label}</a>
      ))}
    </nav>
  );
}
