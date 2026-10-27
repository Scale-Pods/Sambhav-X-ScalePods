import "server-only";
import { q } from "./db";
import { num, type Read } from "./docreader/checks";

// "Do we have it?": for a wanted plate (grade, thickness, size, quantity) find the plates in stock that fit. Reads only; it never reserves anything.
// A plate fits when it is the same grade, the same thickness (within 0.05 mm) and big enough: its width and length are at least the wanted ones,
// either way round (a bigger plate can be cut). Plates one millimetre either side of the thickness are listed apart as alternatives.

export type FitInput = { grade: string; thk: number | null; width: number | null; length: number | null; needKg: number | null; needPcs: number | null };
export type FitLot = {
  lot_no: number; grade: string; thickness_mm: number; width_mm: number; length_mm: number; balance_kg: number; balance_pieces: number;
  heat_no: string | null; plate_no: string | null; entity: string | null; exact_size: boolean;
  part: boolean; original_length_mm: number; // part: a single plate that has been cut, so what is left is shorter than the plate as received
};
export type Fit = {
  input: FitInput;
  grade: { code: string | null; how: "list" | "close" | "none"; candidates: string[] };
  lots: FitLot[]; plates: number; pieces: number; kg: number;
  near: FitLot[];
  verdict: "enough" | "partly" | "none" | "unknown";
  why: string;
};

const TOL = 0.05;   // mm: the same thickness
const NEAR = 1.0;   // mm: close enough to offer as an alternative

/** The wanted plates of a document: one per line that names a grade. Quantity in nos becomes pieces; kg and MT (and a printed weight) become kg. */
export function inputsFromRead(r: Read): { line: number; input: FitInput }[] {
  const out: { line: number; input: FitInput }[] = [];
  r.lines.forEach((l, i) => {
    if (!l.grade.trim() && !l.thickness_mm.trim()) return;
    const qty = num(l.qty);
    const weight = num(l.weight_kg);
    let needKg: number | null = weight != null && weight > 0 ? weight : null;
    let needPcs: number | null = null;
    if (qty != null && qty > 0) {
      if (l.qty_unit === "nos") needPcs = Math.round(qty);
      else if (l.qty_unit === "kg" && needKg == null) needKg = qty;
      else if (l.qty_unit === "mt" && needKg == null) needKg = qty * 1000;
    }
    out.push({ line: i, input: { grade: l.grade.trim(), thk: num(l.thickness_mm), width: num(l.width_mm), length: num(l.length_mm), needKg, needPcs } });
  });
  return out;
}

async function resolveGrade(raw: string): Promise<{ id: string | null; code: string | null; how: "list" | "close" | "none"; candidates: string[] }> {
  if (!raw) return { id: null, code: null, how: "none", candidates: [] };
  const hit = await q<{ id: string; code: string }>(
    `select id, code from (
       select g.id, g.code from public.grade_aliases a join public.grades g on g.id = a.grade_id where a.alias_norm = app.norm_text($1)
       union all select g.id, g.code from public.grades g where app.norm_text(g.code) = app.norm_text($1)) x limit 1`, [raw]);
  if (hit[0]) return { id: hit[0].id, code: hit[0].code, how: "list", candidates: [] };
  const close = await q<{ code: string }>(
    `select code from (select distinct g.code, similarity(a.alias_norm, app.norm_text($1)) s
                         from public.grade_aliases a join public.grades g on g.id = a.grade_id where a.alias_norm % app.norm_text($1)) c order by s desc limit 3`, [raw]);
  return { id: null, code: null, how: close.length ? "close" : "none", candidates: close.map((c) => c.code) };
}

// A single plate that has been cut (weight left is less than the plate's own weight) is a part plate: its length now is the original length in proportion to the
// weight left, not the length it arrived with (plate G5978002A0 arrived 12000 long, 1980 kg were cut off and sold, 9840 kg of about 10000 mm remain).
const LOTS = `(select l0.*, case when l0.pieces_received = 1 and coalesce(l0.balance_pieces, 0) <= 1 and l0.balance_kg > 0
                and coalesce(nullif(l0.invoice_weight_kg, 0), nullif(l0.theoretical_weight_kg, 0)) is not null
                and l0.balance_kg < 0.97 * coalesce(nullif(l0.invoice_weight_kg, 0), nullif(l0.theoretical_weight_kg, 0))
               then round(l0.length_mm * l0.balance_kg / coalesce(nullif(l0.invoice_weight_kg, 0), nullif(l0.theoretical_weight_kg, 0)), -1) else l0.length_mm end eff_len
         from public.v_lots_current l0)`;
