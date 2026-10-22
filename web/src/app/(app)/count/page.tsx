import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, CheckCheck, ClipboardCheck, Lock, Radio, Scale, Send } from "lucide-react";
import { canCount, canDecide, canExport, canRunCount, currentStaff } from "@/lib/auth";
import { countLines, countSessions, windowMoves } from "@/lib/queries";
import { kg } from "@/lib/format";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { CountScreen } from "./CountScreen";
import { MovesPanel } from "./MovesPanel";
import { PostResults } from "./PostResults";
import { Reconciliation } from "./Reconciliation";
import { StartCount } from "./StartCount";

type SP = Promise<Record<string, string | undefined>>;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "-");

export default function CountPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Physical count" hint="The yard keeps selling while it is counted. Log what moves during the count and the system works out the true opening stock for you." />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [me, sessions] = await Promise.all([currentStaff(), countSessions()]);
  const opens = sessions.filter((s) => s.status === "counting");
  const closed = sessions.filter((s) => s.status === "review" || s.status === "posted");
  const picked = sessions.find((s) => s.id === sp.s);
  // the count that is open (counting happens here), and the count the tabs are showing: the one picked, else the open one, else the latest closed
  const open = picked?.status === "counting" ? picked : opens[0];
  const session = picked ?? open ?? closed[0] ?? null;
  const isOpen = session?.status === "counting";
  const isClosed = session != null && !isOpen;
  const tab = sp.tab === "moves" && isOpen ? "moves" : sp.tab === "post" && isClosed ? "post" : sp.tab === "reconcile" && session ? "reconcile" : isOpen ? "count" : session ? "reconcile" : "count";

  const [lines, moves] = await Promise.all([
    session && isOpen && tab === "count" ? countLines(session.id) : Promise.resolve([]),
    session && isOpen && tab === "moves" ? windowMoves(session.id) : Promise.resolve([]),
  ]);

  const q = (tab: string, extra = "") => `/count?tab=${tab}${session && sessions.length > 1 ? `&s=${session.id}` : ""}${extra}`;
  const tabCls = (on: boolean) => "flex items-center gap-2 border-b-2 px-1 pb-3 text-[0.95rem] font-semibold transition-colors " + (on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink");

  return (
    <div className="space-y-6">
      {open ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-accent/30 bg-accent-soft px-5 py-3.5">
          <span className="flex items-center gap-2 font-display font-bold text-ink"><Radio className="h-4 w-4 text-accent" /> Count window open · {open.book}</span>
          <span className="text-[0.92rem] text-muted">{open.name}. Opened {when(open.started_at)}. {kg(open.lines)} plates counted so far.</span>
          {opens.length > 1 && (
            <span className="ml-auto flex gap-1.5">
              {opens.map((o) => (
                <Link key={o.id} href={`/count?tab=${tab}&s=${o.id}`} className={"rounded-md px-3 py-1 text-sm font-semibold " + (o.id === open.id ? "bg-ink text-surface" : "bg-field text-muted ring-1 ring-inset ring-line hover:text-ink")}>{o.book}</Link>
              ))}
            </span>
          )}
        </div>
      ) : (
        <Card title="No count is open">
          <div className="space-y-4 p-5">
            <p className="text-[0.95rem] text-muted">Opening a count starts the count window. From that moment, plates are counted here and anything that moves in or out is logged against the count.</p>
            {canRunCount(me?.role) ? <StartCount /> : <p className="text-sm font-medium text-muted">The owner or an administrator opens the count.</p>}
          </div>
        </Card>
      )}

      {open && opens.length < 2 && canRunCount(me?.role) && (
        <details className="rounded-lg border border-line bg-card px-5 py-3">
          <summary className="cursor-pointer text-[0.9rem] font-medium text-muted">Open a count for the other stock book</summary>
          <div className="pt-4"><StartCount /></div>
        </details>
      )}

      {session && (
        <nav className="flex flex-wrap gap-6 border-b border-line" aria-label="Count sections">
          {isOpen && <Link href={q("count")} className={tabCls(tab === "count")}><ClipboardCheck className="h-4 w-4" /> Count plates</Link>}
          {isOpen && <Link href={q("moves")} className={tabCls(tab === "moves")}><ArrowLeftRight className="h-4 w-4" /> Moves during count</Link>}
          <Link href={q("reconcile")} className={tabCls(tab === "reconcile")}><Scale className="h-4 w-4" /> Reconciliation{isClosed ? ` · ${session.name}` : ""}</Link>
          {isClosed && <Link href={q("post")} className={tabCls(tab === "post")}>{session.status === "posted" ? <CheckCheck className="h-4 w-4" /> : <Send className="h-4 w-4" />} {session.status === "posted" ? "Posted" : "Send for approval"}</Link>}
        </nav>
      )}

      {session && isOpen && tab === "count" && <CountScreen sessionId={session.id} book={session.book} lines={lines} canClose={canRunCount(me?.role)} canCount={canCount(me?.role)} />}
      {session && isOpen && tab === "moves" && <MovesPanel sessionId={session.id} book={session.book} moves={moves} canLog={canCount(me?.role)} />}
      {session && isClosed && tab === "post" && (
        <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
          <PostResults sessionId={session.id} status={session.status} canSend={canRunCount(me?.role)} canDecide={canDecide(me?.role)} me={me ? { id: me.id, role: me.role } : null} filter={sp.ps ?? "all"} />
        </Suspense>
      )}
      {session && tab === "reconcile" && (
        <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
          <Reconciliation sessionId={session.id} filter={sp.rs ?? "all"} canExport={canExport(me?.role)} startedLabel={when(session.started_at)} />
        </Suspense>
      )}

      {closed.length > 0 && (
        <Card title="Closed counts">
          <ul className="divide-y divide-line">
            {closed.map((s) => (
              <li key={s.id}>
                <Link href={`/count?tab=${s.status === "review" ? "post" : "reconcile"}&s=${s.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface/60">
                  <span className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-muted" /> {s.name} <span className="text-sm font-normal text-muted">· {s.book}</span>
                    <span className={"rounded-sm px-1.5 py-0.5 text-[0.7rem] font-semibold " + (s.status === "posted" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>{s.status === "posted" ? "Posted" : "Waiting for approval"}</span></span>
                  <span className="num text-sm text-muted">{kg(s.lines)} plates · {kg(s.kg)} kg</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
