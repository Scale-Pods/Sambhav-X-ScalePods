import { q } from "./db";
import type { Filter } from "./filters";

const BAL = `bal as (select lot_id, sum(weight_kg) kg, sum(pieces) pcs,
                     sum(weight_kg) filter (where weight_kg > 0) recv,
                     -sum(weight_kg) filter (where weight_kg < 0) sold
              from public.stock_movements group by lot_id)`;

export async function bookTotals() {
  return q<{ book: string; name: string; lots: string; in_stock: string; recv: string; sold: string; kg: string }>(`
    with ${BAL}
    select b.code book, b.name, count(*) lots, count(*) filter (where bal.kg > 0.5) in_stock,
           sum(bal.recv) recv, coalesce(sum(bal.sold), 0) sold, sum(bal.kg) kg
    from public.lots l join public.stock_books b on b.id = l.stock_book_id join bal on bal.lot_id = l.id
    group by b.code, b.name order by b.code`);
}

export async function stockByGrade(limit = 8) {
  return q<{ grade: string; kg: string; lots: string }>(
    `with ${BAL}
    select g.code grade, sum(bal.kg) kg, count(*) filter (where bal.kg > 0.5) lots
    from public.lots l join public.grades g on g.id = l.grade_id join bal on bal.lot_id = l.id
    group by g.code having sum(bal.kg) > 0 order by sum(bal.kg) desc limit $1`,
    [limit],
  );
}

export async function reviewCounts() {
  return q<{ severity: string; n: string }>(
    `select severity::text, count(*) n from public.exceptions where status = 'open' group by 1`,
  );
}

export async function recentSales(limit = 8) {
  return q<{ movement_date: string; weight_kg: string; note: string; lot_no: string; grade: string; ident: string; book: string }>(
    `select m.movement_date, m.weight_kg, m.note, l.lot_no, g.code grade, coalesce(l.plate_no, l.heat_no) ident, b.code book
    from public.stock_movements m join public.lots l on l.id = m.lot_id join public.grades g on g.id = l.grade_id
         join public.stock_books b on b.id = l.stock_book_id
    where m.movement_type = 'sale' order by m.movement_date desc, m.seq desc limit $1`,
    [limit],
  );
}

export async function summaryRows(book: string) {
  return q<{ grade: string; thk: string; recv: string; sold: string; kg: string; plates: string }>(
    `with ${BAL}
    select g.code grade, l.thickness_mm thk, sum(bal.recv) recv, coalesce(sum(bal.sold), 0) sold, sum(bal.kg) kg,
           count(*) filter (where bal.kg > 0.5) plates
    from public.lots l join public.grades g on g.id = l.grade_id join public.stock_books b on b.id = l.stock_book_id
         join bal on bal.lot_id = l.id
    where b.code = $1 group by g.code, l.thickness_mm order by g.code, l.thickness_mm`,
    [book],
  );
}

export type StockFilter = { q?: string; book?: string; all?: boolean; page?: number };

