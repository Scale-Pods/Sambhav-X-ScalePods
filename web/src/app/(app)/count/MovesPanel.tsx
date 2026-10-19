"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, CircleAlert, Trash2 } from "lucide-react";
import { recordWindowMove, rejectWindowMove, searchPlates, type MoveResult, type Plate } from "./actions";
import type { WindowMove } from "@/lib/queries";

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
/** "now" in India as yyyy-mm-ddThh:mm, for the date-time box */
const nowIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
const timeIST = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Plates that came in or went out while the count is open. Each one is backed out of that plate's count automatically. */
export function MovesPanel({ sessionId, book, moves, canLog }: { sessionId: string; book: string; moves: WindowMove[]; canLog: boolean }) {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Plate | null>(null);
  const [matches, setMatches] = useState<Plate[]>([]);
  const [kg, setKg] = useState("");
  const [pcs, setPcs] = useState("");
  const [at, setAt] = useState("");
  const [maxAt, setMaxAt] = useState<string | undefined>(undefined);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<MoveResult | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the clock is read in the browser after the page opens, not while the page is prepared
  useEffect(() => { setAt(nowIST()); setMaxAt(nowIST()); }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (picked || query.trim().length < 2) { setMatches([]); return; }
    timer.current = setTimeout(async () => setMatches(await searchPlates(book, query)), 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, picked, book]);

  const submit = () => {
    setError(""); setFlash(null);
    start(async () => {
      const r = await recordWindowMove(sessionId, query.trim(), direction, Number(kg), Number(pcs || 0), at, reference, note);
      if (r.ok) { setFlash(r); setQuery(""); setPicked(null); setKg(""); setPcs(""); setReference(""); setNote(""); setAt(nowIST()); setMaxAt(nowIST()); }
      else setError(r.error);
    });
  };

  const field = "w-full rounded-md border border-line bg-field px-4 py-3 text-[1rem] focus:border-brand";
  const totalOut = moves.filter((m) => m.direction === "out").reduce((a, m) => a + Number(m.weight_kg), 0);
  const totalIn = moves.filter((m) => m.direction === "in").reduce((a, m) => a + Number(m.weight_kg), 0);

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <section className="rounded-lg border border-line bg-card p-6 shadow-[0_1px_2px_rgba(24,34,45,0.04)] xl:col-span-3">
        <h2 className="font-display text-lg font-bold">Log a plate that moved</h2>
        <p className="mt-1 text-[0.9rem] text-muted">Anything sold, dispatched or received while the count is open. The plate number is required: without it the movement cannot be taken out of the count.</p>

        <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Direction">
          <button type="button" onClick={() => setDirection("out")} aria-pressed={direction === "out"}
            className={"flex items-center justify-center gap-2 rounded-md py-3.5 text-[1rem] font-semibold ring-1 ring-inset " + (direction === "out" ? "bg-accent text-white ring-accent" : "bg-field text-ink ring-line hover:bg-surface")}>
            <ArrowUpFromLine className="h-4 w-4" /> Went out (sold / dispatched)
          </button>
          <button type="button" onClick={() => setDirection("in")} aria-pressed={direction === "in"}
            className={"flex items-center justify-center gap-2 rounded-md py-3.5 text-[1rem] font-semibold ring-1 ring-inset " + (direction === "in" ? "bg-brand text-white ring-brand" : "bg-field text-ink ring-line hover:bg-surface")}>
            <ArrowDownToLine className="h-4 w-4" /> Came in (received)
          </button>
        </div>

        <div className="relative mt-4">
          <label className="mb-1.5 block text-sm font-medium text-muted">Plate number or heat number</label>
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} placeholder="Type or scan" className={field} autoComplete="off" disabled={!canLog} />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-card shadow-lg">
              {matches.map((p) => (
                <li key={p.lot_no}>
                  <button type="button" onClick={() => { setPicked(p); setQuery(p.ident); setMatches([]); }} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft">
                    <span><span className="font-semibold">{p.ident}</span><span className="ml-2 text-sm text-muted">{p.grade} · {p.size}</span></span>
                    <span className="num text-sm text-muted">{fmt(p.kg)} kg in books</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Weight (kg)</span>
            <input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^0-9.]/g, ""))} className={field + " num"} disabled={!canLog} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Pieces</span>
            <input inputMode="numeric" value={pcs} onChange={(e) => setPcs(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className={field + " num"} disabled={!canLog} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">When it moved</span>
            <input type="datetime-local" value={at} max={maxAt} onFocus={() => setMaxAt(nowIST())} onChange={(e) => setAt(e.target.value)} className={field} disabled={!canLog} /></label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Invoice / vehicle / slip no. (optional)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={field} disabled={!canLog} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={field} disabled={!canLog} /></label>
        </div>

        {error && <p role="alert" className="mt-4 rounded-md bg-bad-soft px-4 py-2.5 text-[0.92rem] text-bad">{error}</p>}
        {flash?.ok && (
          <p role="status" className={"mt-4 flex items-center gap-2 rounded-md px-4 py-2.5 text-[0.92rem] " + (flash.status === "active" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
            {flash.status === "active" ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
            {flash.ident}: {flash.status === "active" ? "logged. It will be taken out of this plate's count automatically." : "saved, but this plate is not in the books. It is on the review list until someone identifies it."}
          </p>
        )}
        <button type="button" onClick={submit} disabled={!canLog || pending || !query.trim() || !(Number(kg) > 0)}
          className="mt-5 w-full rounded-md bg-ink py-4 text-[1.05rem] font-semibold text-surface transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
          {pending ? "Saving…" : "Save movement"}
        </button>
        {!canLog && <p className="mt-3 text-sm text-muted">Your account can view movements but not log them.</p>}
      </section>

      <section className="rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(24,34,45,0.04)] xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="font-display font-bold">Logged during this count</h2>
          <span className="num text-[0.82rem] text-muted"><span className="font-semibold text-accent">{fmt(totalOut)} kg out</span> · <span className="font-semibold text-brand">{fmt(totalIn)} kg in</span></span>
        </div>
        {moves.length === 0 ? (
          <p className="px-5 py-12 text-center text-[0.95rem] text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="max-h-[36rem] divide-y divide-line overflow-auto">
            {moves.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <span className={"grid h-8 w-8 shrink-0 place-items-center rounded-md " + (m.direction === "out" ? "bg-accent-soft text-accent" : "bg-brand-soft text-brand")}>
                  {m.direction === "out" ? <ArrowUpFromLine className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.ident} {m.status === "needs_plate" && <span className="ml-1 rounded-sm bg-warn-soft px-1.5 py-0.5 text-[0.7rem] font-semibold text-warn">not in books</span>}</p>
                  <p className="truncate text-[0.8rem] text-muted">{timeIST(m.occurred_at)}{m.reference ? ` · ${m.reference}` : ""}{m.who ? ` · ${m.who}` : ""}</p>
                </div>
                <p className="num font-semibold">{m.direction === "out" ? "−" : "+"}{fmt(Number(m.weight_kg))} kg</p>
                {canLog && (
                  <button type="button" title="Remove this entry" aria-label="Remove this entry" onClick={() => start(async () => { const r = await rejectWindowMove(m.id); if (!r.ok) setError(r.error); })}
                    className="rounded-md p-2 text-muted hover:bg-surface hover:text-bad"><Trash2 className="h-4 w-4" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
