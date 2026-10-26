// Try the vendor-invoice and mill-certificate readers on the downloaded samples (data/phase0-fam/<kind>/), the same steps as the app:
// triage (Haiku) -> read (Haiku) -> checks in code -> read again (Sonnet) only when there is doubt. Saves every answer to data/phase0-fam/results/.
//   from the web folder:  ROOT=<repo> node ../tools/docs-trial/run_families.mjs   (builds _fam_trial.mjs), then  node _fam_trial.mjs invoices|certs [limit]   (needs ANTHROPIC_API_KEY)
// "Grounded" = the value the model read can be found in the PDF's own text layer (digital PDFs only): a free check of accuracy on identifiers and amounts.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = (process.env.ROOT || path.resolve(here, "..", "..")).replaceAll("\\", "/");
const web = root + "/web";

await build({
  stdin: {
    resolveDir: web, loader: "ts",
    contents: `
import Anthropic from "@anthropic-ai/sdk";
import * as mupdf from "mupdf";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { INVOICE_SCHEMA, INVOICE_SYSTEM, MTC_SCHEMA, MTC_SYSTEM, TRIAGE_SCHEMA, TRIAGE_SYSTEM, needsSecondReadFamily, runInvoiceChecks, runMtcChecks } from "${root}/web/src/lib/docreader/families";

const kind = process.argv[2], limit = Number(process.argv[3] || 100);
const dir = "${root}/data/phase0-fam/" + kind, outDir = "${root}/data/phase0-fam/results/" + kind;
fs.mkdirSync(outDir, { recursive: true });
const M = { first: { id: "claude-haiku-5-5", in: 0.1, out: 0.5 }, second: { id: "claude-sonnet-5-5", in: 2.0, out: 10.0 } };
const client = new Anthropic({ maxRetries: 2, timeout: 150000 });
const MAXP = 4;

async function jpeg(buf) {
  const b = await sharp(buf).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } };
}
async function blocksOf(bytes, mime) {
  if (mime === "application/pdf") {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const n = doc.countPages(); const blocks = [];
    for (let i = 0; i < Math.min(n, MAXP); i++) {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(110 / 72, 110 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      blocks.push(await jpeg(Buffer.from(pix.asPNG())));
    }
    return { blocks, pages: n };
  }
  return { blocks: [await jpeg(bytes)], pages: 1 };
}
function textOf(bytes, mime, max) {
  if (mime !== "application/pdf") return "";
  try {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf"); let out = "";
    for (let i = 0; i < Math.min(doc.countPages(), MAXP) && out.length < max; i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\\n";
    return out.replace(/[ \\t]+/g, " ").trim().slice(0, max);
  } catch { return ""; }
}
const usd = (m, i, o) => (i * m.in + o * m.out) / 1e6;

async function call(stage, system, schema, content, maxTokens) {
  const m = M[stage]; const t = Date.now();
  const r = await client.messages.create({ model: m.id, max_tokens: maxTokens, system, output_config: { format: { type: "json_schema", schema } }, messages: [{ role: "user", content }] });
  const o = r.content.find((b) => b.type === "text");
  return { read: JSON.parse(o.text), in: r.usage.input_tokens, out: r.usage.output_tokens, usd: usd(m, r.usage.input_tokens, r.usage.output_tokens), s: (Date.now() - t) / 1000, stop: r.stop_reason };
}

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const digits = (s) => String(s || "").replace(/[^0-9]/g, "");

function ground(fam, read, fullText) {
  if (!fullText || fullText.length < 300) return null;
  const N = norm(fullText), D = digits(fullText);
  const res = [];
  const test = (label, v, mode) => { if (!v || !String(v).trim()) return; const hit = mode === "digits" ? D.includes(digits(v).replace(/(\\d)00$/, "$1")) || D.includes(digits(v)) : N.includes(norm(v)); res.push({ label, v: String(v), hit }); };
  if (fam === "invoice") {
    test("invoice_no", read.invoice_no); test("vendor_gstin", read.vendor_gstin); test("buyer_gstin", read.buyer_gstin);
    test("irn", read.irn); test("eway", read.eway_bill_no, "digits"); test("total", read.total_amount, "digits"); test("taxable", read.taxable_value, "digits");
    read.lines.forEach((l, i) => { test("l" + (i + 1) + ".amount", l.amount, "digits"); test("l" + (i + 1) + ".heat", l.heat_no); test("l" + (i + 1) + ".plate", l.plate_no); });
  } else {
    test("cert_no", read.certificate_no);
    read.items.forEach((it, i) => { test("r" + (i + 1) + ".heat", it.heat_no); test("r" + (i + 1) + ".plate", it.plate_no); });
  }
  return res;
}

const files = fs.readdirSync(dir).filter((f) => /\\.(pdf|jpg|jpeg|png)$/i.test(f)).sort().slice(0, limit);
const summary = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const f = files[next++]; const out = outDir + "/" + f + ".json";
    const mime = /\\.pdf$/i.test(f) ? "application/pdf" : /\\.png$/i.test(f) ? "image/png" : "image/jpeg";
    const row = { file: f };
    try {
      const bytes = fs.readFileSync(dir + "/" + f);
      const { blocks, pages } = await blocksOf(bytes, mime);
      const text = textOf(bytes, mime, 7000), fullText = textOf(bytes, mime, 40000);
      // triage
      const tri = await call("first", TRIAGE_SYSTEM, TRIAGE_SCHEMA, [blocks[0], { type: "text", text: (text ? "Start of the text layer:\\n" + text.slice(0, 1200) + "\\n\\n" : "") + "What kind of document is this?" }], 100);
      row.triage = tri.read.family; let cost = tri.usd;
      const fam = tri.read.family === "purchase_invoice" ? "invoice" : tri.read.family === "mill_certificate" ? "mtc" : null;
      row.pages = pages; row.textlen = fullText.length;
      if (fam) {
        const cfg = fam === "invoice" ? [INVOICE_SYSTEM, INVOICE_SCHEMA] : [MTC_SYSTEM, MTC_SCHEMA];
        const extra = text ? "Text layer taken from the PDF (it may be out of reading order; use it to copy identifiers exactly, but the pictures decide what belongs where):\\n\\"\\"\\"\\n" + text + "\\n\\"\\"\\"\\n\\n" : "";
        const note = "File name: " + f + ". " + (pages > 1 ? "PDF with " + pages + " pages; the first " + blocks.length + " are shown. " : "");
        const content = [...blocks, { type: "text", text: note + extra + "Extract the document." }];
        const check = (r) => (fam === "invoice" ? runInvoiceChecks(r) : runMtcChecks(r));
        const first = await call("first", cfg[0], cfg[1], content, 8000); cost += first.usd;
        first.read.family = fam; const c1 = check(first.read); const again = needsSecondReadFamily(first.read, c1);
        let final = first.read, finalChecks = c1, second = null;
        if (again.yes) { second = await call("second", cfg[0], cfg[1], content, 8000); cost += second.usd; second.read.family = fam; final = second.read; finalChecks = check(second.read); }
        row.family = fam; row.second = Boolean(second); row.why = again.why; row.items = fam === "invoice" ? final.lines.length : final.items.length;
        row.amber_first = c1.filter((c) => c.level === "amber").length; row.amber_final = finalChecks.filter((c) => c.level === "amber").length;
        row.direction = final.direction || final.cert_kind;
        const g = ground(fam, final, fullText); row.ground = g ? { hit: g.filter((x) => x.hit).length, total: g.length, miss: g.filter((x) => !x.hit).map((x) => x.label + "=" + x.v) } : null;
        fs.writeFileSync(out, JSON.stringify({ file: f, triage: row.triage, first: first.read, checks_first: c1, second: second ? second.read : null, checks_final: finalChecks, why: again.why, ground: g, usd: cost }, null, 1));
      }
      row.usd = cost;
    } catch (e) { row.error = String(e.message || e).slice(0, 160); }
    summary.push(row);
    console.log(JSON.stringify(row));
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
const ok = summary.filter((r) => r.family);
const tot = (k) => summary.reduce((a, r) => a + (r[k] || 0), 0);
const g = ok.filter((r) => r.ground);
console.log("=== " + kind + ": " + summary.length + " files, " + ok.length + " read as the expected family, " + summary.filter((r) => r.triage === "other" || r.triage === "po_or_enquiry").length + " triaged elsewhere, " + summary.filter((r) => r.error).length + " errors");
console.log("second reads: " + ok.filter((r) => r.second).length + "; amber after reading: " + ok.filter((r) => r.amber_final > 0).length + " files; cost $" + tot("usd").toFixed(3));
if (g.length) console.log("grounded fields (digital PDFs): " + g.reduce((a, r) => a + r.ground.hit, 0) + " of " + g.reduce((a, r) => a + r.ground.total, 0) + " across " + g.length + " files");
fs.writeFileSync(outDir + "/_summary.json", JSON.stringify(summary, null, 1));
process.exit(0);
`,
  },
  bundle: true, platform: "node", format: "esm", outfile: web + "/_fam_trial.mjs", external: ["@anthropic-ai/sdk", "mupdf", "sharp"], logLevel: "error",
});
console.log("built");
