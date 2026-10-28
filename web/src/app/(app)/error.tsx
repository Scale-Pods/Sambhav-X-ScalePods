"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

/** Shown instead of an endless loading screen when a page fails (for example the database did not answer in time). */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[page-error]", error.digest ?? "", error.message); }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-lg border border-line bg-card p-8 text-center shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
      <h1 className="font-display text-xl font-bold">This page did not load</h1>
      <p className="mt-2 text-[0.95rem] text-muted">The data took too long or could not be reached. Nothing was lost or changed. Try again; if it keeps happening, tell us the time and the page.</p>
      {error.digest && <p className="mt-2 text-[0.78rem] text-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"><RefreshCw className="h-4 w-4" />Try again</button>
    </div>
  );
}