const COLS = `l.lot_no::int lot_no, g.code grade, l.thickness_mm::float8 thickness_mm, l.width_mm::float8 width_mm, l.eff_len::float8 length_mm, l.length_mm::float8 original_length_mm, (l.eff_len < l.length_mm) part,
              l.balance_kg::float8 balance_kg, coalesce(l.balance_pieces, 0)::int balance_pieces, l.heat_no, l.plate_no, e.code entity`;

export async function stockFit(input: FitInput): Promise<Fit> {
  const grade = await resolveGrade(input.grade);
  const base: Fit = { input, grade: { code: grade.code, how: grade.how, candidates: grade.candidates }, lots: [], plates: 0, pieces: 0, kg: 0, near: [], verdict: "unknown", why: "" };
  if (!grade.id) return { ...base, why: grade.how === "close" ? `The grade "${input.grade}" is not in the grade list; closest: ${grade.candidates.join(", ")}.` : input.grade ? `The grade "${input.grade}" is not in the grade list.` : "No grade was given." };
  if (input.thk == null) return { ...base, why: "No thickness was given, so stock cannot be matched." };

  const w = input.width, l = input.length;
  const sized = w != null && l != null;
  // a part plate's length is worked out from its weight, so it is allowed 1% short of the wanted length (9990 left, 10000 wanted is a fit)
  const slack = `(case when l.eff_len < l.length_mm then 0.99 else 1 end)`;
  const size = sized ? `and ((l.width_mm >= $4 and l.eff_len >= $5 * ${slack}) or (l.width_mm >= $5 and l.eff_len >= $4 * ${slack}))` : "";
  const fits = (lo: string, hi: string) => `
    select ${COLS}, ${sized ? "(l.width_mm = $4 and abs(l.eff_len - $5) <= greatest(1, $5 * 0.01 * (case when l.eff_len < l.length_mm then 1 else 0 end)))" : "false"} as exact_size
      from ${LOTS} l join public.grades g on g.id = l.grade_id left join public.entities e on e.id = l.entity_id
     where l.current_status = 'available' and l.balance_kg > 0 and l.grade_id = $1 and l.thickness_mm between ${lo} and ${hi} ${size}
     order by exact_size desc, l.balance_kg desc limit 200`;
  const params = sized ? [grade.id, input.thk - TOL, input.thk + TOL, w, l] : [grade.id, input.thk - TOL, input.thk + TOL];
  const lots = await q<FitLot>(fits("$2", "$3"), params);
  const nearParams = sized ? [grade.id, input.thk - NEAR, input.thk + NEAR, w, l] : [grade.id, input.thk - NEAR, input.thk + NEAR];
  const near = (await q<FitLot>(fits("$2", "$3"), nearParams)).filter((x) => Math.abs(x.thickness_mm - input.thk!) > TOL).slice(0, 5);

  const plates = lots.length;
  const pieces = lots.reduce((a, x) => a + Math.max(x.balance_pieces, 1), 0); // a plate with weight left but no piece count is a part-plate: it counts as one
  const kg = lots.reduce((a, x) => a + x.balance_kg, 0);
  let verdict: Fit["verdict"] = "enough", why = `${plates} plate${plates === 1 ? "" : "s"} in stock, ${pieces} piece${pieces === 1 ? "" : "s"}, ${Math.round(kg).toLocaleString("en-IN")} kg.`;
  if (plates === 0) { verdict = "none"; why = near.length ? "Nothing in stock at this thickness and size; thicker or thinner plates of the same grade are listed." : "Nothing in stock that fits: a purchase is needed."; }
  else if (input.needPcs != null) { if (pieces < input.needPcs) { verdict = "partly"; why += ` ${input.needPcs} wanted.`; } }
  else if (input.needKg != null) { if (kg < input.needKg * 0.98) { verdict = "partly"; why += ` ${Math.round(input.needKg).toLocaleString("en-IN")} kg wanted.`; } }
  return { ...base, lots: lots.slice(0, 8), plates, pieces, kg, near, verdict, why };
}
