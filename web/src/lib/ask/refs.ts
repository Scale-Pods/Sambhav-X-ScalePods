import "server-only";
import { q } from "../db";

// References: where each fact in an answer was taken from, as a link the person can open to check it. The lookups add a reference for every record they
// return (a row of a Google sheet, or a page of the app) and mark the row with its id (r1, r2 ...). The model only cites those ids; anything else is dropped.

export type Ref = { id: string; label: string; url: string; kind: "sheet" | "app"; note?: string };
type Loc = { source: string; tab: string; row: number }; // where a sheet reference points; the row's text is fetched only for the references an answer cites

export class RefBook {
  private byUrl = new Map<string, Ref>();
  private byId = new Map<string, Ref>();
  readonly locs = new Map<string, Loc>();
  private seq = 0;
  add(label: string, url: string, kind: Ref["kind"], loc?: Loc): string {
    const had = this.byUrl.get(url);
    if (had) return had.id;
    const ref: Ref = { id: `r${++this.seq}`, label, url, kind };
    this.byUrl.set(url, ref); this.byId.set(ref.id, ref);
    if (loc) this.locs.set(ref.id, loc);
    return ref.id;
  }
  get(id: string) { return this.byId.get(id); }
  all() { return [...this.byId.values()]; }
}

/** What the screen needs of a reference: n is the number shown in the answer. */
export type RefView = Ref & { n: number };

/**
 * Check the citations in an answer: keep only ids that a lookup really handed out, written as [r3][r5], and number them in order of first use.
 * An answer that cites nothing still gets the first few references the lookups produced, so there is always somewhere to check.
 */
export async function citeRefs(answer: string, book: RefBook): Promise<{ answer: string; refs: RefView[] }> {
  const order: string[] = [];
  const text = answer.replace(/\[\s*(r\d+(?:\s*[,;]\s*r\d+)*)\s*\]/gi, (_m, list: string) => {
    const ids = list.toLowerCase().split(/[,;]/).map((x) => x.trim()).filter((id) => book.get(id));
    for (const id of ids) if (!order.includes(id)) order.push(id);
    return ids.map((id) => `[${id}]`).join("");
  });
  const cited = order.length > 0;
  const ids = cited ? order : book.all().slice(0, 6).map((r) => r.id);
  const refs = ids.slice(0, 14).map((id, i) => ({ ...(book.get(id) as Ref), n: i + 1 }));
  await addNotes(book, refs);
  return { answer: cited ? text.replace(/\[(r\d+)\]/g, (m, id: string) => (refs.some((r) => r.id === id) ? m : "")) : text, refs };
}

/** The text of each cited sheet row, as a short preview next to its link (one query for all of them). */
async function addNotes(book: RefBook, refs: RefView[]) {
  const want = refs.map((r) => ({ r, loc: book.locs.get(r.id) })).filter((x): x is { r: RefView; loc: Loc } => !!x.loc);
  if (want.length === 0) return;
  try {
    const rows = await q<{ source_key: string; tab: string; row_no: number; cells: string[] }>(
      `select s.source_key, s.tab, s.row_no::int row_no, s.cells from public.sheet_rows s
        join unnest($1::text[], $2::text[], $3::int[]) as w(source_key, tab, row_no) on w.source_key = s.source_key and w.tab = s.tab and w.row_no = s.row_no
       where s.deleted_at is null`, [want.map((x) => x.loc.source), want.map((x) => x.loc.tab), want.map((x) => x.loc.row)]);
    const by = new Map(rows.map((x) => [`${x.source_key}|${x.tab}|${x.row_no}`, x.cells]));
    for (const { r, loc } of want) {
      const text = (by.get(`${loc.source}|${loc.tab}|${loc.row}`) ?? []).filter((c) => c !== "").map((c) => c.replace(/https?:\/\/\S+/g, "(link)")).join(" | ");
      if (text) r.note = text.length > 170 ? text.slice(0, 170) + "…" : text;
    }
  } catch { /* the link works without the preview */ }
}

export type ToolCtx = { refs: RefBook; admin: boolean };

type SheetInfo = { name: string; id: string; gids: Record<string, number> };
let cache: { at: number; map: Map<string, SheetInfo> } | null = null;

async function sheetMap(): Promise<Map<string, SheetInfo>> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.map;
  const rows = await q<{ key: string; name: string; spreadsheet_id: string; tabs: { title: string; gid?: number }[] | null }>(`select key, name, spreadsheet_id, tabs from public.sheet_sources`);
  const map = new Map<string, SheetInfo>();
  for (const r of rows) map.set(r.key, { name: r.name, id: r.spreadsheet_id, gids: Object.fromEntries((r.tabs ?? []).filter((t) => t.gid != null).map((t) => [t.title, t.gid as number])) });
  if (map.size > 0) cache = { at: Date.now(), map };
  return map;
}

/** A link to the exact row of a copied Google sheet (opens the tab with the row selected). Only for people who may read the sheets. */
export async function sheetRef(ctx: ToolCtx, source: string, tab: string, row: number): Promise<string | null> {
  if (!ctx.admin || !Number.isFinite(row) || row < 1) return null;
  const info = (await sheetMap()).get(source);
  if (!info) return null;
  const gid = info.gids[tab];
  const url = `https://docs.google.com/spreadsheets/d/${info.id}/edit${gid != null ? `#gid=${gid}&range=A${row}:Z${row}` : ""}`;
  return ctx.refs.add(`${info.name} › ${tab} › row ${row}`, url, "sheet", { source, tab, row });
}

/** Where in the live sheets these identifiers (plate, heat, invoice or PO numbers) appear: up to 2 rows each, in the given sheets. */
export async function findSheetRows(ctx: ToolCtx, tokens: string[], sources: string[]): Promise<Map<string, { source_key: string; tab: string; row_no: number }[]>> {
  const out = new Map<string, { source_key: string; tab: string; row_no: number }[]>();
  const toks = [...new Set(tokens.map((t) => t.trim()).filter((t) => t.length >= 4))].slice(0, 20);
  if (!ctx.admin || toks.length === 0) return out;
  const rows = await q<{ tok: string; source_key: string; tab: string; row_no: number }>(
    `select t.tok, r.source_key, r.tab, r.row_no::int row_no
       from unnest($1::text[]) as t(tok)
       join lateral (select source_key, tab, row_no from public.sheet_rows x
                      where x.deleted_at is null and x.source_key = any($2::text[]) and x.cells::text ilike '%' || t.tok || '%'
                      order by x.source_key, x.tab, x.row_no limit 2) r on true`, [toks, sources]);
  for (const r of rows) out.set(r.tok, [...(out.get(r.tok) ?? []), r]);
  return out;
}

export const appRef = (ctx: ToolCtx, label: string, path: string) => ctx.refs.add(label, path, "app");
