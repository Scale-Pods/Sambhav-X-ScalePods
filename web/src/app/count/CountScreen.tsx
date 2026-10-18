"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, MapPin, Plus, Trash2 } from "lucide-react";

export type CountPlate = { lot_no: number; ident: string; grade: string; size: string; kg: number; pcs: number; book: string };
type Line = { plate: CountPlate | null; ident: string; kg: number; pcs: number; yard: string };

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

export function CountScreen({ plates }: { plates: CountPlate[] }) {
  const [yard, setYard] = useState("D15");
  const [who, setWho] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CountPlate | null>(null);
  const [kg, setKg] = useState("");
  const [pcs, setPcs] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const matches = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (t.length < 2 || picked) return [];
    return plates.filter((p) => p.ident.toLowerCase().includes(t)).slice(0, 6);
  }, [query, picked, plates]);

  const add = () => {
    const w = Number(kg);
    if (!query.trim() || !w) return;
    setLines((l) => [{ plate: picked, ident: picked?.ident ?? query.trim().toUpperCase(), kg: w, pcs: Number(pcs) || 1, yard }, ...l]);
    setQuery(""); setPicked(null); setKg(""); setPcs("");
  };

  const counted = lines.reduce((s, l) => s + l.kg, 0);
  const field = "w-full rounded-xl border border-line bg-white px-4 py-3.5 text-lg focus:border-brand";

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <section className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-muted">Yard</span>
              <div className="grid grid-cols-3 gap-2">
                {["D15", "753", "Other"].map((y) => (
                  <button key={y} type="button" onClick={() => setYard(y)} className={"flex items-center justify-center gap-1.5 rounded-xl py-3.5 text-lg font-semibold ring-1 ring-inset " + (yard === y ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line hover:bg-surface")}>
                    <MapPin className="h-4 w-4" />{y}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-muted">Counted by</span>
              <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Your name" className={field} />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
          <h2 className="text-lg font-semibold">Count a plate</h2>
          <div className="relative mt-4">
            <label className="mb-1.5 block text-sm font-medium text-muted">Plate number or heat number</label>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} placeholder="Type or scan, for example QY5598" className={field} autoComplete="off" />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                {matches.map((p) => (
                  <li key={p.lot_no}>
                    <button type="button" onClick={() => { setPicked(p); setQuery(p.ident); setKg(String(Math.round(p.kg))); setPcs(String(p.pcs)); }} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft">
                      <span><span className="font-semibold">{p.ident}</span><span className="ml-2 text-sm text-muted">{p.grade} · {p.size}</span></span>
                      <span className="num text-sm text-muted">books say {fmt(p.kg)} kg</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {picked && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-[0.92rem] text-ok">
              <CheckCircle2 className="h-4 w-4" /> Found in the books: {picked.grade}, {picked.size} mm, {fmt(picked.kg)} kg, {picked.pcs} pcs
            </div>
          )}
          {!picked && query.trim().length >= 4 && matches.length === 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-[0.92rem] text-warn">
              <CircleAlert className="h-4 w-4" /> Not in the books. You can still count it; it goes to review as a plate we did not know about.
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Weight counted (kg)</span>
              <input inputMode="numeric" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className={field + " num"} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-medium text-muted">Pieces</span>
              <input inputMode="numeric" value={pcs} onChange={(e) => setPcs(e.target.value.replace(/[^0-9]/g, ""))} placeholder="1" className={field + " num"} /></label>
          </div>
          <button type="button" onClick={add} disabled={!query.trim() || !Number(kg)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-4 text-lg font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40">
            <Plus className="h-5 w-5" /> Add to count
          </button>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(18,41,58,0.04)] xl:col-span-2">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-semibold">Counted this session</h2>
          <span className="num rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-dark">{lines.length} plates · {fmt(counted)} kg</span>
        </div>
        {lines.length === 0 ? (
          <p className="px-5 py-12 text-center text-[0.95rem] text-muted">Plates you count appear here, with the difference from the books.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l, i) => {
              const diff = l.plate ? l.kg - l.plate.kg : null;
              return (
                <li key={i} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.ident} <span className="text-sm font-normal text-muted">· {l.yard}</span></p>
                    <p className="num text-sm text-muted">{l.plate ? `books ${fmt(l.plate.kg)} kg` : "not in the books"}</p>
                  </div>
                  <div className="text-right">
                    <p className="num font-semibold">{fmt(l.kg)} kg</p>
                    <p className={"num text-sm font-medium " + (diff == null ? "text-warn" : Math.abs(diff) < 1 ? "text-ok" : "text-bad")}>
                      {diff == null ? "new" : Math.abs(diff) < 1 ? "matches" : (diff > 0 ? "+" : "−") + fmt(Math.abs(diff)) + " kg"}
                    </p>
                  </div>
                  <button type="button" onClick={() => setLines((x) => x.filter((_, j) => j !== i))} aria-label="Remove" className="rounded-lg p-2 text-muted hover:bg-surface hover:text-bad"><Trash2 className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
