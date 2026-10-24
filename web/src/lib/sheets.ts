import "server-only";
import { q, qTx } from "./db";

// The live, read-only copy of the client's Google Sheets (filled once a day and on request by tools/sync/sheets_sync.py).
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
  const rows = await q<SheetSource>(`
    select s.key, s.name, s.spreadsheet_id, s.active, s.tabs, s.last_synced_at, s.last_modified_at, s.last_error, 0 rows
    from public.sheet_sources s where s.key = $1`, [key]);
  return rows[0] ?? null;
}

/** Row counts per tab, for the tab bar (worked out at each sync, migration 23). */
export async function tabCounts(key: string) {
  const rows = await q<{ tab: string; n: number }>(`select tab, all_rows n from public.v_sheet_tab_meta where source_key = $1`, [key]);
  return Object.fromEntries(rows.map((r) => [r.tab, r.n])) as Record<string, number>;
}

const PAGE = 100;

export type TabData = { header: SheetRow | null; frozen: SheetRow[]; rows: SheetRow[]; total: number; page: number; pages: number; size: number; width: number };

/**
 * One tab, the way the sheet shows it. The header row and the frozen rows above it (group labels such as "Client Details") come from the
 * per-tab facts worked out at each sync; the rows follow in sheet order, a page at a time. `search` matches any cell.
 * Everything is read in one transaction, so a tab costs two quick queries (three when searching).
 */
export async function sheetTab(key: string, tab: string, page: number, search: string): Promise<TabData> {
  return qTx(async (q) => {
    const [m] = await q<{ header_row: number | null; frozen: SheetRow[]; total: number; width: number }>(
      `select header_row, frozen, total, width from public.v_sheet_tab_meta where source_key = $1 and tab = $2`, [key, tab]);
    if (!m) return { header: null, frozen: [], rows: [], total: 0, page: 1, pages: 1, size: PAGE, width: 1 };
    const after = m.header_row ?? 0;
    const like = search ? `%${search.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
    let total = m.total;
    if (like) {
      const [s] = await q<{ total: number }>(
        `select count(*)::int total from public.sheet_rows where source_key = $1 and tab = $2 and deleted_at is null and row_no > $3 and cells::text ilike $4`, [key, tab, after, like]);
      total = s.total;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.max(1, Math.min(page, pages));
    const rows = await q<SheetRow>(
      `select row_no, cells, links from public.sheet_rows
       where source_key = $1 and tab = $2 and deleted_at is null and row_no > $3 and ($4::text is null or cells::text ilike $4)
       order by row_no limit ${PAGE} offset $5`,
      [key, tab, after, like, (p - 1) * PAGE]);
    const header = m.header_row == null ? null : (m.frozen.find((r) => r.row_no === m.header_row) ?? null);
    return { header, frozen: m.frozen, rows, total, page: p, pages, size: PAGE, width: Math.max(m.width, 1) };
  });
}
