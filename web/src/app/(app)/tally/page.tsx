import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton, Stat, StatsSkeleton, td, Th } from "@/components/ui";
import { readTallyEntity, tallyLive, tallyStatus } from "@/lib/tally";
import { SyncButton } from "./SyncButton";
import { LiveProvider, ProgressStrip } from "./live";

export default function TallyStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<><StatsSkeleton /><div className="mt-6"><Card><Skeleton rows={6} /></Card></div></>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "never");
const ago = (min: number | null | undefined) => {
  if (min == null) return "never";
  return min < 2 ? "just now" : min < 90 ? `${min} minutes ago` : min < 2880 ? `${Math.round(min / 60)} hours ago` : `${Math.round(min / 1440)} days ago`;
};
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("en-IN");

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection(); // "x minutes ago" depends on the clock
  const entity = readTallyEntity((await searchParams).entity);
  const [s, live] = await Promise.all([tallyStatus(entity), tallyLive(entity)]);
  const alive = s.connector?.seen_min != null && s.connector.seen_min < 15;
  const state: { tone: "ok" | "warning" | "error" | "neutral"; text: string; short: string } =
    !s.connector?.last_seen_at ? { tone: "neutral", text: "Not connected yet", short: "Waiting" }
    : !alive ? { tone: "error", text: "Not heard from for " + ago(s.connector.seen_min).replace(" ago", ""), short: "Offline" }
    : s.connector.last_status === "tally_down" ? { tone: "error", text: "Tally is not open on the PC", short: "Tally off" }
    : s.connector.last_status === "error" ? { tone: "warning", text: "Connected, last sync had a problem", short: "Check" }
    : { tone: "ok", text: "Connected", short: "Connected" };
  const c = s.counts;
  return (
    <LiveProvider initial={live} entity={entity}>
    <div className="space-y-6">
      <ProgressStrip />
      {!s.company && (
        <Card>
          <p className="px-5 py-4 text-[0.92rem] text-muted">
            Nothing has arrived from Tally for {entity === "SAI" ? "Sai Steel & Engineering" : "Sambhav Pipes & Fittings"} yet. A company is read once it is loaded in TallyPrime on the office PC
            and the connector there is set up for it (version 1.1 reads several companies); the next scheduled sync, or Sync now, then brings it. The last message from the Tally PC, below, says
            if it could not find the company.
          </p>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Connection" value={state.short} sub={s.connector?.last_seen_at ? `Last heard ${ago(s.connector.seen_min)}` : "The program is not installed on the Tally PC yet"} />
        <Stat label="Last good sync" value={s.connector?.last_sync_ok_at ? ago(s.connector.ok_min) : "None yet"} sub={s.connector?.last_sync_ok_at ? when(s.connector.last_sync_ok_at) : "Vouchers arrive with the first full sync"} />
        <Stat label="Customers and vendors" value={n(c.ledgers)} sub={`${n(c.stock_items)} stock items`} />
        <Stat label="Vouchers" value={n(c.vouchers)} sub={c.vouchers ? `${c.first_voucher} to ${c.last_voucher}` : "None yet: needs the first full sync"} />
      </div>

      <Card title={s.company?.tally_name ?? "Company"} aside={<Badge tone={state.tone} info="The small program on the Tally PC reports every few minutes. If nothing is heard for a while it shows as not heard from. Usual reasons: the PC is off, the Windows user is logged out, or TallyPrime is closed.">{state.text}</Badge>}>
        <div className="grid gap-6 px-5 py-5 md:grid-cols-[1fr_auto]">
          <dl className="grid gap-x-8 gap-y-2 text-[0.92rem] sm:grid-cols-2">
            <div><dt className="text-muted">Last message from the Tally PC</dt><dd className="font-medium">{s.connector?.last_message || "none"}{s.connector?.last_version ? ` (program v${s.connector.last_version})` : ""}</dd></div>
            <div><dt className="text-muted">Outstanding bills read</dt><dd className="font-medium">{n(c.receivable_bills)} receivable, {n(c.payable_bills)} payable{c.bills_as_of ? ` as of ${c.bills_as_of}` : ""}</dd></div>
            <div><dt className="text-muted">Last sync run</dt><dd className="font-medium">{s.company?.last_sync_at ? `${when(s.company.last_sync_at)} (${s.company.last_status})` : "none"}</dd></div>
            <div><dt className="text-muted">Sync now request</dt><dd className="font-medium">{s.request ? `${s.request.status}${s.request.message ? `: ${s.request.message}` : ""} (${when(s.request.requested_at)})` : "none"}</dd></div>
          </dl>
          <div className="md:text-right">
            <SyncButton />
            <p className="mt-2 max-w-[16rem] text-[0.8rem] text-muted md:ml-auto">The Tally PC looks for a request every 5 minutes. Only the owner and administrators can ask.</p>
          </div>
        </div>
      </Card>

      <Card title="Recent syncs">
        {s.runs.length === 0 ? <p className="px-5 py-8 text-center text-muted">No syncs yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-surface/60"><tr><Th>Started</Th><Th>How</Th><Th info="Done: it finished properly. Running: in progress. Partly or Failed: it stopped early; the Problem column says why.">Result</Th><Th right>Records</Th><Th>Problem</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {s.runs.map((r, i) => (
                  <tr key={i}>
                    <td className={td + " whitespace-nowrap"}>{when(r.started_at)}</td>
                    <td className={td}>{r.trigger_type === "manual" ? "Sync now" : r.trigger_type === "upload" ? "Files uploaded" : "Scheduled"}</td>
                    <td className={td}><Badge tone={r.status === "ok" ? "ok" : r.status === "running" ? "info" : "error"} info={r.status === "ok" ? "The sync finished and the data arrived." : r.status === "running" ? "The sync is in progress." : r.status === "partial" ? "Part of the data arrived; the Problem column says what stopped it." : "The sync stopped before it finished; the Problem column says why."}>{r.status === "ok" ? "Done" : r.status === "running" ? "Running" : r.status === "partial" ? "Partly" : "Failed"}</Badge></td>
                    <td className={td + " num text-right"}>{r.records_in == null ? "" : n(r.records_in)}</td>
                    <td className={td + " max-w-[28rem] truncate text-muted"} title={r.error ?? ""}>{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
    </LiveProvider>
  );
}
