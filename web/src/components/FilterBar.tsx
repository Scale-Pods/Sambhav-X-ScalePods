"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useToday } from "./useToday";
import { Calendar, Check, ChevronDown, Layers, Ruler, Search, X } from "lucide-react";
import { FILTER_KEYS, PRESETS, filterParams, pageDefault, parseFilter, periodLabel, rangeFor, type Filter, type Preset } from "@/lib/filters";

const PendingCtx = createContext(false);

/** Wraps a page: the filter bar on top, the content underneath. While new data loads the old view stays, dimmed. */
export function FilterShell({ grades, children, extra, hide = [] }: { grades: string[]; children: ReactNode; extra?: ReactNode; hide?: ("book" | "grade" | "thickness" | "unit")[] }) {
  const [pending, start] = useTransition();
  return (
    <PendingCtx.Provider value={pending}>
      <FilterBar grades={grades} start={start} extra={extra} hide={hide} />
      <div className={"transition-opacity duration-150 " + (pending ? "pointer-events-none opacity-55" : "")} aria-busy={pending}>{children}</div>
    </PendingCtx.Provider>
  );
}

export const usePending = () => useContext(PendingCtx);

function useFilterNav(start: (fn: () => void) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const fallback = pageDefault(pathname);
  const today = useToday();
  const current = useMemo(() => parseFilter(Object.fromEntries(sp.entries()), fallback, today), [sp, fallback, today]);
  const go = (next: Filter) => {
    const keep = new URLSearchParams(sp.toString());
    FILTER_KEYS.forEach((k) => keep.delete(k));
    keep.delete("page"); // a new filter starts again at page 1
    Object.entries(filterParams(next, fallback)).forEach(([k, v]) => keep.set(k, v));
    const qs = keep.toString();
    start(() => router.replace(pathname + (qs ? "?" + qs : ""), { scroll: false }));
  };
  return { current, go, fallback, today };
}

function FilterBar({ grades, start, extra, hide }: { grades: string[]; start: (fn: () => void) => void; extra?: ReactNode; hide: string[] }) {
  const { current: f, go, fallback, today } = useFilterNav(start);
  const chips: { label: string; clear: () => void }[] = [];
  if (f.preset !== fallback) chips.push({ label: periodLabel(f, today), clear: () => go({ ...f, preset: fallback, ...rangeFor(fallback) }) });
  if (f.book) chips.push({ label: f.book, clear: () => go({ ...f, book: null }) });
  f.grades.forEach((g) => chips.push({ label: g, clear: () => go({ ...f, grades: f.grades.filter((x) => x !== g) }) }));
  if (f.tmin != null || f.tmax != null) chips.push({ label: `${f.tmin ?? 0}–${f.tmax ?? "∞"} mm`, clear: () => go({ ...f, tmin: null, tmax: null }) });

  const seg = (on: boolean) => "px-3 py-1.5 text-[0.85rem] font-medium transition-colors " + (on ? "bg-ink text-surface" : "text-muted hover:text-ink");
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker f={f} go={go} today={today} />
        {!hide.includes("book") && (
          <div className="flex overflow-hidden rounded-md border border-line bg-field" role="group" aria-label="Stock book">
            {[null, "WB1", "WB2"].map((b) => (
              <button key={b ?? "all"} type="button" onClick={() => go({ ...f, book: b })} aria-pressed={f.book === b} className={seg(f.book === b)}>{b ?? "Both books"}</button>
            ))}
          </div>
        )}
        {!hide.includes("grade") && <GradePicker f={f} go={go} grades={grades} />}
        {!hide.includes("thickness") && <ThicknessPicker f={f} go={go} />}
        {!hide.includes("unit") && (
          <div className="flex overflow-hidden rounded-md border border-line bg-field" role="group" aria-label="Units">
            <button type="button" onClick={() => go({ ...f, unit: "t" })} aria-pressed={f.unit === "t"} className={seg(f.unit === "t")}>Tonnes</button>
            <button type="button" onClick={() => go({ ...f, unit: "kg" })} aria-pressed={f.unit === "kg"} className={seg(f.unit === "kg")}>kg</button>
          </div>
        )}
        {extra}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={c.clear} className="flex items-center gap-1 rounded-md bg-accent-soft px-2.5 py-1 text-[0.8rem] font-medium text-ink hover:bg-accent hover:text-white" title="Remove this filter">
              {c.label} <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <button type="button" onClick={() => go({ ...f, preset: fallback, ...rangeFor(fallback), book: null, grades: [], tmin: null, tmax: null })} className="text-[0.8rem] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, ref };
}

const trigger = "flex items-center gap-2 rounded-md border border-line bg-field px-3 py-1.5 text-[0.85rem] font-medium hover:border-muted/50";
const panel = "absolute left-0 top-full z-30 mt-1.5 rounded-lg border border-line bg-card p-1.5 shadow-xl";

