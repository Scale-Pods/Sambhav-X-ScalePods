import "server-only";
import { q } from "./db";
import type { ChallanRead, InvoiceRead, MtcRead } from "./docreader/families";
import { num } from "./docreader/checks";

// Step 5 for vendor invoices and mill certificates: put what was read next to what we already hold. Reads only.

export type LotHit = { lot_no: number; grade: string | null; thickness_mm: number | null; status: string; balance_kg: number | null; heat_no: string | null; plate_no: string | null };
export type InvoiceMatch = {
  family: "invoice";
  ledger: { name: string; how: "gstin" | "name" } | null;
  vouchers: { voucher_no: string; date: string; type: string; party: string | null; amount: number; reference: string | null; how: string }[];
  sheet: { invoice_no: string; invoice_date: string | null; vendor: string | null; amount: number | null; entity: string }[];
  same_invoice: { id: string; file: string }[];
  plates: { key: string; hits: LotHit[] }[];
};
export type MtcMatch = {
  family: "mtc";
  filed: { cert_no: string | null; links: number }[];
  same_certificate: { id: string; file: string }[];
  items: { heat_no: string; plate_no: string; hits: LotHit[] }[];
};

export type ChallanHit = {
  lot_no: number; grade: string | null; thickness_mm: number | null; width_mm: number | null; length_mm: number | null; heat_no: string | null; plate_no: string | null;
  status: string; balance_kg: number | null; balance_pieces: number | null; kg_per_piece: number | null; entity: string | null;
};
export type ChallanLineMatch = {
  n: number; key: string; verdict: "ok" | "short" | "thickness" | "not_found" | "several"; hits: ChallanHit[]; best: ChallanHit | null; est_kg: number | null; notes: string[];
  similar: ChallanHit[]; // when the heat is not found: the closest heat numbers of the same thickness (a handwritten number often loses or changes a character)
};
export type ChallanMatch = { family: "challan"; same: { id: string; file: string; decided: string }[]; lines: ChallanLineMatch[]; est_kg: number; written_kg: number | null };

const LOTS = `select l.lot_no::int lot_no, g.code grade, l.thickness_mm::float8 thickness_mm, l.current_status status, l.balance_kg::float8 balance_kg, l.heat_no, l.plate_no
                from public.v_lots_current l left join public.grades g on g.id = l.grade_id`;

const app_len = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").length;

async function lotsFor(heat: string, plate: string): Promise<LotHit[]> {
  if (plate.trim()) {
    const byPlate = await q<LotHit>(`${LOTS} where app.norm_text(l.plate_no) = app.norm_text($1) order by l.lot_no limit 4`, [plate]);
    if (byPlate.length) return byPlate;
  }
  if (heat.trim()) {
    const exact = await q<LotHit>(`${LOTS} where app.norm_text(l.heat_no) = app.norm_text($1) order by l.lot_no limit 6`, [heat]);
    if (exact.length || app_len(heat) < 6) return exact;
    // some mills (Evonith, Uttam) print the heat without the plate letter our books append: 62754SA on the certificate, 62754SAA and 62754SAB in stock
    return q<LotHit>(`${LOTS} where app.norm_text(l.heat_no) like app.norm_text($1) || '%' and length(app.norm_text(l.heat_no)) <= length(app.norm_text($1)) + 2 order by l.lot_no limit 6`, [heat]);
  }
  return [];
}

const CHALLAN_LOTS = `select l.lot_no::int lot_no, g.code grade, l.thickness_mm::float8 thickness_mm, l.width_mm::float8 width_mm, l.length_mm::float8 length_mm, l.heat_no, l.plate_no,
                l.current_status status, l.balance_kg::float8 balance_kg, l.balance_pieces balance_pieces,
                (coalesce(l.invoice_weight_kg, l.theoretical_weight_kg) / nullif(l.pieces_received, 0))::float8 kg_per_piece, e.code entity
           from public.v_lots_current l left join public.grades g on g.id = l.grade_id left join public.entities e on e.id = l.entity_id`;

/** The plates that carry a heat or plate number as written on a challan (the same tolerance as for certificates: the mill's heat may lack the letter our books append). */
async function challanLots(heat: string): Promise<ChallanHit[]> {
  const h = heat.trim();
  if (!h) return [];
  const exact = await q<ChallanHit>(`${CHALLAN_LOTS} where app.norm_text(l.heat_no) = app.norm_text($1) or app.norm_text(l.plate_no) = app.norm_text($1) order by l.lot_no limit 8`, [h]);
  if (exact.length || app_len(h) < 6) return exact;
  return q<ChallanHit>(`${CHALLAN_LOTS} where app.norm_text(l.heat_no) like app.norm_text($1) || '%' and length(app.norm_text(l.heat_no)) <= length(app.norm_text($1)) + 2 order by l.lot_no limit 8`, [h]);
}

