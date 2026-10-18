"use client";

import { useState, useTransition } from "react";
import { startCount } from "./actions";

export function StartCount() {
  const [book, setBook] = useState("WB1");
  const [name, setName] = useState("Physical count November 2026");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const field = "w-full rounded-xl border border-line bg-white px-4 py-3 focus:border-brand";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Stock book</span>
          <select value={book} onChange={(e) => setBook(e.target.value)} className={field}><option value="WB1">WB1 · SPF alloy plates</option><option value="WB2">WB2 · SPF + RS</option></select></label>
        <label className="block sm:col-span-2"><span className="mb-1.5 block text-sm font-medium text-muted">Name of this count</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-2.5 text-[0.92rem] text-bad">{error}</p>}
      <button disabled={pending} onClick={() => start(async () => { const r = await startCount(book, name); if (!r.ok) setError(r.error); })} className="rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Opening…" : "Open the count window"}
      </button>
    </div>
  );
}
