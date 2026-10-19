import "server-only";
import { q } from "./db";
import { previousRange, todayIST, type Filter } from "./filters";

/** Builds the shared "which plates" condition (book, grades, thickness) and the date-range conditions. */
class Sql {
  params: unknown[] = [];
  p(v: unknown) {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  scope(f: Filter) {
    const w: string[] = [];
    if (f.book) w.push(`b.code = ${this.p(f.book)}`);
    if (f.grades.length) w.push(`g.code = any(${this.p(f.grades)}::text[])`);
    if (f.tmin != null) w.push(`l.thickness_mm >= ${this.p(f.tmin)}`);
    if (f.tmax != null) w.push(`l.thickness_mm <= ${this.p(f.tmax)}`);
    return w.length ? w.join(" and ") : "true";
  }
  /** movement_date inside [from, to]; either end may be open */
  inRange(col: string, from: string | null, to: string | null) {
    return `(${this.p(from)}::date is null or ${col} >= ${this.p(from)}::date) and (${this.p(to)}::date is null or ${col} <= ${this.p(to)}::date)`;
  }
  upTo(col: string, to: string | null) {
    return `(${this.p(to)}::date is null or ${col} <= ${this.p(to)}::date)`;
  }
}

const LOTS = (s: Sql, f: Filter) => `
  lots_in as (select l.id, l.grade_id, l.thickness_mm, l.receipt_date, g.code grade
              from public.lots l join public.grades g on g.id = l.grade_id join public.stock_books b on b.id = l.stock_book_id
              where ${s.scope(f)}),
  mv as (select m.lot_id, m.weight_kg, m.movement_date from public.stock_movements m join lots_in on lots_in.id = m.lot_id)`;

const n = (v: unknown) => Number(v ?? 0);

export async function kpis(f: Filter) {
  const s = new Sql();
  const prev = previousRange(f);
  const rows = await q<Record<string, string>>(`
    with ${LOTS(s, f)},
    asof as (select lot_id, sum(weight_kg) bal from mv where ${s.upTo("movement_date", f.to)} group by lot_id)
    select (select coalesce(sum(bal), 0) from asof) stock,
           (select count(*) from asof where bal > 0.5) plates,
           coalesce(sum(weight_kg) filter (where weight_kg > 0 and ${s.inRange("movement_date", f.from, f.to)}), 0) received,
           coalesce(-sum(weight_kg) filter (where weight_kg < 0 and ${s.inRange("movement_date", f.from, f.to)}), 0) sold,
           coalesce(sum(weight_kg) filter (where weight_kg > 0 and ${s.inRange("movement_date", prev?.from ?? null, prev?.to ?? null)}), 0) prev_received,
           coalesce(-sum(weight_kg) filter (where weight_kg < 0 and ${s.inRange("movement_date", prev?.from ?? null, prev?.to ?? null)}), 0) prev_sold,
           (select count(*) from public.exceptions where status = 'open') review
    from mv`, s.params);
  const r = rows[0];
  return {
    stock: n(r.stock), plates: n(r.plates), received: n(r.received), sold: n(r.sold),
    prevReceived: prev ? n(r.prev_received) : null, prevSold: prev ? n(r.prev_sold) : null, review: n(r.review),
  };
}

export type Bucket = "day" | "week" | "month";

/** Received and sold per day / week / month, plus the closing stock at the end of each. */
export async function timeline(f: Filter) {
  const to = f.to ?? todayIST();
  let from = f.from;
  if (!from) { const d = new Date(to + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 23); from = d.toISOString().slice(0, 8) + "01"; }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const bucket: Bucket = days <= 31 ? "day" : days <= 180 ? "week" : "month";
  const s = new Sql();
  const unit = `${s.p(bucket)}::text`;
  const rows = await q<{ k: string; i: string; o: string; closing: string }>(`
    with ${LOTS(s, f)},
    buckets as (select generate_series(date_trunc(${unit}, ${s.p(from)}::date), date_trunc(${unit}, ${s.p(to)}::date), ('1 ' || ${unit})::interval)::date k),
    per as (select date_trunc(${unit}, movement_date)::date k,
                   sum(weight_kg) filter (where weight_kg > 0) i, -sum(weight_kg) filter (where weight_kg < 0) o
            from mv where ${s.inRange("movement_date", from, to)} group by 1),
    opening as (select coalesce(sum(weight_kg), 0) v from mv where movement_date < ${s.p(from)}::date)
    select to_char(b.k, 'YYYY-MM-DD') k, coalesce(per.i, 0) i, coalesce(per.o, 0) o,
           (select v from opening) + sum(coalesce(per.i, 0) - coalesce(per.o, 0)) over (order by b.k) closing
    from buckets b left join per on per.k = b.k order by b.k`, s.params);
  return { bucket, from, to, clipped: !f.from, points: rows.map((r) => ({ k: r.k, received: n(r.i), sold: n(r.o), closing: n(r.closing) })) };
}

/** Stock left per grade on the end date: top 10, the rest folded into "Other grades". */
export async function stockByGrade(f: Filter) {
  const s = new Sql();
  const rows = await q<{ grade: string; kg: string; plates: string }>(`
    with ${LOTS(s, f)},
    asof as (select lot_id, sum(weight_kg) bal from mv where ${s.upTo("movement_date", f.to)} group by lot_id)
    select li.grade, sum(a.bal) kg, count(*) filter (where a.bal > 0.5) plates
    from asof a join lots_in li on li.id = a.lot_id group by li.grade having sum(a.bal) > 0.5 order by 2 desc`, s.params);
  const top = rows.slice(0, 10).map((r) => ({ grade: r.grade, kg: n(r.kg), plates: n(r.plates) }));
  const rest = rows.slice(10);
  if (rest.length) top.push({ grade: `Other grades (${rest.length})`, kg: rest.reduce((a, r) => a + n(r.kg), 0), plates: rest.reduce((a, r) => a + n(r.plates), 0) });
  return top;
}

export const AGE_BANDS = ["0–30 days", "31–90 days", "91–180 days", "181–365 days", "Over a year"] as const;

/** How long the stock left on the end date has been held. */
export async function ageing(f: Filter) {
  const s = new Sql();
  const to = f.to ?? todayIST();
  const rows = await q<{ band: number; kg: string; plates: string }>(`
    with ${LOTS(s, f)},
    asof as (select lot_id, sum(weight_kg) bal from mv where movement_date <= ${s.p(to)}::date group by lot_id)
    select case when age <= 30 then 0 when age <= 90 then 1 when age <= 180 then 2 when age <= 365 then 3 else 4 end band,
           sum(bal) kg, count(*) plates
    from (select a.bal, (${s.p(to)}::date - li.receipt_date) age from asof a join lots_in li on li.id = a.lot_id where a.bal > 0.5) x
    group by 1 order by 1`, s.params);
  return AGE_BANDS.map((label, i) => {
    const r = rows.find((x) => Number(x.band) === i);
    return { band: label, kg: n(r?.kg), plates: n(r?.plates) };
  });
}

/** Grades sold most in the period. */
export async function topSold(f: Filter) {
  const s = new Sql();
  const rows = await q<{ grade: string; kg: string }>(`
    with ${LOTS(s, f)}
    select li.grade, -sum(m.weight_kg) kg from mv m join lots_in li on li.id = m.lot_id
    where m.weight_kg < 0 and ${s.inRange("m.movement_date", f.from, f.to)}
    group by li.grade order by 2 desc limit 8`, s.params);
  return rows.map((r) => ({ grade: r.grade, kg: n(r.kg) }));
}

/** Tonnes left per grade × thickness on the end date, for the eight biggest grades. */
export async function heatmap(f: Filter) {
  const s = new Sql();
  const rows = await q<{ grade: string; thk: string; kg: string }>(`
    with ${LOTS(s, f)},
    asof as (select lot_id, sum(weight_kg) bal from mv where ${s.upTo("movement_date", f.to)} group by lot_id),
    cell as (select li.grade, li.thickness_mm thk, sum(a.bal) kg from asof a join lots_in li on li.id = a.lot_id
             where a.bal > 0.5 group by 1, 2),
    top as (select grade from cell group by grade order by sum(kg) desc limit 8)
    select c.grade, c.thk, c.kg from cell c join top using (grade) order by c.grade, c.thk`, s.params);
  const grades = [...new Set(rows.map((r) => r.grade))];
  const thicknesses = [...new Set(rows.map((r) => Number(r.thk)))].sort((a, b) => a - b);
  const cells = new Map(rows.map((r) => [`${r.grade}|${Number(r.thk)}`, n(r.kg)]));
  return { grades, thicknesses, cells: Object.fromEntries(cells) };
}

/** Latest sales inside the period. */
export async function recentSales(f: Filter, limit = 8) {
  const s = new Sql();
  return q<{ movement_date: string; weight_kg: string; note: string; lot_no: string; grade: string; ident: string; book: string }>(`
    select m.movement_date, m.weight_kg, m.note, l.lot_no, g.code grade, coalesce(l.plate_no, l.heat_no) ident, b.code book
    from public.stock_movements m join public.lots l on l.id = m.lot_id join public.grades g on g.id = l.grade_id
         join public.stock_books b on b.id = l.stock_book_id
    where m.movement_type = 'sale' and ${s.scope(f)} and ${s.inRange("m.movement_date", f.from, f.to)}
    order by m.movement_date desc, m.seq desc limit ${limit}`, s.params);
}

export type SummaryRow = { grade: string; thk: number; opening: number; received: number; sold: number; closing: number; plates: number };

/**
 * Grade × thickness. Sheet view: everything up to the end date. Period view: opening on the start date,
 * received and sold inside the period, closing on the end date.
 */
export async function summary(f: Filter, book: string | null): Promise<SummaryRow[]> {
  const s = new Sql();
  const ff = { ...f, book: book ?? f.book };
  const rows = await q<Record<string, string>>(`
    with ${LOTS(s, ff)},
    per_lot as (select lot_id,
                  coalesce(sum(weight_kg) filter (where ${s.p(ff.from)}::date is not null and movement_date < ${s.p(ff.from)}::date), 0) opening,
                  coalesce(sum(weight_kg) filter (where weight_kg > 0 and ${s.inRange("movement_date", ff.from, ff.to)}), 0) received,
                  coalesce(-sum(weight_kg) filter (where weight_kg < 0 and ${s.inRange("movement_date", ff.from, ff.to)}), 0) sold,
                  coalesce(sum(weight_kg) filter (where ${s.upTo("movement_date", ff.to)}), 0) closing
                from mv group by lot_id)
    select li.grade, li.thickness_mm thk, sum(opening) opening, sum(received) received, sum(sold) sold, sum(closing) closing,
           count(*) filter (where closing > 0.5) plates
    from per_lot p join lots_in li on li.id = p.lot_id
    group by 1, 2 having sum(abs(opening)) + sum(received) + sum(sold) + sum(abs(closing)) > 0.5
    order by 1, 2`, s.params);
  return rows.map((r) => ({ grade: r.grade, thk: n(r.thk), opening: n(r.opening), received: n(r.received), sold: n(r.sold), closing: n(r.closing), plates: n(r.plates) }));
}

/** Grade names that have plates, for the grade picker. */
export async function gradeOptions() {
  const rows = await q<{ code: string }>(`select distinct g.code from public.lots l join public.grades g on g.id = l.grade_id order by 1`);
  return rows.map((r) => r.code);
}

export type PlateSort = "received_desc" | "received_asc" | "left_desc" | "left_asc" | "thk_asc" | "thk_desc" | "grade";
export type PlateQuery = {
  f: Filter; search?: string; dateOn: "received" | "sold"; status: "instock" | "soldout" | "oversold" | "all";
  cert?: "has" | "none"; sort: PlateSort; page: number; size: number; all?: boolean;
};

const SORTS: Record<PlateSort, string> = {
  received_desc: "l.receipt_date desc, l.lot_no desc", received_asc: "l.receipt_date asc, l.lot_no asc",
  left_desc: "bal.kg desc", left_asc: "bal.kg asc", thk_asc: "l.thickness_mm asc, g.code", thk_desc: "l.thickness_mm desc, g.code",
  grade: "g.code, l.thickness_mm",
};

export async function plates(pq: PlateQuery) {
  const s = new Sql();
  const w = [s.scope(pq.f)];
  if (pq.search) {
    const p = s.p(`%${pq.search.replace(/[^A-Za-z0-9 .\-/]/g, "")}%`);
    w.push(`(l.plate_no ilike ${p} or l.heat_no ilike ${p} or g.code ilike ${p} or l.lot_no::text = trim(both '%' from ${p}))`);
  }
  if (pq.f.from || pq.f.to) {
    w.push(pq.dateOn === "received"
      ? s.inRange("l.receipt_date", pq.f.from, pq.f.to)
      : `exists (select 1 from public.stock_movements sm where sm.lot_id = l.id and sm.weight_kg < 0 and ${s.inRange("sm.movement_date", pq.f.from, pq.f.to)})`);
  }
  if (pq.status === "instock") w.push("bal.kg > 0.5");
  if (pq.status === "soldout") w.push("abs(bal.kg) <= 0.5");
  if (pq.status === "oversold") w.push("bal.kg < -0.5");
  if (pq.cert) {
    const has = `exists (select 1 from public.legacy_refs r where r.record_id = l.id and (r.raw->>'link' ~* '^https?://' or r.raw->>'tc_link' ~* '^https?://' or r.raw->>'con_link' ~* '^https?://'))`;
    w.push(pq.cert === "has" ? has : `not ${has}`);
  }
  const size = pq.all ? 20000 : [25, 50, 100].includes(pq.size) ? pq.size : 25; // export takes every matching plate
  const page = Math.max(1, pq.page);
  const rows = await q<{
    lot_no: string; book: string; grade: string; thk: string; wid: string; len: string; plate_no: string | null; heat_no: string | null;
    receipt_date: string; kg: string; pcs: string; total: string;
  }>(`
    with bal as (select lot_id, sum(weight_kg) kg, sum(pieces) pcs from public.stock_movements group by lot_id)
    select l.lot_no, b.code book, g.code grade, l.thickness_mm thk, l.width_mm wid, l.length_mm len, l.plate_no, l.heat_no,
           l.receipt_date, bal.kg, bal.pcs, count(*) over () total
    from public.lots l join public.grades g on g.id = l.grade_id join public.stock_books b on b.id = l.stock_book_id join bal on bal.lot_id = l.id
    where ${w.join(" and ")}
    order by ${SORTS[pq.sort] ?? SORTS.received_desc} limit ${size} offset ${(page - 1) * size}`, s.params);
  return { rows, total: Number(rows[0]?.total ?? 0), page, size };
}