export async function stockList(f: StockFilter, pageSize = 40) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.book) {
    params.push(f.book);
    where.push(`b.code = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.replace(/[^A-Za-z0-9 .\-/]/g, "")}%`);
    const p = `$${params.length}`;
    where.push(`(l.plate_no ilike ${p} or l.heat_no ilike ${p} or g.code ilike ${p} or l.lot_no::text = trim(both '%' from ${p}))`);
  }
  if (!f.all) where.push(`bal.kg > 0.5`);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const page = Math.max(1, f.page ?? 1);
  const rows = await q<{
    lot_no: string; book: string; grade: string; thk: string; wid: string; len: string;
    plate_no: string | null; heat_no: string | null; receipt_date: string; kg: string; pcs: string; total: string;
  }>(
    `with ${BAL}
    select l.lot_no, b.code book, g.code grade, l.thickness_mm thk, l.width_mm wid, l.length_mm len, l.plate_no, l.heat_no,
           l.receipt_date, bal.kg, bal.pcs, count(*) over () total
    from public.lots l join public.grades g on g.id = l.grade_id join public.stock_books b on b.id = l.stock_book_id join bal on bal.lot_id = l.id
    ${w} order by l.receipt_date desc, l.lot_no desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize };
}

export async function lotDetail(lotNo: number) {
  const lot = await q<Record<string, string | null>>(
    `with ${BAL}
    select l.lot_no, b.code book, b.name book_name, g.code grade, l.grade_raw, l.thickness_mm thk, l.width_mm wid, l.length_mm len, l.heat_no, l.plate_no,
           l.receipt_date, l.pieces_received, l.invoice_weight_kg, l.theoretical_weight_kg, l.hsn_code, l.remarks, l.identity_status,
           bal.kg, bal.pcs, bal.recv, bal.sold, l.id
    from public.lots l join public.grades g on g.id = l.grade_id join public.stock_books b on b.id = l.stock_book_id join bal on bal.lot_id = l.id
    where l.lot_no = $1`,
    [lotNo],
  );
  if (!lot[0]) return null;
  const id = lot[0].id;
  const moves = await q<{ movement_date: string; movement_type: string; weight_kg: string; pieces: string; note: string | null }>(
    `select movement_date, movement_type::text, weight_kg, pieces, note from public.stock_movements where lot_id = $1 order by movement_date, seq`,
    [id],
  );
  const issues = await q<{ kind: string; severity: string; message: string; status: string }>(
    `select kind::text, severity::text, message, status from public.exceptions where related_id = $1 order by raised_at`,
    [id],
  );
  const ref = await q<{ source_tab: string; source_row: number; raw: Record<string, string | null> }>(
    `select source_tab, source_row, raw from public.legacy_refs where record_id = $1 limit 1`,
    [id],
  );
  return { lot: lot[0], moves, issues, ref: ref[0] ?? null };
}

export async function reviewList(kind?: string, severity?: string, page = 1, pageSize = 50, f?: Filter) {
  const params: unknown[] = [];
  const where = [`e.status = 'open'`];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f?.book) { const b = p(f.book); where.push(`(bk.code = ${b} or e.message like ${b} || ' %')`); }
  if (f?.grades.length) where.push(`g.code = any(${p(f.grades)}::text[])`);
  if (f?.tmin != null) where.push(`l.thickness_mm >= ${p(f.tmin)}`);
  if (f?.tmax != null) where.push(`l.thickness_mm <= ${p(f.tmax)}`);
  if (f?.from) where.push(`e.raised_at >= ${p(f.from)}::date`);
  if (f?.to) where.push(`e.raised_at < ${p(f.to)}::date + 1`);
  if (kind) {
    params.push(kind);
    where.push(`e.kind::text = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    where.push(`e.severity::text = $${params.length}`);
  }
  const rows = await q<{ id: string; kind: string; severity: string; message: string; related_id: string | null; lot_no: string | null; raised_at: string; total: string }>(
    `select e.id, e.kind::text, e.severity::text, e.message, e.related_id, l.lot_no, e.raised_at, count(*) over () total
    from public.exceptions e left join public.lots l on l.id = e.related_id and e.related_table = 'lots'
         left join public.grades g on g.id = l.grade_id left join public.stock_books bk on bk.id = l.stock_book_id
    where ${where.join(" and ")}
    order by case e.severity::text when 'error' then 0 when 'warning' then 1 else 2 end, e.raised_at, e.message
    limit ${pageSize} offset ${(Math.max(1, page) - 1) * pageSize}`,
    params,
  );
  const kinds = await q<{ kind: string; severity: string; n: string }>(
    `select kind::text, severity::text, count(*) n from public.exceptions where status = 'open' group by 1, 2 order by 3 desc`,
  );
  return { rows, kinds, total: Number(rows[0]?.total ?? 0), pageSize };
}

export type CountSession = { id: string; name: string; status: string; book: string; started_at: string | null; planned_date: string | null; lines: string; kg: string };

export async function countSessions() {
  return q<CountSession>(
    `select s.id, s.name, s.status, b.code book, s.started_at, s.planned_date,
            (select count(*) from public.count_lines c where c.session_id = s.id and c.match_status <> 'rejected') lines,
            (select coalesce(sum(c.weight_kg), 0) from public.count_lines c where c.session_id = s.id and c.match_status <> 'rejected') kg
     from public.count_sessions s join public.stock_books b on b.id = s.stock_book_id
     where s.status in ('counting', 'review') order by s.started_at desc nulls last`,
  );
}

