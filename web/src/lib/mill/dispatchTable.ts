// Reads the "Dispatch details" table that a mill (Evonith) mails when steel leaves its works, from the mail's HTML (attachment or body) or from its plain text.
// Pure code: no AI, no cost, nothing from a server, so it can be tested on its own (scripts/check-mill-parser.ts). One row = one plate group of one heat (batch).

export type DispatchRow = {
  customer: string; entity: "SPF" | "SAI" | null;
  material_desc: string; material_code: string | null; so_item: string | null; // the mill's sales order and its item
  thickness_mm: number | null; width_mm: number | null; length_mm: number | null; pieces: number | null; tonnes: number | null;
  invoice_item: string | null; invoice_value: number | null; invoice_date: string | null; // YYYY-MM-DD
  batch: string | null; // the heat / plate number
  upr: number | null; freight_per_ton: number | null; // rupees per tonne
  grade_text: string | null; order_type: string | null; ship_to: string | null; destination: string | null;
  transporter: string | null; truck_no: string | null; tc_no: string | null; driver_phone: string | null;
  warnings: string[];
};
export type Consignment = { key: string; truck_no: string | null; transporter: string | null; tc_no: string | null; invoices: string[]; plates: number; pieces: number; tonnes: number; destination: string | null; entity: "SPF" | "SAI" | null };
export type DispatchRead = { rows: DispatchRow[]; consignments: Consignment[]; totals: { rows: number; pieces: number; tonnes: number; value: number }; warnings: string[]; how: "html" | "text" | "none" };

export const GST = 1.18; // the invoice value is tonnes x UPR plus 18% GST (checked on every row of the three real mails)
const STEEL_KG_PER_MM_M3 = 7.85e-6; // kg for 1 mm x 1 mm x 1 mm at 7.85 g/cc, so t x w x l x 7.85e-6 is kg

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
};
const isoDate = (s: string | null | undefined): string | null => {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec((s ?? "").trim());
  if (!m) return null;
  const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return Number.isNaN(Date.parse(d)) ? null : d;
};
const clean = (s: string) => s.replace(/&nbsp;|&#160;| /gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
export const entityOf = (customer: string): "SPF" | "SAI" | null => (/\bSAI\b/i.test(customer) ? "SAI" : /\bSAMBHAV\b/i.test(customer) ? "SPF" : null);

// ---------------------------------------------------------------- HTML: find the table whose header row has Batch and UPR
const HEADERS: Record<string, keyof Omit<DispatchRow, "entity" | "warnings">> = {
  "cust name": "customer", "material desc": "material_desc", material: "material_code", "so no item": "so_item", thick: "thickness_mm", width: "width_mm", length: "length_mm",
  pieces: "pieces", quantity: "tonnes", "inv no item": "invoice_item", "invoice value": "invoice_value", "inv date": "invoice_date", batch: "batch", upr: "upr",
  "freight per ton": "freight_per_ton", "cus grade": "grade_text", "order type": "order_type", "ship to party name": "ship_to", destination: "destination",
  "driver phonenumner": "driver_phone", "driver phonenumber": "driver_phone", "trans name": "transporter", "truck no": "truck_no", "tc number": "tc_no",
};
const hkey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function blank(): DispatchRow {
  return { customer: "", entity: null, material_desc: "", material_code: null, so_item: null, thickness_mm: null, width_mm: null, length_mm: null, pieces: null, tonnes: null, invoice_item: null, invoice_value: null, invoice_date: null, batch: null, upr: null, freight_per_ton: null, grade_text: null, order_type: null, ship_to: null, destination: null, transporter: null, truck_no: null, tc_no: null, driver_phone: null, warnings: [] };
}
function finish(r: DispatchRow): DispatchRow { r.entity = entityOf(r.customer); return r; }

function fromHtml(html: string): DispatchRow[] {
  const out: DispatchRow[] = [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const tb of tables) {
    const trs = tb.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    let cols: (keyof Omit<DispatchRow, "entity" | "warnings"> | null)[] | null = null;
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map((c) => clean(c.replace(/<[^>]*>/g, " ")));
      if (cells.length < 8) continue;
      if (!cols) {
        const keys = cells.map(hkey);
        if (keys.includes("batch") && keys.includes("upr")) cols = keys.map((k) => HEADERS[k] ?? null);
        continue;
      }
      const r = blank();
      cells.forEach((v, i) => {
        const f = cols![i];
        if (!f || v === "") return;
        if (["thickness_mm", "width_mm", "length_mm", "pieces", "tonnes", "invoice_value", "upr", "freight_per_ton"].includes(f)) (r as unknown as Record<string, number | null>)[f] = num(v);
        else if (f === "invoice_date") r.invoice_date = isoDate(v);
        else (r as unknown as Record<string, string>)[f] = v;
      });
      if (r.batch || r.invoice_item) out.push(finish(r));
    }
    if (out.length) break;
  }
  return out;
}

// ---------------------------------------------------------------- text: one cell per line (as copied out of a mail); empty cells may be missing, so cells are told apart by what they look like
const SO = /^\d{10}\/\d{6}$/, NUM = /^-?[\d,]*\.?\d+$/, TRUCK = /^[A-Z]{2}\d{2}[A-Z]{0,3}\d{4}$/, BATCH = /^[0-9A-Z]{7,10}$/;