/** Heat numbers that look like the one written, of about the same thickness: for a heat that was misread. Needs the trigram index of the book already used for grades. */
async function similarLots(heat: string, thickness: number | null): Promise<ChallanHit[]> {
  const h = heat.trim();
  if (app_len(h) < 4) return [];
  return q<ChallanHit>(
    `${CHALLAN_LOTS} where similarity(app.norm_text(l.heat_no), app.norm_text($1)) >= 0.45 and l.current_status = 'available' and ($2::numeric is null or abs(l.thickness_mm - $2) <= 0.6)
      order by similarity(app.norm_text(l.heat_no), app.norm_text($1)) desc, l.lot_no limit 3`, [h, thickness]);
}

const KG_PER_MM3 = 7.85e-6;
const digitsOf = (s: string) => (s.match(/\d+/g) ?? []).join("");

/** An outward challan against our plates: is each heat in stock, with the right thickness and enough pieces, and what do the lines weigh by the plates' own weights? Reads only: it posts nothing. */
export async function matchChallan(r: ChallanRead, docId: string): Promise<ChallanMatch> {
  const no = r.challan_no.trim();
  const same = no
    ? await q<{ id: string; file: string; decided: string }>(
        `select id, original_filename file, review_status decided from public.documents
          where id <> $1::uuid and extracted->>'family' = 'challan' and app.norm_text(extracted->>'challan_no') = app.norm_text($2) and upper(coalesce(extracted->>'entity', '')) = $3 order by created_at limit 4`,
        [docId, no, r.entity.toUpperCase()])
    : [];
  const lines: ChallanLineMatch[] = [];
  let estTotal = 0;
  for (let i = 0; i < r.lines.length; i++) {
    const l = r.lines[i];
    const t = num(l.thickness_mm), w = num(l.width_mm), len = num(l.length_mm), p = num(l.pieces);
    const key = [l.heat_no || "no number", [t, w, len].every((x) => x != null) ? `${t}×${w}×${len}` : "", p != null ? `${p} pcs` : ""].filter(Boolean).join(" · ");
    const notes: string[] = [];
    const found = await challanLots(l.heat_no);
    const sized = t == null ? found : found.filter((h) => h.thickness_mm != null && Math.abs(h.thickness_mm - t) <= 0.6);
    let verdict: ChallanLineMatch["verdict"];
    let best: ChallanHit | null = null;
    if (found.length === 0) verdict = "not_found";
    else if (sized.length === 0) { verdict = "thickness"; best = found[0]; notes.push(`This heat is in our books as ${found[0].thickness_mm} mm, the challan says ${t} mm.`); }
    else {
      best = sized.find((h) => p != null && (h.balance_pieces ?? 0) >= p) ?? sized[0];
      verdict = sized.length > 1 ? "several" : p != null && best.balance_pieces != null && best.balance_pieces < p ? "short" : "ok";
      if (verdict === "short") notes.push(`Only ${best.balance_pieces} piece${best.balance_pieces === 1 ? "" : "s"} left on this plate; the challan sends ${p}.`);
      if (best.entity && r.entity !== "unclear" && best.entity !== r.entity) notes.push(`The plate is in the ${best.entity} books, the challan is from ${r.entity}.`);
      const lg = l.grade.trim();
      if (lg && best.grade && digitsOf(lg) && !digitsOf(best.grade).includes(digitsOf(lg))) notes.push(`Grade written ${lg}, our books say ${best.grade}.`);
      if (w != null && len != null && best.width_mm != null && best.length_mm != null) {
        const same_size = (Math.abs(best.width_mm - w) <= best.width_mm * 0.02 && Math.abs(best.length_mm - len) <= best.length_mm * 0.02) || (Math.abs(best.width_mm - len) <= best.width_mm * 0.02 && Math.abs(best.length_mm - w) <= best.length_mm * 0.02);
        if (!same_size && (w > best.width_mm * 1.02 || len > best.length_mm * 1.02) && (len > best.width_mm * 1.02 || w > best.length_mm * 1.02)) notes.push(`The size sent is bigger than the plate in our books (${best.width_mm} × ${best.length_mm}).`);
      }
    }
    // weight: the plate's own weight per piece when the size sent is the plate's size, otherwise the size by the steel formula
    let est: number | null = null;
    if (p != null && t != null && w != null && len != null) {
      const theo = t * w * len * KG_PER_MM3;
      const full = best && best.kg_per_piece != null && best.width_mm != null && best.length_mm != null && Math.abs(best.width_mm * best.length_mm - w * len) <= best.width_mm * best.length_mm * 0.03;
      est = p * (full ? (best!.kg_per_piece as number) : theo);
      estTotal += num(l.weight_kg) ?? est;
    }
    const similar = verdict === "not_found" || verdict === "thickness" ? await similarLots(l.heat_no, t) : [];
    lines.push({ n: i + 1, key, verdict, hits: sized.length ? sized : found, best, est_kg: est, notes, similar });
  }
  return { family: "challan", same, lines, est_kg: estTotal, written_kg: num(r.total_weight_kg) };
}

