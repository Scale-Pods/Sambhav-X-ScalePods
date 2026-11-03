import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import sharp from "sharp";
import { FILE_LIMITS, type AskFile } from "./engine";

// Files attached to a question. A picture or a PDF goes to the model as it is (a very large picture is made smaller first); everything else is turned into
// plain text here, so any model can read it: a spreadsheet becomes its sheets with the cells separated by tabs, a Word file its paragraphs and tables,
// a PowerPoint its slides. The text is data for that question only; it is never run and never stored.

export type RawFile = { name: string; mime: string; data: string }; // data: base64
export type Prepared = { ok: true; files: AskFile[] } | { ok: false; error: string };

class FileError extends Error {}

const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
const TEXT = new Set(["txt", "csv", "tsv", "md", "markdown", "json", "xml", "html", "htm", "log", "yaml", "yml", "ini", "sql", "eml", "svg"]);
const PASS_IMAGE: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const FORMAT_MIME: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const CONVERT_IMAGE = new Set(["bmp", "tif", "tiff", "avif", "heic", "heif"]);
const OLD: Record<string, string> = { xls: "Excel (.xls)", doc: "Word (.doc)", ppt: "PowerPoint (.ppt)", rtf: "Rich Text (.rtf)", odt: "OpenDocument (.odt)", ods: "OpenDocument (.ods)" };
const LONGEST_SIDE = 2000; // pixels: a larger picture is made smaller (the model reads no more detail, and a large one is slow and costly)

/** The kinds of file that can be attached, for the screens' messages. */
export const ACCEPTED_TEXT = "pictures (PNG, JPG, WEBP, GIF, BMP, TIFF), PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, and text files (.txt .md .json .xml .html .log .eml)";

function decodeText(buf: Buffer): string {
  if (buf.subarray(0, 4096).includes(0)) throw new FileError("does not look like a text file");
  let s: string;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    s = new TextDecoder("windows-1252").decode(buf); // a CSV saved by Excel on Windows
  }
  return s.replace(/^﻿/, "");
}

const entities = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function docxText(buf: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
  return entities(
    value
      .replace(/<img[^>]*>/g, "")
      .replace(/<\/p>(?=<\/t[dh]>)/gi, "") // the paragraph inside a table cell does not end a line
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<\/(p|h[1-6]|li|tr|div|table)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/ \| \n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  const out: string[] = [];
  for (const [i, name] of slides.entries()) {
    const xml = (await zip.files[name].async("string")).slice(0, 2_000_000);
    const paras = [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)].map((p) => entities([...p[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join("")).trim()).filter(Boolean);
    out.push(`### Slide ${i + 1}\n${paras.join("\n")}`);
  }
  return out.join("\n\n");
}

// A date as the sheet shows it, without the time zone: 2026-10-30 (and the time when there is one)
const dateText = (d: Date) => {
  const iso = d.toISOString();
  return iso.slice(11, 19) === "00:00:00" ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
};

const cellText = (c: ExcelJS.Cell): string => {
  try {
    const v = c.value as unknown;
    if (v instanceof Date) return dateText(v);
    if (v && typeof v === "object" && (v as { result?: unknown }).result instanceof Date) return dateText((v as { result: Date }).result);
    return String(c.text ?? "").replace(/[\t\r\n]+/g, " ").trim();
  } catch {
    return "";
  }
};

/** Every sheet, the rows one per line with the cells separated by tabs, until the text limit is reached. */
async function xlsxText(buf: Buffer, room: number): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const out: string[] = [];
  let used = 0;
  for (const ws of wb.worksheets.slice(0, 12)) {
    const cols = Math.min(ws.columnCount, 60);
    const head = `### Sheet "${ws.name}"${ws.state !== "visible" ? " (hidden)" : ""}: ${ws.actualRowCount} rows, ${ws.actualColumnCount} columns`;
    out.push(head); used += head.length;
    let skipped = 0;
    const last = Math.min(ws.rowCount, 50_000);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c)));
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length === 0) continue;
      const line = `${r}\t${cells.join("\t")}`; // the row number first, so the answer can say where a value is
      if (used + line.length > room) { skipped++; continue; }
      out.push(line); used += line.length + 1;
    }
    if (skipped) out.push(`[… ${skipped} more rows of this sheet are not shown: the file is longer than can be read at once]`);
    if (used >= room) break;
  }
  return out.join("\n");
}

