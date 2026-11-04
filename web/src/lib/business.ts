import "server-only";
import { cache } from "react";
import { q } from "./db";
import { kpis, summary } from "./analytics";
import { mailOverview } from "./mail";
import { orderOverview, vehiclesOverview, type OrderParams } from "./orders";
import { payOverview, type PayParams } from "./payments";
import { countSessions } from "./queries";
import { compare, tallyStatus, type TallyEntity } from "./tally";
import type { Filter } from "./filters";

// What the Business overview reads. Each loader is cached for the request, so the headline strip, the attention list and the section that
// shows the same figures share one query instead of asking twice. The arguments are turned into text so that React's cache can match them.

// The database connections are few (6 per server) and the page asks for a lot at once, so at most three of its questions run at the same time; the rest
// wait their turn here instead of waiting for a connection (which gives up after 8 seconds) and failing the part of the page that asked.
const LIMIT = 3;
let active = 0;
const waiting: (() => void)[] = [];
export async function gated<T>(run: () => Promise<T>): Promise<T> {
  if (active >= LIMIT) await new Promise<void>((go) => waiting.push(go));
  active++;
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const keyed = <A, R>(run: (a: A) => Promise<R>) => {
  const c = cache((k: string) => gated(() => run(JSON.parse(k) as A)));
  return (a: A) => c(JSON.stringify(a));
};

export const loadStock = keyed((f: Filter) => kpis(f));
export const loadPay = keyed((p: PayParams) => payOverview(p));
export const loadOrders = keyed((p: OrderParams) => orderOverview(p));
export const loadVehicles = keyed((p: OrderParams) => vehiclesOverview(p));
export const loadMail = keyed((f: Filter) => mailOverview(f));
export const loadTallyStatus = keyed((e: TallyEntity) => tallyStatus(e));
/** The Tally company the home page shows: Sai when Sai is chosen, otherwise Sambhav (SPF). */
export const tallyEntityOf = (e: "SPF" | "SAI" | null): TallyEntity => (e === "SAI" ? "SAI" : "SPF");

/** Tally against the sheets: customers and vendors the two sides agree on, and the gap. (The sheet side is the same company's payment sheet.) */
export const loadTallyGap = keyed(async (entity: TallyEntity) => {
  const p = { q: "", page: 1, show: "all", group: "all", entity, summaryOnly: true };
  const rec = await compare("receivable", p); // one after the other: each matching is a heavy question
  const pay = await compare("payable", p);
  return { rec: rec.summary, pay: pay.summary };
});

/** Grades and thicknesses whose balance has gone below zero (more sold than bought), as of today. */
export const loadNegatives = cache(() => gated(async () => {
  const rows = await summary({ preset: "all", from: null, to: null, book: null, grades: [], tmin: null, tmax: null, unit: "t" }, null);
  return rows.filter((r) => r.closing < -0.5).length;
}));

/** Things waiting for a person, in the Control section of the sidebar, plus the physical count and the mill orders. */
export const loadControl = cache(() => gated(async () => {
  const [c] = await q<{ decide: number; old_notes: number; docs_review: number; docs_failed: number; drafts: number }>(`
    select (select count(*) from public.exceptions where status = 'open' and not (kind::text = 'legacy_data' and severity::text <> 'error'))::int decide,
           (select count(*) from public.exceptions where status = 'open' and kind::text = 'legacy_data' and severity::text <> 'error')::int old_notes,
           (select count(*) from public.documents where review_status = 'pending' and extraction_status in ('pending', 'needs_review') and duplicate_of is null)::int docs_review,
           (select count(*) from public.documents where extraction_status = 'failed' and review_status = 'pending')::int docs_failed,
           (select count(*) from public.drafts where status = 'open')::int drafts`);
  const [mill] = await q<{ lines: number; open_lines: number; pending_kg: number }>(`
    select count(*)::int lines, (count(*) filter (where coalesce(pending_kg, 0) > 0))::int open_lines, coalesce(sum(pending_kg) filter (where pending_kg > 0), 0)::float8 pending_kg from public.mill_po_lines`);
  const sessions = await countSessions();
  return { ...c, mill, session: sessions[0] ?? null };
}));

export type Attention = { tone: "bad" | "warn" | "info"; text: string; href: string };