export async function matchInvoice(r: InvoiceRead, docId: string): Promise<InvoiceMatch> {
  const gst = r.vendor_gstin.replace(/\s/g, "").toUpperCase(), name = r.vendor_name.trim();
  let ledger: InvoiceMatch["ledger"] = null;
  if (gst) {
    const x = await q<{ name: string }>(`select name from public.tally_ledgers where deleted_at is null and gstin = $1 order by (parent_group ilike 'SUNDRY CREDITORS%') desc, name limit 1`, [gst]);
    if (x[0]) ledger = { name: x[0].name, how: "gstin" };
  }
  if (!ledger && name) {
    const x = await q<{ name: string }>(
      `select name from public.tally_ledgers where deleted_at is null and app.norm_text(regexp_replace(name, '\\s*\\((Sale|Pur|Rent)\\)\\s*$', '', 'i')) = app.norm_text($1) order by (parent_group ilike 'SUNDRY CREDITORS%') desc, name limit 1`, [name]);
    if (x[0]) ledger = { name: x[0].name, how: "name" };
  }
  const total = num(r.total_amount), inv = r.invoice_no.trim();
  const vouchers = inv || total != null || r.irn || r.eway_bill_no
    ? await q<InvoiceMatch["vouchers"][number]>(
        `select voucher_no, voucher_date::text date, voucher_type type, party_ledger party, amount::float8 amount, reference,
                case when $5::text <> '' and app.norm_text(irn) = app.norm_text($5) then 'IRN' when $6::text <> '' and eway_bill_no = $6 then 'e-way bill'
                     when $1::text <> '' and app.norm_text(reference) = app.norm_text($1) then 'invoice number' else 'amount and date' end how
           from public.tally_vouchers
          where deleted_at is null and voucher_type ilike 'Purchase%' and not is_cancelled
            and (($5::text <> '' and app.norm_text(irn) = app.norm_text($5)) or ($6::text <> '' and eway_bill_no = $6)
              or ($1::text <> '' and app.norm_text(reference) = app.norm_text($1))
              or ($2::numeric is not null and abs(amount - $2::numeric) <= 1 and $3::date is not null and voucher_date between $3::date - 15 and $3::date + 15 and ($4::text is null or party_ledger = $4)))
          order by ($5::text <> '' and app.norm_text(irn) = app.norm_text($5)) desc, (app.norm_text(reference) = app.norm_text($1)) desc, voucher_date desc limit 4`,
        [inv, total, /^\d{4}-\d{2}-\d{2}$/.test(r.invoice_date) ? r.invoice_date : null, ledger?.name ?? null, r.irn.replace(/\s/g, ""), r.eway_bill_no.replace(/\s/g, "")])
    : [];
  const sheet = inv
    ? await q<InvoiceMatch["sheet"][number]>(
        `select invoice_no, invoice_date::text invoice_date, vendor, amount::float8 amount, entity from public.v_purchase_invoices where app.norm_text(invoice_no) = app.norm_text($1) order by invoice_date desc nulls last limit 4`, [inv])
    : [];
  const same = inv
    ? await q<{ id: string; file: string }>(
        `select id, original_filename file from public.documents where id <> $1::uuid and extracted->>'family' = 'invoice' and app.norm_text(extracted->>'invoice_no') = app.norm_text($2)
            and ($3::text = '' or upper(replace(coalesce(extracted->>'vendor_gstin', ''), ' ', '')) = $3) order by created_at limit 3`, [docId, inv, gst])
    : [];
  const plates: InvoiceMatch["plates"] = [];
  for (const l of r.lines) {
    if (!l.heat_no.trim() && !l.plate_no.trim()) continue;
    plates.push({ key: [l.heat_no && `heat ${l.heat_no}`, l.plate_no && `plate ${l.plate_no}`].filter(Boolean).join(" · "), hits: await lotsFor(l.heat_no, l.plate_no) });
  }
  return { family: "invoice", ledger, vouchers, sheet, same_invoice: same, plates };
}

export async function matchMtc(r: MtcRead, docId: string): Promise<MtcMatch> {
  const cert = r.certificate_no.trim();
  const filed = cert
    ? await q<MtcMatch["filed"][number]>(
        `select c.cert_no, (select count(*)::int from public.lot_certificates lc where lc.certificate_id = c.id) links from public.certificates c where app.norm_text(c.cert_no) = app.norm_text($1) limit 3`, [cert])
    : [];
  const same = cert
    ? await q<{ id: string; file: string }>(
        `select id, original_filename file from public.documents where id <> $1::uuid and extracted->>'family' = 'mtc' and app.norm_text(extracted->>'certificate_no') = app.norm_text($2) order by created_at limit 3`, [docId, cert])
    : [];
  const items: MtcMatch["items"] = [];
  for (const it of r.items.slice(0, 40)) items.push({ heat_no: it.heat_no, plate_no: it.plate_no, hits: await lotsFor(it.heat_no, it.plate_no) });
  return { family: "mtc", filed, same_certificate: same, items };
}