/** A picture the model can take: PNG, JPEG, WEBP or GIF, no larger than 2000 pixels on its longest side. */
async function image(buf: Buffer, e: string): Promise<{ mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string }> {
  let meta;
  try {
    meta = await sharp(buf, { failOn: "none" }).metadata();
  } catch {
    throw new FileError("could not be opened as a picture" + (e === "heic" || e === "heif" ? " (save it as JPG first)" : ""));
  }
  const big = Math.max(meta.width ?? 0, meta.height ?? 0) > LONGEST_SIDE;
  const pass = FORMAT_MIME[meta.format as string]; // what the picture really is, whatever its file name says
  if (pass && !big) return { mime: pass, data: buf.toString("base64") };
  const base = sharp(buf, { failOn: "none" }).rotate().resize({ width: LONGEST_SIDE, height: LONGEST_SIDE, fit: "inside", withoutEnlargement: true });
  const out = meta.hasAlpha ? { mime: "image/png" as const, buf: await base.png().toBuffer() } : { mime: "image/jpeg" as const, buf: await base.jpeg({ quality: 85 }).toBuffer() };
  return { mime: out.mime, data: out.buf.toString("base64") };
}

/**
 * Checks and reads the attached files. `ok: false` carries a plain sentence for the person (which file, and what to do).
 * The decoded files together may not pass FILE_LIMITS.bytes; the text of all files together is cut at FILE_LIMITS.totalTextChars.
 */
export async function prepareFiles(raw: RawFile[]): Promise<Prepared> {
  const files: AskFile[] = [];
  let room = FILE_LIMITS.totalTextChars;
  for (const f of raw) {
    const e = ext(f.name);
    const name = f.name.replace(/[^\w .()\-]/g, "_").slice(0, 100);
    try {
      const buf = Buffer.from(f.data, "base64");
      if (buf.length === 0) throw new FileError("is empty");
      if (e === "pdf") {
        if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new FileError("is not a PDF");
        files.push({ name, kind: "pdf", mime: "application/pdf", data: f.data });
        continue;
      }
      if (PASS_IMAGE[e] || CONVERT_IMAGE.has(e)) {
        const img = await image(buf, e);
        files.push({ name, kind: "image", mime: img.mime, data: img.data });
        continue;
      }
      if (OLD[e]) throw new FileError(`is an old ${OLD[e]} file, which cannot be read. Open it and save it as ${e === "xls" || e === "ods" ? ".xlsx or CSV" : e === "ppt" ? ".pptx or PDF" : ".docx or PDF"}, then attach that`);
      let text: string, label: string;
      const cap = Math.max(0, Math.min(FILE_LIMITS.textChars, room));
      if (cap === 0) throw new FileError("was left out: the other files already use all that can be read at once");
      if (e === "xlsx" || e === "xlsm") {
        text = await xlsxText(buf, cap);
        label = "an Excel workbook, converted to text: each sheet starts with a ### line, each row starts with its row number, and cells are separated by tabs";
      } else if (e === "docx") {
        text = await docxText(buf);
        label = "a Word document, converted to text: table cells are separated by |";
      } else if (e === "pptx") {
        text = await pptxText(buf);
        label = "a PowerPoint deck, converted to text: one ### block per slide";
      } else if (TEXT.has(e)) {
        text = decodeText(buf);
        label = e === "csv" || e === "tsv" ? "a table file (" + e.toUpperCase() + "), as text" : "text, as data";
      } else {
        throw new FileError(`is a kind of file that cannot be read here. You can attach ${ACCEPTED_TEXT}`);
      }
      text = text.trim();
      if (!text) throw new FileError("has no text in it that can be read");
      if (text.length > cap) text = text.slice(0, cap) + "\n[… the file is longer than can be read at once; the rest is not shown. Ask about one part of it, or attach just that part.]";
      room -= text.length;
      files.push({ name, kind: "text", mime: "text/plain", data: text, label });
    } catch (err) {
      const why = err instanceof FileError ? err.message : "could not be read (is it damaged, or protected with a password?)";
      return { ok: false, error: `"${name}" ${why}.` };
    }
  }
  return { ok: true, files };
}