export async function countLines(sessionId: string, limit = 60) {
  return q<{
    id: string; ident: string; match_status: string; weight_kg: string; pieces: string | null; books_kg: string | null; yard: string | null;
    counted_at: string; who: string | null; lot_no: string | null; grade: string | null;
  }>(
    `select c.id, coalesce(c.plate_no, c.heat_no) ident, c.match_status, c.weight_kg, c.pieces, c.counted_at, y.code yard, st.full_name who, l.lot_no, g.code grade,
            -- what the books expect at the moment of counting: ledger balance, adjusted for anything logged as moving during the window
            (select sum(m.weight_kg) from public.stock_movements m where m.lot_id = c.matched_lot_id)
              + coalesce((select sum(case when w.direction = 'in' then w.weight_kg else -w.weight_kg end) from public.count_window_movements w
                          where w.session_id = c.session_id and w.lot_id = c.matched_lot_id and w.status = 'active' and w.occurred_at <= c.counted_at), 0) books_kg
     from public.count_lines c
       left join public.yards y on y.id = c.yard_id left join public.staff st on st.id = c.counted_by
       left join public.lots l on l.id = c.matched_lot_id left join public.grades g on g.id = c.grade_id
     where c.session_id = $1 and c.match_status <> 'rejected' order by c.counted_at desc limit ${limit}`,
    [sessionId],
  );
}

export type WindowMove = {
  id: string; ident: string; direction: "in" | "out"; weight_kg: string; pieces: number; occurred_at: string; reference: string | null;
  note: string | null; status: string; who: string | null; lot_no: string | null; grade: string | null;
};

export async function windowMoves(sessionId: string, limit = 100) {
  return q<WindowMove>(
    `select w.id, w.ident, w.direction, w.weight_kg, w.pieces, w.occurred_at, w.reference, w.note, w.status, st.full_name who, l.lot_no, g.code grade
     from public.count_window_movements w left join public.staff st on st.id = w.entered_by
       left join public.lots l on l.id = w.lot_id left join public.grades g on g.id = l.grade_id
     where w.session_id = $1 and w.status <> 'rejected' order by w.occurred_at desc limit ${limit}`,
    [sessionId],
  );
}

export type ReconRow = {
  lot_id: string; lot_no: string; ident: string; grade: string; thickness_mm: string; books_kg: string; counted_kg: string | null;
  count_lines: number; last_counted_at: string | null; out_before_kg: string; in_before_kg: string; opening_kg: string | null; diff_kg: string | null; status: string;
};

/** Plate-by-plate result of a count, worked back to the moment the window opened (see public.count_reconciliation). */
export async function reconciliation(sessionId: string) {
  const [rows, unknownCounted, unknownMoves] = await Promise.all([
    q<ReconRow>(`select * from public.count_reconciliation($1) order by abs(coalesce(diff_kg, books_kg)) desc`, [sessionId]),
    q<{ ident: string; weight_kg: string; yard: string | null; counted_at: string; who: string | null }>(
      `select coalesce(c.plate_no, c.heat_no) ident, c.weight_kg, y.code yard, c.counted_at, st.full_name who
       from public.count_lines c left join public.yards y on y.id = c.yard_id left join public.staff st on st.id = c.counted_by
       where c.session_id = $1 and c.match_status = 'unmatched' order by c.counted_at desc`, [sessionId]),
    q<{ ident: string; direction: string; weight_kg: string; occurred_at: string; reference: string | null }>(
      `select ident, direction, weight_kg, occurred_at, reference from public.count_window_movements
       where session_id = $1 and status = 'needs_plate' order by occurred_at desc`, [sessionId]),
  ]);
  const n = (v: string | null) => Number(v ?? 0);
  const counted = rows.filter((r) => r.counted_kg != null);
  return {
    rows, unknownCounted, unknownMoves,
    totals: {
      inBooks: rows.filter((r) => n(r.books_kg) > 0.5).length,
      counted: counted.length,
      notCounted: rows.filter((r) => r.status === "not_counted").length,
      matched: rows.filter((r) => r.status === "matched").length,
      short: rows.filter((r) => r.status === "short").length,
      excess: rows.filter((r) => r.status === "excess").length,
      booksKg: rows.reduce((a, r) => a + n(r.books_kg), 0),
      countedBooksKg: counted.reduce((a, r) => a + n(r.books_kg), 0),
      openingKg: counted.reduce((a, r) => a + n(r.opening_kg), 0),
      diffKg: counted.reduce((a, r) => a + n(r.diff_kg), 0),
    },
  };
}
