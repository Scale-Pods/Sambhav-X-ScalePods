import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import * as mupdf from "mupdf";
import sharp from "sharp";
import { call, q } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase";
import { PROMPT_VERSION, SCHEMA, SYSTEM } from "./prompt";
import { type Check, type Read, docTypeFor, needsSecondRead, runChecks } from "./checks";
import {
  CHALLAN_SCHEMA, CHALLAN_SYSTEM, INVOICE_SCHEMA, INVOICE_SYSTEM, MTC_SCHEMA, MTC_SYSTEM, TRIAGE_SCHEMA, TRIAGE_SYSTEM, type ChallanRead, type FamilyRead, type InvoiceRead, type MtcRead,
  docTypeForFamily, needsSecondReadFamily, runChallanChecks, runInvoiceChecks, runMtcChecks,
} from "./families";

// USD per million tokens (input, output)
const MODELS = {
  first: { id: "claude-haiku-5-5", in: 0.1, out: 0.5 },
  second: { id: "claude-sonnet-5-5", in: 2.0, out: 10.0 },
} as const;
const MAX_PAGES = 4;       // only the first pages of a long PDF are read
const MAX_SIDE = 1568;     // longest side of an image sent to the model

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_TYPES = [...IMAGE_TYPES, "application/pdf"];

/** `turn`: extra degrees clockwise (a sideways phone photo of a challan), applied after the camera's own orientation tag. */
async function jpeg(input: Buffer, turn = 0): Promise<Anthropic.ImageBlockParam> {
  const upright = turn ? await sharp(input).rotate().toBuffer() : input; // sharp keeps only one rotation per pipeline, so the camera's tag is applied first
  const buf = await (turn ? sharp(upright).rotate(turn) : sharp(upright).rotate()).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } };
}

export async function toBlocks(bytes: Buffer, mime: string, turn = 0): Promise<{ blocks: Anthropic.ImageBlockParam[]; pages: number }> {
  if (mime === "application/pdf") {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const pages = doc.countPages();
    const blocks: Anthropic.ImageBlockParam[] = [];
    for (let i = 0; i < Math.min(pages, MAX_PAGES); i++) {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(110 / 72, 110 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      blocks.push(await jpeg(Buffer.from(pix.asPNG()), turn));
    }
    return { blocks, pages };
  }
  return { blocks: [await jpeg(bytes, turn)], pages: 1 };
}

type Run<T = Read> = { read: T; model: string; input: number; output: number; usd: number; seconds: number; stop: string };

export async function callModel(stage: "first" | "second", blocks: Anthropic.ImageBlockParam[], note: string): Promise<Run> {
  const m = MODELS[stage];
  const client = new Anthropic({ maxRetries: 2, timeout: 150_000 });
  const t = Date.now();
  const r = await client.messages.create({
    model: m.id,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: [...blocks, { type: "text", text: `${note}Extract the document.` }] }],
  });
  const text = r.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("The model returned no answer");
  const read = JSON.parse(text.text) as Read;
  const usd = (r.usage.input_tokens * m.in + r.usage.output_tokens * m.out) / 1e6;
  return { read, model: m.id, input: r.usage.input_tokens, output: r.usage.output_tokens, usd, seconds: (Date.now() - t) / 1000, stop: r.stop_reason ?? "" };
}

