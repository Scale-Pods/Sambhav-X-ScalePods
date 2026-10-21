import "server-only";
import { q } from "./db";

// The live, read-only copy of the client's Google Sheets (filled every 15 minutes by tools/sync/sheets_sync.py).
// Row-level security lets administrators read it; everyone else gets nothing back.

export type SheetTabMeta = { title: string; hidden: boolean };
export type SheetSource = {
  key: string;
  name: string;
  spreadsheet_id: string;
  active: boolean;
  tabs: SheetTabMeta[] | null;
  last_synced_at: string | null;
  last_modified_at: string | null;
  last_error: string | null;
  rows: number;
};
export type SheetRow = { row_no: number; cells: string[]; links: Record<string, string> | null };

export async function sheetSources() {
  return q<SheetSource>(`
    select s.key, s.name, s.spreadsheet_id, s.active, s.tabs, s.last_synced_at, s.last_modified_at, s.last_error,
           coalesce(r.n, 0)::int rows
    from public.sheet_sources s
    left join (select source_key, count(*) n from public.sheet_rows where deleted_at is null group by 1) r on r.source_key = s.key
    order by s.active desc, s.name`);
}

export async function sheetSource(key: string) {
  return (await sheetSources()).find((s) => s.key === key) ?? null;
}

/** Row counts per tab, for the tab bar. */
export async function tabCounts(key: string) {
  const rows = await q<{ tab: string; n: number }>(
    `select tab, count(*)::int n from public.sheet_rows where source_key = $1 and deleted_at is null group by tab`, [key]);
  return Object.fromEntries(rows.map((r) => [r.tab, r.n])) as Record<string, number>;
}

const PAGE = 200;

/**
 * One tab, the way the sheet shows it. The header row is the top row (of the first six) with the most filled cells; it and the
 * rows above it (group labels such as "Client Details") stay frozen on top. Then the rows in sheet order, a page at a time.
 * `search` matches any cell.
 */
export async function sheetTab(key: string, tab: string, page: number, search: string) {
  const top = await q<SheetRow>(
    `select row_no, cells, links from public.sheet_rows
     where source_key = $1 and tab = $2 and deleted_at is null order by row_no limit 6`, [key, tab]);
  const filled = (r: SheetRow) => r.cells.filter((c) => c !== "").length;
  const header = top.reduce<SheetRow | null>((best, r) => (filled(r) >= 3 && (!best || filled(r) > filled(best)) ? r : best), null);
  const after = header?.row_no ?? 0;
  const frozen = header ? top.filter((r) => r.row_no <= header.row_no).slice(-3) : [];
  const like = search ? `%${search.replace(/[\\%_]/g, (m) => "\\" + m)}%` : null;
  const [stats] = await q<{ total: number; width: number }>(
    `select count(*)::int total, coalesce(max(jsonb_array_length(cells)), 0)::int width from public.sheet_rows
     where source_key = $1 and tab = $2 and deleted_at is null and row_no > $3 and ($4::text is null or cells::text ilike $4)`,
    [key, tab, after, like]);
  const p = Math.max(1, Math.min(page, Math.ceil(stats.total / PAGE) || 1));
  const rows = await q<SheetRow>(
    `select row_no, cells, links from public.sheet_rows
     where source_key = $1 and tab = $2 and deleted_at is null and row_no > $3 and ($4::text is null or cells::text ilike $4)
     order by row_no limit ${PAGE} offset $5`,
    [key, tab, after, like, (p - 1) * PAGE]);
  const width = Math.max(stats.width, ...frozen.map((r) => r.cells.length));
  return { header, frozen, rows, total: stats.total, page: p, pages: Math.max(1, Math.ceil(stats.total / PAGE)), size: PAGE, width };
}