function fromText(text: string): DispatchRow[] {
  const t = text.replace(/ /g, " ").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const starts: number[] = [];
  for (let i = 0; i + 1 < t.length; i++) if (/^HR\b/i.test(t[i + 1]) && !/^HR\b/i.test(t[i])) starts.push(i);
  const out: DispatchRow[] = [];
  starts.forEach((s, k) => {
    const c = t.slice(s, k + 1 < starts.length ? starts[k + 1] : t.length);
    let i = 0;
    const next = () => c[i++];
    const take = (re: RegExp) => (i < c.length && re.test(c[i]) ? c[i++] : null);
    const r = blank();
    r.customer = next(); r.material_desc = next();
    r.material_code = take(/^H\d{5}[A-Z0-9]+$/);
    r.so_item = take(SO);
    const n: (number | null)[] = [];
    for (let q = 0; q < 5; q++) { const v = take(NUM); n.push(v == null ? null : num(v)); }
    [r.thickness_mm, r.width_mm, r.length_mm, r.pieces, r.tonnes] = n;
    for (let skip = 0; skip < 2 && i < c.length && !SO.test(c[i]); skip++) i++; // "Class" is usually empty; anything else before the invoice is skipped
    r.invoice_item = take(SO);
    r.invoice_value = num(take(NUM));
    r.invoice_date = isoDate(take(/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/));
    r.batch = take(BATCH);
    r.upr = num(take(NUM));
    r.freight_per_ton = num(take(NUM));
    take(/^(OK|NOT OK)$/i); // quality
    r.grade_text = take(/^(?!Z[A-Z]{3}$).+$/);
    r.order_type = take(/^Z[A-Z]{3}$/);
    r.ship_to = next() ?? null; r.destination = next() ?? null;
    r.driver_phone = take(/^\d{10}$/);
    r.transporter = take(/^(?![A-Z]{2}\d{2}[A-Z]{0,3}\d{4}$).+$/);
    r.truck_no = take(TRUCK);
    r.tc_no = take(/^\d{8}$/);
    if (r.batch || r.invoice_item) out.push(finish(r));
  });
  return out;
}

// ---------------------------------------------------------------- checks and grouping
export function checkRow(r: DispatchRow): string[] {
  const w: string[] = [];
  if (!r.batch) w.push("no batch (heat) number");
  if (!r.invoice_item) w.push("no invoice number");
  if (!r.entity) w.push(`the customer "${r.customer}" is not SPF or Sai`);
  if (r.invoice_date == null) w.push("no valid invoice date");
  if (r.thickness_mm == null || r.width_mm == null || r.length_mm == null) w.push("size is incomplete");
  if (!r.pieces || r.pieces < 1) w.push("pieces missing");
  if (!r.tonnes || r.tonnes <= 0) w.push("weight missing");
  if (r.tonnes && r.upr && r.invoice_value != null) {
    const want = r.tonnes * r.upr * GST, diff = Math.abs(want - r.invoice_value);
    if (diff > Math.max(50, want * 0.0005)) w.push(`invoice value ${r.invoice_value.toLocaleString("en-IN")} does not match tonnes x rate + GST (${Math.round(want).toLocaleString("en-IN")})`);
  }
  if (r.tonnes && r.thickness_mm && r.width_mm && r.length_mm && r.pieces) {
    const theo = r.thickness_mm * r.width_mm * r.length_mm * r.pieces * STEEL_KG_PER_MM_M3, kg = r.tonnes * 1000;
    if (Math.abs(kg - theo) / theo > 0.08) w.push(`weight ${Math.round(kg)} kg is far from the size's ${Math.round(theo)} kg`);
  }
  return w;
}

/** One truck's load: rows with the same transporter, truck and TC number. */
function consign(rows: DispatchRow[]): Consignment[] {
  const m = new Map<string, Consignment>();
  for (const r of rows) {
    const key = [r.truck_no ?? "", r.tc_no ?? ""].join("|");
    const c = m.get(key) ?? { key, truck_no: r.truck_no, transporter: r.transporter, tc_no: r.tc_no, invoices: [], plates: 0, pieces: 0, tonnes: 0, destination: r.destination, entity: r.entity };
    const inv = (r.invoice_item ?? "").split("/")[0];
    if (inv && !c.invoices.includes(inv)) c.invoices.push(inv);
    c.plates++; c.pieces += r.pieces ?? 0; c.tonnes += r.tonnes ?? 0;
    m.set(key, c);
  }
  return [...m.values()].map((c) => ({ ...c, tonnes: Math.round(c.tonnes * 1000) / 1000 }));
}

/** Read a mail's table: from HTML if it holds the table, otherwise from text. A row that appears twice (a mail often carries the table twice) is kept once. */
export function readDispatch(source: { html?: string | null; text?: string | null }): DispatchRead {
  const warnings: string[] = [];
  let rows: DispatchRow[] = [], how: DispatchRead["how"] = "none";
  if (source.html) { rows = fromHtml(source.html); if (rows.length) how = "html"; }
  if (!rows.length && source.text) { rows = fromText(source.text); if (rows.length) how = "text"; }
  const seen = new Set<string>(), kept: DispatchRow[] = [];
  let dupes = 0;
  for (const r of rows) {
    const key = r.invoice_item ?? `${r.batch}|${r.tonnes}`;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key); kept.push(r);
  }
  if (dupes) warnings.push(`${dupes} repeated row${dupes === 1 ? "" : "s"} in the same mail were ignored`);
  for (const r of kept) r.warnings = checkRow(r);
  if (/message clipped|view entire message/i.test(`${source.text ?? ""} ${source.html ?? ""}`)) warnings.push("the mail body says it was clipped: read the attachment instead, the table may be incomplete");
  const totals = { rows: kept.length, pieces: kept.reduce((a, r) => a + (r.pieces ?? 0), 0), tonnes: Math.round(kept.reduce((a, r) => a + (r.tonnes ?? 0), 0) * 1000) / 1000, value: Math.round(kept.reduce((a, r) => a + (r.invoice_value ?? 0), 0)) };
  return { rows: kept, consignments: consign(kept), totals, warnings, how };
}