/** The text layer of the first pages of a digital PDF (exact characters for identifiers); "" for scans and photos. */
export function pdfText(bytes: Buffer, mime: string, maxChars = 7000): string {
  if (mime !== "application/pdf") return "";
  try {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    let out = "";
    for (let i = 0; i < Math.min(doc.countPages(), MAX_PAGES) && out.length < maxChars; i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
    const text = out.replace(/[ \t]+/g, " ").trim().slice(0, maxChars);
    // some PDFs carry a text layer of private-use glyph codes (an embedded font without a mapping): that is noise, not text, so it is not sent
    const odd = (text.match(/[-�]/g) ?? []).length;
    return odd > text.length * 0.2 || (text.length > 200 && (text.match(/[A-Za-z0-9]/g) ?? []).length < text.length * 0.3) ? "" : text;
  } catch {
    return "";
  }
}

type Cfg = { system: string; schema: object; maxTokens: number };

/** One read with its own instructions and answer shape (vendor invoices, mill certificates). The text layer, when there is one, rides along as data. */
async function callFamily<T>(stage: "first" | "second", cfg: Cfg, blocks: Anthropic.ImageBlockParam[], note: string, text: string): Promise<Run<T>> {
  const m = MODELS[stage];
  const client = new Anthropic({ maxRetries: 2, timeout: 150_000 });
  const t = Date.now();
  const extra = text ? `Text layer taken from the PDF (it may be out of reading order; use it to copy identifiers exactly, but the pictures decide what belongs where):\n"""\n${text}\n"""\n\n` : "";
  const r = await client.messages.create({
    model: m.id, max_tokens: cfg.maxTokens, system: cfg.system,
    output_config: { format: { type: "json_schema", schema: cfg.schema as Record<string, unknown> } },
    messages: [{ role: "user", content: [...blocks, { type: "text", text: `${note}${extra}Extract the document.` }] }],
  });
  const out = r.content.find((b) => b.type === "text");
  if (!out || out.type !== "text") throw new Error("The model returned no answer");
  const usd = (r.usage.input_tokens * m.in + r.usage.output_tokens * m.out) / 1e6;
  return { read: JSON.parse(out.text) as T, model: m.id, input: r.usage.input_tokens, output: r.usage.output_tokens, usd, seconds: (Date.now() - t) / 1000, stop: r.stop_reason ?? "" };
}

type Triage = { family: "po_or_enquiry" | "purchase_invoice" | "mill_certificate" | "delivery_challan" | "other"; rotate: 0 | 90 | 180 | 270; input: number; output: number; usd: number };
/** What kind of document is this? One cheap look at the first page. A failure here just means the order reader is used, as before. */
async function triage(first: Anthropic.ImageBlockParam | undefined, text: string): Promise<Triage> {
  const none: Triage = { family: "po_or_enquiry", rotate: 0, input: 0, output: 0, usd: 0 };
  if (!first) return none;
  try {
    const m = MODELS.first;
    const client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
    const r = await client.messages.create({
      model: m.id, max_tokens: 1500, system: TRIAGE_SYSTEM,
      output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA as Record<string, unknown> } },
      messages: [{ role: "user", content: [first, { type: "text", text: `${text ? `Start of the text layer:\n${text.slice(0, 1200)}\n\n` : ""}What kind of document is this?` }] }],
    });
    const out = r.content.find((b) => b.type === "text");
    const got = out && out.type === "text" ? (JSON.parse(out.text) as { family: Triage["family"]; rotate?: string }) : { family: "po_or_enquiry" as const, rotate: "0" };
    const rotate = ([90, 180, 270] as const).find((d) => String(d) === got.rotate) ?? 0;
    return { family: got.family, rotate, input: r.usage.input_tokens, output: r.usage.output_tokens, usd: (r.usage.input_tokens * m.in + r.usage.output_tokens * m.out) / 1e6 };
  } catch {
    return none;
  }
}

async function saveFamily(docId: string, fam: "invoice" | "mtc" | "challan", stage: "first" | "second", run: Run<FamilyRead>, checks: Check[], final: boolean) {
  await call(
    `select public.record_extraction($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::public.doc_type, $13)`,
    [docId, stage, run.model, `${fam}-v1-2026-10-26`, run.input, run.output, run.usd.toFixed(5), run.seconds.toFixed(1), run.stop,
      JSON.stringify(run.read), JSON.stringify(checks), docTypeForFamily(fam), final],
  );
}

/** Read a vendor invoice or a mill certificate: the cheap model first, the stronger one when the first read shows doubt. */
async function readFamily(docId: string, fam: "invoice" | "mtc" | "challan", blocks: Anthropic.ImageBlockParam[], note: string, text: string, tri: Triage, extra: Check[]) {
  const cfg: Cfg = fam === "invoice" ? { system: INVOICE_SYSTEM, schema: INVOICE_SCHEMA, maxTokens: 8000 } : fam === "mtc" ? { system: MTC_SYSTEM, schema: MTC_SCHEMA, maxTokens: 8000 } : { system: CHALLAN_SYSTEM, schema: CHALLAN_SCHEMA, maxTokens: 8000 };
  const checkOf = (r: FamilyRead) => (fam === "invoice" ? runInvoiceChecks(r as InvoiceRead) : fam === "mtc" ? runMtcChecks(r as MtcRead) : runChallanChecks(r as ChallanRead));
  const first = await callFamily<FamilyRead>("first", cfg, blocks, note, text);
  first.read = { ...first.read, family: fam } as FamilyRead;
  first.input += tri.input; first.output += tri.output; first.usd += tri.usd;
  const c1 = [...checkOf(first.read), ...extra];
  const again = needsSecondReadFamily(first.read, c1);
  await saveFamily(docId, fam, "first", first, c1, !again.yes);
  if (!again.yes) return { ok: true as const, second: false, usd: first.usd };
  const second = await callFamily<FamilyRead>("second", cfg, blocks, note, text);
  second.read = { ...second.read, family: fam } as FamilyRead;
  const c2 = [...checkOf(second.read), ...extra, { field: "second_read", level: "info" as const, message: `Read again by a stronger model because: ${again.why.join("; ")}.` }];
  await saveFamily(docId, fam, "second", second, c2, true);
  return { ok: true as const, second: true, usd: first.usd + second.usd };
}

