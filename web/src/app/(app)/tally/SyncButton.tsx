"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { requestTallySync } from "./actions";
import { useLive } from "./live";

export function SyncButton() {
  const { live, poke } = useLive();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const busy = live.state !== "idle";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        disabled={pending || busy}
        onClick={() => start(async () => { setError(""); const r = await requestTallySync(); if (!r.ok) setError(r.error); else poke(); })}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        <RefreshCw className={"h-4 w-4 " + (pending || live.state === "running" ? "animate-spin" : "")} />
        {live.state === "running" ? `Syncing… ${live.pct}%` : live.state === "waiting" ? "Waiting for the Tally PC…" : pending ? "Asking…" : "Sync now"}
      </button>
      {error && <p className="text-[0.82rem] text-bad">{error}</p>}
    </div>
  );
}
