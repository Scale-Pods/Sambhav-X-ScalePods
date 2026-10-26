"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radio } from "lucide-react";
import type { Live } from "@/lib/tally";

/**
 * What the Tally PC is doing right now. The page asks /api/tally/live every 3 seconds while a sync is waiting or running (every 15 seconds
 * otherwise, so a scheduled sync that starts while the page is open shows up too) and refreshes the numbers on the page when it finishes.
 */
type Ctx = { live: Live; poke: () => void };
const LiveContext = createContext<Ctx | null>(null);
export const useLive = () => {
  const c = useContext(LiveContext);
  if (!c) throw new Error("useLive needs a LiveProvider");
  return c;
};

export function LiveProvider({ initial, children }: { initial: Live; children: ReactNode }) {
  const router = useRouter();
  const [live, setLive] = useState<Live>(initial);
  const last = useRef<Live["state"]>(initial.state);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/tally/live", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as Live;
      setLive(d);
      if (last.current !== "idle" && d.state === "idle") router.refresh(); // a sync just ended: show its numbers
      last.current = d.state;
    } catch { /* the next poll tries again */ }
  }, [router]);

  useEffect(() => {
    const every = live.state === "idle" ? 15000 : 3000;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, every);
    return () => window.clearInterval(id);
  }, [live.state, poll]);

  const poke = useCallback(() => { void poll(); }, [poll]);
  return <LiveContext.Provider value={{ live, poke }}>{children}</LiveContext.Provider>;
}

const clock = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);

export function ProgressStrip() {
  const { live } = useLive();
  if (live.state === "idle") return null;
  const running = live.state === "running";
  const how = live.how === "manual" ? "Sync now" : live.how === "upload" ? "Files uploaded" : "Scheduled sync";
  const notPicked = !running && live.seconds > 600; // the PC checks every 5 minutes: 10 minutes means it is probably off
  return (
    <section role="status" aria-live="polite" className="rounded-lg border border-line bg-card px-5 py-4 shadow-[0_1px_2px_rgba(24,34,45,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[1.02rem] font-bold tracking-[-0.01em]">
            {running ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <Radio className="h-4 w-4 text-brand" />}
            {running ? "Syncing Tally" : "Waiting for the Tally PC"}
            <span className="rounded-full bg-surface px-2 py-0.5 text-[0.72rem] font-medium text-muted">{how}</span>
          </h2>
          <p className="mt-1 text-[0.88rem] text-muted">
            {running
              ? <>{live.stage ?? "Starting"}{live.detail ? <> · <span className="text-ink">{live.detail}</span></> : null}</>
              : notPicked ? "The PC has not picked the request up yet. Is it on, with Tally open?" : "Your request is saved. The PC looks for requests every 5 minutes, then the bar starts moving."}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {running && <div className="num font-display text-[1.7rem] font-bold leading-none">{live.pct}%</div>}
          <div className="mt-1 text-[0.78rem] text-muted">{running ? "running" : "waiting"} {clock(live.seconds)}</div>
        </div>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface" role="progressbar" aria-label="Tally sync progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={running ? live.pct : undefined}>
        {running
          ? <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${Math.max(live.pct, 2)}%` }} />
          : <div className="relative h-full w-full"><div className="sync-slide absolute inset-y-0 left-0 w-2/5 rounded-full bg-brand/70" /></div>}
      </div>
    </section>
  );
}
