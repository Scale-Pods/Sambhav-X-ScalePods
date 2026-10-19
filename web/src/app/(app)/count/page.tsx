import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftRight, ClipboardCheck, Lock, Radio, Scale } from "lucide-react";
import { canCount, canExport, canRunCount, currentStaff } from "@/lib/auth";
import { countLines, countSessions, windowMoves } from "@/lib/queries";
import { kg } from "@/lib/format";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { CountScreen } from "./CountScreen";
import { MovesPanel } from "./MovesPanel";
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
  const open = sessions.find((s) => s.status === "counting");
  const reviewed = sessions.filter((s) => s.status === "review");
  // the session the tabs work on: the open one, otherwise the latest closed one (for its reconciliation)
  const session = open ?? reviewed[0] ?? null;
  const tab = sp.tab === "moves" && open ? "moves" : sp.tab === "reconcile" && session ? "reconcile" : open ? "count" : session ? "reconcile" : "count";

  const [lines, moves] = await Promise.all([
    open && tab === "count" ? countLines(open.id) : Promise.resolve([]),
    open && tab === "moves" ? windowMoves(open.id) : Promise.resolve([]),
  ]);

  const tabCls = (on: boolean) => "flex items-center gap-2 border-b-2 px-1 pb-3 text-[0.95rem] font-semibold transition-colors " + (on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink");

  return (
    <div className="space-y-6">
      {open ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-accent/30 bg-accent-soft px-5 py-3.5">
          <span className="flex items-center gap-2 font-display font-bold text-ink"><Radio className="h-4 w-4 text-accent" /> Count window open · {open.book}</span>
          <span className="text-[0.92rem] text-muted">{open.name}. Opened {when(open.started_at)}. {kg(open.lines)} plates counted so far.</span>
        </div>
      ) : (
        <Card title="No count is open">
          <div className="space-y-4 p-5">
            <p className="text-[0.95rem] text-muted">Opening a count starts the count window. From that moment, plates are counted here and anything that moves in or out is logged against the count.</p>
            {canRunCount(me?.role) ? <StartCount /> : <p className="text-sm font-medium text-muted">The owner or an administrator opens the count.</p>}
          </div>
        </Card>
      )}

      {session && (
        <nav className="flex flex-wrap gap-6 border-b border-line" aria-label="Count sections">
          {open && <Link href="/count?tab=count" className={tabCls(tab === "count")}><ClipboardCheck className="h-4 w-4" /> Count plates</Link>}
          {open && <Link href="/count?tab=moves" className={tabCls(tab === "moves")}><ArrowLeftRight className="h-4 w-4" /> Moves during count</Link>}
          <Link href="/count?tab=reconcile" className={tabCls(tab === "reconcile")}><Scale className="h-4 w-4" /> Reconciliation{!open && session ? ` · ${session.name}` : ""}</Link>
        </nav>
      )}

      {open && tab === "count" && <CountScreen sessionId={open.id} book={open.book} lines={lines} canClose={canRunCount(me?.role)} canCount={canCount(me?.role)} />}
      {open && tab === "moves" && <MovesPanel sessionId={open.id} book={open.book} moves={moves} canLog={canCount(me?.role)} />}
      {session && tab === "reconcile" && (
        <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
          <Reconciliation sessionId={session.id} filter={sp.rs ?? "all"} canExport={canExport(me?.role)} startedLabel={when(session.started_at)} />
        </Suspense>
      )}

      {reviewed.length > 0 && (
        <Card title="Closed counts, waiting for review">
          <ul className="divide-y divide-line">
            {reviewed.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-muted" /> {s.name} <span className="text-sm font-normal text-muted">· {s.book}</span></span>
                <span className="num text-sm text-muted">{kg(s.lines)} plates · {kg(s.kg)} kg</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