async function save(docId: string, stage: "first" | "second", run: Run, checks: Check[], final: boolean) {
  await call(
    `select public.record_extraction($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::public.doc_type, $13)`,
    [docId, stage, run.model, PROMPT_VERSION, run.input, run.output, run.usd.toFixed(5), run.seconds.toFixed(1), run.stop,
      JSON.stringify(run.read), JSON.stringify(checks), docTypeFor(run.read), final],
  );
}

/** Read one uploaded document: the cheap model first, the stronger one when the first read shows doubt. Saves every read. */
export async function readDocument(docId: string): Promise<{ ok: true; second: boolean; usd: number } | { ok: false; error: string }> {
  try {
    const rows = await q<{ storage_path: string; mime_type: string; original_filename: string; extraction_status: string; review_status: string; duplicate_of: string | null }>(
      `select storage_path, mime_type, original_filename, extraction_status, review_status, duplicate_of from public.documents where id = $1::uuid`, [docId]);
    const d = rows[0];
    if (!d) return { ok: false, error: "Document not found" };
    if (d.review_status !== "pending") return { ok: false, error: "This document has already been reviewed" };
    if (d.extraction_status === "needs_review") return { ok: true, second: false, usd: 0 };
    if (!ACCEPTED_TYPES.includes(d.mime_type)) return { ok: false, error: "Only PDF, JPG, PNG and WebP files can be read" };
    // spending limits (daily, per document, per person per hour) are checked in the database before anything is sent to the AI
    const limit = await q<{ why: string | null }>(`select public.ai_read_allowed($1::uuid) why`, [docId]);
    if (limit[0]?.why) {
      await call(`select public.fail_extraction($1::uuid, $2)`, [docId, limit[0].why]).catch(() => {});
      return { ok: false, error: limit[0].why };
    }

    const supabase = await supabaseServer();
    const dl = await supabase.storage.from("documents").download(d.storage_path);
    if (dl.error || !dl.data) throw new Error("The file could not be fetched from storage");
    const bytes = Buffer.from(await dl.data.arrayBuffer());
    let { blocks, pages } = await toBlocks(bytes, d.mime_type); // eslint-disable-line prefer-const
    const note = `File name: ${d.original_filename}. ` + (pages > 1 ? `PDF with ${pages} pages; the first ${blocks.length} are shown. ` : "");
    const extra: Check[] = pages > MAX_PAGES ? [{ field: "pages", level: "info", message: `Only the first ${MAX_PAGES} of ${pages} pages were read.` }] : [];

    // what kind of document is it? vendor invoices and mill certificates have their own readers; everything else is read as an order or enquiry, as before
    const text = pdfText(bytes, d.mime_type);
    const tri = await triage(blocks[0], text);
    if (tri.family === "purchase_invoice") return await readFamily(docId, "invoice", blocks, note, text, tri, extra);
    if (tri.family === "mill_certificate") return await readFamily(docId, "mtc", blocks, note, text, tri, extra);
    if (tri.family === "delivery_challan") {
      // a challan is often a sideways phone photo: turn it upright first (only for challans; every other document is read exactly as before)
      if (tri.rotate && d.mime_type !== "application/pdf") blocks = (await toBlocks(bytes, d.mime_type, tri.rotate)).blocks;
      return await readFamily(docId, "challan", blocks, note, text, tri, extra);
    }

    const first = await callModel("first", blocks, note);
    first.input += tri.input; first.output += tri.output; first.usd += tri.usd;
    const c1 = [...runChecks(first.read), ...extra];
    const again = needsSecondRead(first.read, c1);
    await save(docId, "first", first, c1, !again.yes);
    if (!again.yes) return { ok: true, second: false, usd: first.usd };

    const second = await callModel("second", blocks, note);
    const c2 = [...runChecks(second.read), ...extra, { field: "second_read", level: "info" as const, message: `Read again by a stronger model because: ${again.why.join("; ")}.` }];
    await save(docId, "second", second, c2, true);
    return { ok: true, second: true, usd: first.usd + second.usd };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The document could not be read";
    await call(`select public.fail_extraction($1::uuid, $2)`, [docId, msg]).catch(() => {});
    return { ok: false, error: "The document could not be read. You can try again." };
  }
}
