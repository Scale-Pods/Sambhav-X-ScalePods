// One filter model for every stock page. It lives in the address bar, so a view can be bookmarked or shared.
// Shared by server pages (to query) and the client filter bar (to edit).

export type Preset = "today" | "7d" | "15d" | "30d" | "90d" | "month" | "lastmonth" | "fy" | "lastfy" | "all" | "custom";
export type Unit = "t" | "kg";

export type Filter = {
  preset: Preset;
  from: string | null; // yyyy-mm-dd, inclusive; null = no lower bound
  to: string | null; // yyyy-mm-dd, inclusive; null = no upper bound
  book: string | null;
  grades: string[];
  tmin: number | null;
  tmax: number | null;
  unit: Unit;
};

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "15d", label: "Last 15 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "fy", label: "This financial year" },
  { id: "lastfy", label: "Last financial year" },
  { id: "all", label: "All time" },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Today's date in India, whatever the server's clock zone. */
export function todayIST(): string {
  return iso(new Date(Date.now() + 5.5 * 3600 * 1000));
}

function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Financial year (1 April - 31 March) that contains the given day. */
export function fyOf(day: string): { start: string; end: string; label: string } {
  const [y, m] = day.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31`, label: `FY ${startYear}-${String(startYear + 1).slice(2)}` };
}

export function rangeFor(preset: Preset, today = todayIST()): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "15d": return { from: addDays(today, -14), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "90d": return { from: addDays(today, -89), to: today };
    case "month": return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: today };
    case "lastmonth": {
      const first = new Date(Date.UTC(y, m - 2, 1));
      const last = new Date(Date.UTC(y, m - 1, 0));
      return { from: iso(first), to: iso(last) };
    }
    case "fy": return { from: fyOf(today).start, to: today };
    case "lastfy": { const prev = fyOf(addDays(fyOf(today).start, -1)); return { from: prev.start, to: prev.end }; }
    default: return { from: null, to: null };
  }
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Read the filter from the address. `fallback` is the page's default period. */
export function parseFilter(sp: SP, fallback: Preset = "fy", today?: string | null): Filter {
  const p = one(sp.p) as Preset | undefined;
  const preset: Preset = p && (PRESETS.some((x) => x.id === p) || p === "custom") ? p : fallback;
  // `today === null` means "the clock is not known yet" (the server pass of a browser component): no date range until it is
  let { from, to } = today === null ? { from: null, to: null } : rangeFor(preset, today);
  if (preset === "custom") {
    const f = one(sp.from), t = one(sp.to);
    from = f && ISO.test(f) ? f : null;
    to = t && ISO.test(t) ? t : null;
    if (from && to && from > to) [from, to] = [to, from];
  }
  const book = one(sp.book);
  const g = one(sp.g);
  const num = (v?: string) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    preset, from, to,
    book: book === "WB1" || book === "WB2" ? book : null,
    grades: g ? g.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 20) : [],
    tmin: num(one(sp.tmin)),
    tmax: num(one(sp.tmax)),
    unit: one(sp.u) === "kg" ? "kg" : "t",
  };
}

/** The same filter written back as address parameters (defaults left out to keep links short). */
export function filterParams(f: Filter, fallback: Preset = "fy"): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.preset !== fallback) out.p = f.preset;
  if (f.preset === "custom") { if (f.from) out.from = f.from; if (f.to) out.to = f.to; }
  if (f.book) out.book = f.book;
  if (f.grades.length) out.g = f.grades.join("|");
  if (f.tmin != null) out.tmin = String(f.tmin);
  if (f.tmax != null) out.tmax = String(f.tmax);
  if (f.unit === "kg") out.u = "kg";
  return out;
}

/** The period just before this one, the same length, for "vs previous period". */
export function previousRange(f: Filter): { from: string; to: string } | null {
  if (!f.from || !f.to) return null;
  const days = Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1;
  return { from: addDays(f.from, -days), to: addDays(f.from, -1) };
}

const fmtDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function periodLabel(f: Filter, today?: string | null): string {
  if (f.preset === "fy" && today !== null) return fyOf(today ?? todayIST()).label;
  if (f.preset !== "custom") return PRESETS.find((p) => p.id === f.preset)?.label ?? "";
  if (f.from && f.to) return `${fmtDay(f.from)} – ${fmtDay(f.to)}`;
  if (f.from) return `From ${fmtDay(f.from)}`;
  if (f.to) return `Up to ${fmtDay(f.to)}`;
  return "All time";
}

export function rangeLabel(f: Filter): string {
  if (!f.from && !f.to) return "all dates";
  if (f.from && f.to) return `${fmtDay(f.from)} – ${fmtDay(f.to)}`;
  return f.from ? `from ${fmtDay(f.from)}` : `up to ${fmtDay(f.to!)}`;
}

/** Weight in the chosen unit. */
export function weight(kg: number | string | null | undefined, unit: Unit, digits = unit === "t" ? 1 : 0): string {
  if (kg == null) return "-";
  const v = Number(kg) / (unit === "t" ? 1000 : 1);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}
export const unitLabel = (u: Unit) => (u === "t" ? "t" : "kg");

/** Plates and Needs-review open on all dates (a period would hide older stock); Overview and Summary open on this FY. */
export function pageDefault(pathname: string): Preset {
  return pathname.startsWith("/plates") || pathname.startsWith("/stock-check") || pathname.startsWith("/review") || pathname.startsWith("/mail/inbox") || pathname.startsWith("/mail/clients") ? "all" : "fy";
}

export const FILTER_KEYS = ["p", "from", "to", "book", "g", "tmin", "tmax", "u"] as const;
