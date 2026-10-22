import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import * as mupdf from "mupdf";
import sharp from "sharp";
import { call, q } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase";
import { PROMPT_VERSION, SCHEMA, SYSTEM } from "./prompt";
import { type Check, type Read, docTypeFor, needsSecondRead, runChecks } from "./checks";

// USD per million tokens (input, output)
const MODELS = {
  first: { id: "claude-haiku-5-5", in: 0.1, out: 0.5 },
  second: { id: "claude-sonnet-5-5", in: 2.0, out: 10.0 },
} as const;
const MAX_PAGES = 4;       // only the first pages of a long PDF are read
const MAX_SIDE = 1568;     // longest side of an image sent to the model

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_TYPES = [...IMAGE_TYPES, "application/pdf"];

async function jpeg(input: Buffer): Promise<Anthropic.ImageBlockParam> {
  const buf = await sharp(input).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } };
}

export async function toBlocks(bytes: Buffer, mime: string): Promise<{ blocks: Anthropic.ImageBlockParam[]; pages: number }> {
  if (mime === "application/pdf") {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const pages = doc.countPages();
    const blocks: Anthropic.ImageBlockParam[] = [];
    for (let i = 0; i < Math.min(pages, MAX_PAGES); i++) {
      const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(110 / 72, 110 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      blocks.push(await jpeg(Buffer.from(pix.asPNG())));
    }
    return { blocks, pages };
  }
  return { blocks: [await jpeg(bytes)], pages: 1 };
}

type Run = { read: Read; model: string; input: number; output: number; usd: number; seconds: number; stop: string };

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

    const supabase = await supabaseServer();
    const dl = await supabase.storage.from("documents").download(d.storage_path);
    if (dl.error || !dl.data) throw new Error("The file could not be fetched from storage");
    const { blocks, pages } = await toBlocks(Buffer.from(await dl.data.arrayBuffer()), d.mime_type);
    const note = `File name: ${d.original_filename}. ` + (pages > 1 ? `PDF with ${pages} pages; the first ${blocks.length} are shown. ` : "");
    const extra: Check[] = pages > MAX_PAGES ? [{ field: "pages", level: "info", message: `Only the first ${MAX_PAGES} of ${pages} pages were read.` }] : [];

    const first = await callModel("first", blocks, note);
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
