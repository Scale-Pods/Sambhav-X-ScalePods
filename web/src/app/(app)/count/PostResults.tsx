import Link from "next/link";
import { postingPreview, postingRequests, type PostingRequest } from "@/lib/queries";
import { Badge, Card, td, th, Th } from "@/components/ui";
import { GroupActions, RowActions, SendForApproval } from "./PostingClient";

const kg = (v: number | string | null) => (v == null ? "-" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(v)));
const signed = (v: number | string | null) => { const n = Number(v ?? 0); return (n > 0.5 ? "+" : n < -0.5 ? "−" : "") + kg(Math.abs(n)); };
const OUTCOME = { short: { label: "Short", tone: "error" }, excess: { label: "Excess", tone: "warning" }, missing: { label: "Not found", tone: "neutral" } } as const;
const STATUS: Record<string, { label: string; tone: "ok" | "error" | "warning" | "info" | "neutral" }> = {
  pending: { label: "Waiting", tone: "warning" }, approved: { label: "Approved", tone: "ok" }, corrected: { label: "Approved (changed)", tone: "info" }, rejected: { label: "Rejected", tone: "neutral" },
};

type Me = { id: string; role: string } | null;

/** Step 3 of a count: turn the differences into correcting entries, approved by someone other than the person who sent them. */
export async function PostResults({ sessionId, status, canSend, canDecide, me, filter }: { sessionId: string; status: string; canSend: boolean; canDecide: boolean; me: Me; filter: string }) {
  const requests = await postingRequests(sessionId);
  const sent = requests.length > 0;
  const tile = "rounded-lg border border-line bg-card p-4";

  if (!sent) {
    const p = await postingPreview(sessionId);
    const total = p.short.n + p.excess.n + p.missing.n;
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Counted short</p><p className="mt-1.5 font-display text-2xl font-extrabold text-bad">{p.short.n}</p><p className="num text-[0.78rem] text-muted">{signed(p.short.kg)} kg</p></div>
          <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Counted in excess</p><p className="mt-1.5 font-display text-2xl font-extrabold text-warn">{p.excess.n}</p><p className="num text-[0.78rem] text-muted">{signed(p.excess.kg)} kg</p></div>
          <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">In the books, not found</p><p className="mt-1.5 font-display text-2xl font-extrabold">{p.missing.n}</p><p className="num text-[0.78rem] text-muted">{signed(p.missing.kg)} kg if all written off</p></div>
          <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Counted, not in the books</p><p className="mt-1.5 font-display text-2xl font-extrabold">{p.unknown}</p><p className="text-[0.78rem] text-muted">go to Needs review</p></div>
        </div>
        <Card title="Send the differences for approval">
          <div className="space-y-4 p-5 text-[0.93rem] text-muted">
            <p><span className="font-semibold text-ink">What happens.</span> Each plate that differs becomes one approval request with the books figure, the counted figure and the adjustment. Plates that match within the tolerance are left alone. Nothing is overwritten: an approval adds a correcting entry to the plate&apos;s history.</p>
            <p><span className="font-semibold text-ink">Before you send.</span> Check the Reconciliation tab. If some yards are still to be counted, finish counting first: any plate not counted becomes a &ldquo;not found&rdquo; request.</p>
            {p.counted === 0 && status === "review" && <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">Nothing has been counted in this count, so it cannot be sent: every plate in the books would look missing.</p>}
            {p.counted > 0 && p.missing.n > p.counted && status === "review" && <p role="alert" className="rounded-md bg-warn-soft px-4 py-3 font-medium text-warn">Only {p.counted} plates were counted but {p.missing.n} in the books were not found. Is the count finished? Every plate not found becomes a high-risk write-off request.</p>}
            {status !== "review" ? <p className="font-medium text-ink">This count is not waiting for approval.</p> : p.counted === 0 ? null : canSend ? <SendForApproval sessionId={sessionId} requests={total} /> : <p className="font-medium text-ink">The owner or an administrator sends the count for approval.</p>}
            {total === 0 && p.unknown === 0 && status === "review" && <p>Every counted plate matches the books. Nothing needs approving.</p>}
          </div>
        </Card>
      </div>
    );
  }

  const by = (o: string) => requests.filter((r) => r.outcome === o);
  const pendingBy = (o: string) => by(o).filter((r) => r.status === "pending").length;
  const pending = requests.filter((r) => r.status === "pending").length;
  const done = requests.length - pending;
  const applied = requests.filter((r) => r.status === "approved" || r.status === "corrected").reduce((a, r) => a + Number(r.final_kg ?? 0), 0);
  const shown = (filter === "all" ? requests : requests.filter((r) => r.outcome === filter)).slice(0, 300);
  const chip = (on: boolean) => "rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset " + (on ? "bg-ink text-surface ring-ink" : "bg-field text-muted ring-line hover:text-ink");
  const mine = (r: PostingRequest) => me != null && r.created_by === me.id;
  const iSent = requests.some(mine);
  const tabs: [string, string][] = [["all", `All (${requests.length})`], ["short", `Short (${by("short").length})`], ["excess", `Excess (${by("excess").length})`], ["missing", `Not found (${by("missing").length})`]];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Requests</p><p className="mt-1.5 font-display text-2xl font-extrabold">{requests.length}</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Waiting for a decision</p><p className="mt-1.5 font-display text-2xl font-extrabold text-warn">{pending}</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Decided</p><p className="mt-1.5 font-display text-2xl font-extrabold">{done}</p></div>
        <div className={tile}><p className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Added to the books</p><p className="num mt-1.5 font-display text-2xl font-extrabold">{signed(applied)}<span className="ml-1 font-sans text-sm font-medium text-muted">kg</span></p></div>
      </div>

      {status === "posted" && <p role="status" className="rounded-md bg-ok-soft px-4 py-3 text-[0.93rem] font-medium text-ok">Every difference has been decided. This count is posted.</p>}
      {pending > 0 && iSent && <p className="rounded-md bg-info-soft px-4 py-3 text-[0.9rem] text-brand-dark">You sent these, so another approver has to decide them. That is the rule for every correction to the books.</p>}

      {pending > 0 && canDecide && (
        <Card title="Decide many at once">
          <div className="space-y-4 p-5">
            {(["short", "excess", "missing"] as const).map((o) => (
              <div key={o}><GroupActions sessionId={sessionId} outcome={o} count={pendingBy(o)} label={OUTCOME[o].label.toLowerCase()} canApprove={!iSent} /></div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Differences">
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          {tabs.map(([k, l]) => <Link key={k} href={`/count?tab=post&s=${sessionId}&ps=${k}`} className={chip(filter === k)}>{l}</Link>)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-surface/60">
              <tr><Th>Plate</Th><Th>Result</Th><Th right>Books</Th><Th right>Counted</Th><Th right>Adjustment</Th><Th>Risk</Th><Th>Status</Th><th className={th}></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">Nothing here.</td></tr>}
              {shown.map((r) => {
                const o = OUTCOME[r.outcome as keyof typeof OUTCOME] ?? OUTCOME.missing;
                const s = STATUS[r.status] ?? STATUS.pending;
                const high = r.risk_tier === "high";
                return (
                  <tr key={r.id} className="align-top hover:bg-surface/60">
                    <td className={td}><Link href={`/plates/${r.lot_no}`} className="font-semibold text-brand hover:underline">{r.ident}</Link><div className="text-[0.75rem] text-muted">{r.grade}</div></td>
                    <td className={td}><Badge tone={o.tone}>{o.label}</Badge>{(Number(r.window_out_kg) > 0 || Number(r.window_in_kg) > 0) && <div className="mt-1 text-[0.72rem] text-muted">moved during count: {kg(r.window_out_kg)} out, {kg(r.window_in_kg)} in</div>}</td>
                    <td className={td + " num text-right"}>{kg(r.books_kg)}</td>
                    <td className={td + " num text-right"}>{r.counted_opening_kg == null ? "-" : kg(r.counted_opening_kg)}</td>
                    <td className={td + " num text-right font-semibold " + (Number(r.adjust_kg) < 0 ? "text-bad" : "text-warn")}>{signed(r.final_kg ?? r.adjust_kg)}{r.status === "corrected" && <div className="text-[0.72rem] font-normal text-muted">asked {signed(r.adjust_kg)}</div>}</td>
                    <td className={td}>{high ? <Badge tone="error">High</Badge> : <Badge tone="info">Medium</Badge>}</td>
                    <td className={td}><Badge tone={s.tone}>{s.label}</Badge>{r.decided_by_name && <div className="mt-1 text-[0.72rem] text-muted">{r.decided_by_name}{r.reviewer_note ? ` · ${r.reviewer_note}` : ""}</div>}</td>
                    <td className={td}>{r.status === "pending" && canDecide && !mine(r) ? <RowActions id={r.id} proposedKg={Number(r.adjust_kg)} high={high} /> : r.status === "pending" && mine(r) ? <span className="text-[0.75rem] text-muted">Another approver decides</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 300 && <p className="border-t border-line px-5 py-3 text-sm text-muted">Showing 300. Use the filters above to see the rest.</p>}
      </Card>
    </div>
  );
}