function PeriodPicker({ f, go, today }: { f: Filter; go: (f: Filter) => void; today: string | null }) {
  const { open, setOpen, ref } = usePopover();
  const [from, setFrom] = useState(f.from ?? "");
  const [to, setTo] = useState(f.to ?? "");
  useEffect(() => { setFrom(f.from ?? ""); setTo(f.to ?? ""); }, [f.from, f.to]);
  const pick = (p: Preset) => { go({ ...f, preset: p, ...rangeFor(p) }); setOpen(false); };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={trigger + " min-w-48"}>
        <Calendar className="h-4 w-4 text-muted" /> {periodLabel(f, today)} <ChevronDown className="ml-auto h-4 w-4 text-muted" />
      </button>
      {open && (
        <div className={panel + " w-72"} role="listbox" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={f.preset === p.id} onClick={() => pick(p.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[0.88rem] hover:bg-surface">
              {p.label} {f.preset === p.id && <Check className="h-4 w-4 stroke-[3] text-accent" />}
            </button>
          ))}
          <div className="mt-1.5 border-t border-line px-2 pb-1.5 pt-2.5">
            <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Custom range</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[0.75rem] text-muted">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem] text-ink" /></label>
              <label className="text-[0.75rem] text-muted">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem] text-ink" /></label>
            </div>
            <button type="button" disabled={!from && !to} onClick={() => { go({ ...f, preset: "custom", from: from || null, to: to || null }); setOpen(false); }}
              className="mt-2.5 w-full rounded-md bg-ink py-2 text-[0.85rem] font-semibold text-surface hover:bg-accent hover:text-white disabled:opacity-40">
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GradePicker({ f, go, grades }: { f: Filter; go: (f: Filter) => void; grades: string[] }) {
  const { open, setOpen, ref } = usePopover();
  const [term, setTerm] = useState("");
  const shown = grades.filter((g) => g.toLowerCase().includes(term.toLowerCase())).slice(0, 60);
  const toggle = (g: string) => go({ ...f, grades: f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g] });
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={trigger}>
        <Layers className="h-4 w-4 text-muted" /> {f.grades.length ? `Grades · ${f.grades.length}` : "All grades"} <ChevronDown className="h-4 w-4 text-muted" />
      </button>
      {open && (
        <div className={panel + " w-80"}>
          <div className="relative m-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find a grade" className="w-full rounded-md border border-line bg-field py-1.5 pl-8 pr-2 text-[0.85rem]" />
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {shown.map((g) => (
              <li key={g}>
                <button type="button" onClick={() => toggle(g)} aria-pressed={f.grades.includes(g)} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[0.85rem] hover:bg-surface">
                  <span className={"grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border " + (f.grades.includes(g) ? "border-accent bg-accent text-white" : "border-line bg-field")}>
                    {f.grades.includes(g) && <Check className="h-3 w-3 stroke-[3]" />}
                  </span>
                  {g}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-[0.85rem] text-muted">No grade matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThicknessPicker({ f, go }: { f: Filter; go: (f: Filter) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [min, setMin] = useState(f.tmin?.toString() ?? "");
  const [max, setMax] = useState(f.tmax?.toString() ?? "");
  useEffect(() => { setMin(f.tmin?.toString() ?? ""); setMax(f.tmax?.toString() ?? ""); }, [f.tmin, f.tmax]);
  const apply = () => { go({ ...f, tmin: min ? Number(min) : null, tmax: max ? Number(max) : null }); setOpen(false); };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={trigger}>
        <Ruler className="h-4 w-4 text-muted" /> {f.tmin != null || f.tmax != null ? `${f.tmin ?? 0}–${f.tmax ?? "∞"} mm` : "Any thickness"} <ChevronDown className="h-4 w-4 text-muted" />
      </button>
      {open && (
        <form className={panel + " w-60 p-3"} onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Thickness (mm)</p>
          <div className="grid grid-cols-2 gap-2">
            <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="From" className="rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem]" />
            <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="To" className="rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem]" />
          </div>
          <button className="mt-2.5 w-full rounded-md bg-ink py-2 text-[0.85rem] font-semibold text-surface hover:bg-accent hover:text-white">Apply</button>
        </form>
      )}
    </div>
  );
}

/** A page-specific choice that lives in the address next to the filters (e.g. "dates apply to: received / sold"). */
export function ParamSelect({ name, value, options, label }: { name: string; value: string; options: { value: string; label: string }[]; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[0.82rem] text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => { const u = new URLSearchParams(sp.toString()); u.set(name, e.target.value); u.delete("page"); start(() => router.replace(pathname + "?" + u.toString(), { scroll: false })); }}
        className="rounded-md border border-line bg-field px-2 py-1.5 text-[0.85rem] font-medium text-ink"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** A search box that lives in the address (?q=). Waits for a pause in typing before it searches. */
export function ParamSearch({ placeholder, value }: { placeholder: string; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [text, setText] = useState(value);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setText(value), [value]);
  const push = (v: string) => {
    const u = new URLSearchParams(sp.toString());
    if (v.trim()) u.set("q", v.trim()); else u.delete("q");
    u.delete("page");
    start(() => router.replace(pathname + (u.toString() ? "?" + u.toString() : ""), { scroll: false }));
  };
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => push(e.target.value), 350); }}
        onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); push(text); } }}
        placeholder={placeholder}
        aria-busy={pending}
        className="w-64 rounded-md border border-line bg-field py-1.5 pl-8 pr-2 text-[0.85rem]"
      />
    </div>
  );
}
