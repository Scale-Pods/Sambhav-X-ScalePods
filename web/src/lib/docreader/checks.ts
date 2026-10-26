// Rules in code that look at what the AI read. A failed rule marks a field amber; the person must look at it.
// Nothing here calls the AI.

export type ReadLine = {
  description: string; grade: string; thickness_mm: string; width_mm: string; length_mm: string;
  qty: string; qty_unit: string; weight_kg: string; rate: string; rate_unit: string; amount: string;
};

export type Read = {
  doc_kind: string; is_firm_order: boolean; direction: string;
  seller_entity_named: string; buyer_name: string; buyer_gstin: string; po_number: string; document_number: string;
  po_date: string; currency: string; payment_terms: string; delivery_terms: string;
  net_amount: string; tax_amount: string; total_amount: string;
  lines: ReadLine[]; readable: boolean; uncertain: string[];
};

export type Check = { field: string; level: "amber" | "info"; message: string };

/** How a flagged check is named when a person says they looked at it (the review form and the server use the same rule). */
export const checkKey = (c: { field: string; message: string }) => `${c.field}|${c.message}`;

/** Numbers as the document shows them ("1,23,456.00", "148/-") to a plain number, or null. */
export function num(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = String(s).replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** GSTIN: 15 characters, the last is a check digit. */
export function gstinValid(g: string): boolean {
  const s = g.replace(/\s/g, "").toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(s[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === s[14];
}

const DENSITY = 7.85; // kg per dm3 for steel

export function runChecks(r: Read, today = new Date()): Check[] {
  const out: Check[] = [];
  const add = (field: string, level: Check["level"], message: string) => out.push({ field, level, message });
  const isOrder = r.is_firm_order;

  r.lines.forEach((l, i) => {
    const n = i + 1;
    const rate = num(l.rate);
    // a steel plate rate is normally 60-600 rupees per kg (60,000-600,000 per tonne): outside that, a digit was probably misread
    if (rate != null && l.rate_unit === "per_kg" && (rate < 60 || rate > 600)) add(`lines.${i}.rate`, "amber", `Line ${n}: ₹${rate}/kg is outside the usual 60-600. Check the digits.`);
    if (rate != null && l.rate_unit === "per_mt" && (rate < 60000 || rate > 600000)) add(`lines.${i}.rate`, "amber", `Line ${n}: ₹${rate} per tonne is outside the usual range. Check the digits.`);

    // quantity x rate = amount
    const amt = num(l.amount), qty = num(l.qty), wt = num(l.weight_kg);
    if (amt != null && rate != null) {
      let base: number | null = null;
      if (l.rate_unit === "per_kg") base = wt ?? (l.qty_unit === "kg" ? qty : null);
      else if (l.rate_unit === "per_mt") base = wt != null ? wt / 1000 : l.qty_unit === "mt" ? qty : l.qty_unit === "kg" && qty != null ? qty / 1000 : null;
      else if (l.rate_unit === "per_nos" || l.rate_unit === "per_m") base = qty;
      if (base != null) {
        const exp = base * rate;
        if (Math.abs(exp - amt) > Math.max(2, amt * 0.005)) add(`lines.${i}.amount`, "amber", `Line ${n}: ${base} × ${rate} = ${exp.toFixed(2)}, but the amount shown is ${amt}.`);
      }
    }

    // weight against size
    const t = num(l.thickness_mm), w = num(l.width_mm), len = num(l.length_mm);
    if (t && w && len && qty && wt && (l.qty_unit === "nos" || l.qty_unit === "not_shown")) {
      const exp = (t * w * len * DENSITY * qty) / 1e6;
      const dev = Math.abs(wt - exp) / exp;
      if (dev > 0.05) add(`lines.${i}.weight_kg`, "amber", `Line ${n}: ${qty} plate(s) of ${t}×${w}×${len} should weigh about ${Math.round(exp)} kg, the document says ${wt} kg.`);
      else if (dev > 0.02) add(`lines.${i}.weight_kg`, "info", `Line ${n}: weight is ${(dev * 100).toFixed(1)}% off the size (about ${Math.round(exp)} kg).`);
    }
    if (isOrder && (r.doc_kind !== "our_proforma_invoice") && (l.rate === "" ) && l.description !== "") add(`lines.${i}.rate`, "info", `Line ${n}: no rate on the document.`);
  });

  // totals
  const sum = r.lines.reduce((a, l) => a + (num(l.amount) ?? 0), 0);
  const net = num(r.net_amount), tax = num(r.tax_amount), tot = num(r.total_amount);
  const haveAmounts = r.lines.some((l) => num(l.amount) != null);
  if (haveAmounts && net != null && Math.abs(sum - net) > Math.max(2, net * 0.002)) add("net_amount", "amber", `The line amounts add up to ${sum.toFixed(2)}, but the document's net amount is ${net}.`);
  if (net != null && tax != null && tot != null && Math.abs(net + tax - tot) > 5) add("total_amount", "amber", `Net ${net} + tax ${tax} = ${(net + tax).toFixed(2)}, but the total shown is ${tot}.`);
  if (net != null && tax != null && net > 0) {
    const pct = (tax / net) * 100;
    if (!(Math.abs(pct - 18) < 0.3 || Math.abs(pct - 12) < 0.3 || Math.abs(pct - 5) < 0.3 || Math.abs(pct - 28) < 0.3 || pct < 0.01)) add("tax_amount", "amber", `Tax is ${pct.toFixed(1)}% of the net amount; usual rates are 5, 12, 18 or 28%.`);
    else if (pct < 0.01 && isOrder) add("tax_amount", "info", "The document shows no tax.");
  }

  // GSTIN
  if (r.buyer_gstin && !gstinValid(r.buyer_gstin)) add("buyer_gstin", "amber", "This GSTIN does not pass the check-digit test. A character may be misread.");

  // dates
  if (r.po_date) {
    const d = new Date(r.po_date + "T00:00:00");
    if (Number.isNaN(d.getTime())) add("po_date", "amber", "The date is not a valid date.");
    else {
      if (d.getTime() > today.getTime() + 86400000) add("po_date", "amber", "The date is in the future.");
      if (today.getTime() - d.getTime() > 400 * 86400000) add("po_date", "amber", "The date is more than a year old. Check the year.");
    }
  } else if (isOrder && !["chat_order", "email_order", "typed_order_note"].includes(r.doc_kind)) add("po_date", "info", "No date found on the document.");

  // required
  if (isOrder && !r.po_number && !r.document_number) add("po_number", "info", "No PO or reference number on the document: it will need a reference of our own.");
  if (isOrder && r.lines.length === 0) add("lines", "amber", "No line items were found.");
  if (!r.readable) add("readable", "amber", "The model says it could not read this properly.");
  return out;
}

const KEY_FIELD = /^(rate|qty|quantity|size|thickness|width|length|grade|po_date|date|direction|doc_kind|is_firm|po_number|document_number|total|net_amount|amount|line)/i;
const DOUBT = /could be|may be|might|unclear|ambiguous|illegible|cannot|can't|not clear|misread|either|or \d|hard to read|uncertain|not legible|cut off|struck|overwritten|guess/i;
const CERTAIN_NOT_ORDER = ["our_proforma_invoice", "our_sales_invoice", "transport_receipt", "price_list_or_offer", "registration_or_certificate", "sent_mail_or_notice"];

/** Should the stronger model read this again? True when the first read shows doubt (rules found in Phase 0). */
export function needsSecondRead(r: Read, checks: Check[]): { yes: boolean; why: string[] } {
  const why: string[] = [];
  const certain = CERTAIN_NOT_ORDER.includes(r.doc_kind);
  if (!r.readable) why.push("not readable");
  if (!r.is_firm_order && !certain) why.push("not sure it is an order");
  if (r.direction === "unclear" && !certain) why.push("direction unclear");
  if (r.is_firm_order && r.doc_kind !== "our_proforma_invoice") {
    r.lines.forEach((l, i) => { if (!l.rate || !l.qty) why.push(`line ${i + 1} missing ${!l.rate ? "rate" : "quantity"}`); });
  }
  if (checks.some((c) => c.level === "amber" && /rate|amount|weight|buyer_gstin|net_amount|total_amount/.test(c.field))) why.push("a check failed");
  if (r.uncertain.some((u) => KEY_FIELD.test(u.trim()) && DOUBT.test(u))) why.push("the model flagged a key field");
  return { yes: why.length > 0, why: [...new Set(why)] };
}

/** The document type this read belongs to in our own list. */
export function docTypeFor(r: Read): string {
  switch (r.doc_kind) {
    case "purchase_order": case "po_amendment": case "typed_order_note": case "chat_order": case "handwritten_order":
    case "broker_delivery_order": case "email_order":
      return r.direction === "we_buy_from_supplier" ? "other" : "customer_po";
    case "our_proforma_invoice": case "our_sales_invoice": return "sales_invoice";
    case "transport_receipt": return "lr";
    default: return "other";
  }
}
