"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Lock, MapPin, Plus, Trash2 } from "lucide-react";
import { closeCount, recordCountLine, rejectCountLine, searchPlates, type CountResult, type Plate } from "./actions";

export type Line = {
  id: string; ident: string; match_status: string; weight_kg: string; pieces: string | null; books_kg: string | null;
  yard: string | null; counted_at: string; who: string | null; lot_no: string | null; grade: string | null;
};

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

export function CountScreen({ sessionId, book, lines, canClose, canCount }: { sessionId: string; book: string; lines: Line[]; canClose: boolean; canCount: boolean }) {
  const [yard, setYard] = useState("D15");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Plate | null>(null);
  const [matches, setMatches] = useState<Plate[]>([]);
  const [kg, setKg] = useState("");
  const [pcs, setPcs] = useState("");
  const [flash, setFlash] = useState<CountResult | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (picked || query.trim().length < 2) { setMatches([]); return; }
    timer.current = setTimeout(async () => setMatches(await searchPlates(book, query)), 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, picked, book]);

  const submit = () => {
    setError(""); setFlash(null);
    start(async () => {
      const r = await recordCountLine(sessionId, query.trim(), Number(kg), Number(pcs || 1), yard);
      if (r.ok) { setFlash(r); setQuery(""); setPicked(null); setKg(""); setPcs(""); setMatches([]); }
      else setError(r.error);
    });
  };

  const counted = lines.reduce((s, l) => s + Number(l.weight_kg), 0);
  const field = "w-full rounded-xl border border-line bg-white px-4 py-3.5 text-lg focus:border-brand";
  const ready = canCount && query.trim().length > 0 && Number(kg) >= 0 && kg !== "";

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <section className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
          <span className="mb-1.5 block text-sm font-medium text-muted">Yard</span>
          <div className="grid grid-cols-3 gap-2">
            {["D15", "753", "Other"].map((y) => (
              <button key={y} type="button" onClick={() => setYard(y)} className={"flex items-center justify-center gap-1.5 rounded-xl py-3.5 text-lg font-semibold ring-1 ring-inset " + (yard === y ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line hover:bg-surface")}>
                <MapPin className="h-4 w-4" />{y}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
          <h2 className="text-lg font-semibold">Count a plate <span className="text-sm font-normal text-muted">· {book}</span></h2>
          <div className="relative mt-4">
            <label className="mb-1.5 block text-sm font-medium text-muted">Plate number or heat number</label>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} placeholder="Type or scan, for example QY5598" className={field} autoComplete="off" disabled={!canCount} />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                {matches.map((p) => (
                  <li key={p.lot_no}>
                    <button type="button" onClick={() => { setPicked(p); setQuery(p.ident); setKg(String(Math.round(p.kg))); setPcs(String(p.pcs || 1)); setMatches([]); }} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft">
                      <span><span className="font-semibold">{p.ident}</span><span className="ml-2 text-sm text-muted">{p.grade} · {p.size}</span></span>
                      <span className="num text-sm text-muted">books say {fmt(p.kg)} kg</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {picked && <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-[0.92rem] text-ok"><CheckCircle2 className="h-4 w-4" /> In the books: {picked.grade}, {picked.size} mm. Weigh it and type what you actually see.</div>}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Weight counted (kg)</span>
              <input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className={field + " num"} disabled={!canCount} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Pieces</span>
              <input inputMode="numeric" value={pcs} onChange={(e) => setPcs(e.target.value.replace(/[^0-9]/g, ""))} placeholder="1" className={field + " num"} disabled={!canCount} /></label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-[0.92rem] text-bad">{error}</p>}
          {flash?.ok && (
            <p role="status" className={"mt-4 flex items-center gap-2 rounded-lg px-4 py-2.5 text-[0.92rem] " + (flash.match_status === "matched" ? "bg-emerald-50 text-ok" : "bg-amber-50 text-warn")}>
              {flash.match_status === "matched" ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
              {flash.ident}: {flash.match_status === "matched" ? "saved, matches the books" : flash.match_status === "discrepancy" ? `saved, books say ${fmt(flash.books_kg ?? 0)} kg (difference ${fmt(Math.abs(flash.kg - (flash.books_kg ?? 0)))} kg, goes to review)` : "saved, but this plate is not in the books (goes to review)"}
            </p>
          )}
          <button type="button" onClick={submit} disabled={!ready || pending} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-4 text-lg font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40">
            <Plus className="h-5 w-5" /> {pending ? "Saving…" : "Save this count"}
          </button>
          {!canCount && <p className="mt-3 text-sm text-muted">Your account can view the count but not enter it.</p>}
        </section>
      </div>

      <section className="rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(18,41,58,0.04)] xl:col-span-2">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-semibold">Counted so far</h2>
          <span className="num rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-dark">{lines.length} plates · {fmt(counted)} kg</span>
        </div>
        {lines.length === 0 ? (
          <p className="px-5 py-12 text-center text-[0.95rem] text-muted">Nothing counted yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l) => {
              const books = l.books_kg == null ? null : Number(l.books_kg);
              const diff = books == null ? null : Number(l.weight_kg) - books;
              return (
                <li key={l.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.ident} <span className="text-sm font-normal text-muted">· {l.yard ?? "-"}</span></p>
                    <p className="truncate text-sm text-muted">{l.who ?? "-"} · {new Date(l.counted_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <div className="text-right">
                    <p className="num font-semibold">{fmt(Number(l.weight_kg))} kg</p>
                    <p className={"num text-sm font-medium " + (l.match_status === "matched" ? "text-ok" : l.match_status === "unmatched" ? "text-warn" : "text-bad")}>
                      {l.match_status === "matched" ? "matches" : l.match_status === "unmatched" ? "not in books" : `${(diff ?? 0) > 0 ? "+" : "−"}${fmt(Math.abs(diff ?? 0))} kg`}
                    </p>
                  </div>
                  <button type="button" aria-label="Remove this entry" title="Remove this entry" onClick={() => start(async () => { const r = await rejectCountLine(l.id); if (!r.ok) setError(r.error); })} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-bad"><Trash2 className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
        {canClose && (
          <div className="border-t border-line p-4">
            <button type="button" disabled={pending} onClick={() => { if (confirm("Close this count? Nobody can add entries after this. It goes to review.")) start(async () => { const r = await closeCount(sessionId); if (!r.ok) setError(r.error); }); }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 font-semibold text-ink hover:bg-surface">
              <Lock className="h-4 w-4" /> Close this count
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
