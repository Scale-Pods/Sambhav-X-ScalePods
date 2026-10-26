import "server-only";
import { q } from "./db";
import type { InvoiceRead, MtcRead } from "./docreader/families";
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
