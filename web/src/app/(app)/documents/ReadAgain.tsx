"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** For a document that could not be read (or whose reading was cut off): ask for the reading again without uploading the file again. */
export function ReadAgain({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/documents/${id}/read`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setError(j.error ?? "It could not be read this time either.");
    } catch {
      setError("The connection dropped. Try again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
        <RefreshCw className={"h-4 w-4 " + (busy ? "animate-spin" : "")} />{busy ? "Reading… this takes up to a minute" : "Read it again"}
      </button>
      {error && <p className="text-[0.85rem] text-bad">{error}</p>}
    </div>
  );
}
