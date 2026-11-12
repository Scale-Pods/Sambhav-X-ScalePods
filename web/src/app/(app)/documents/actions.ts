"use server";

import { revalidatePath } from "next/cache";
import { call, q, userMessage } from "@/lib/db";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { checkKey, runChecks, type Read } from "@/lib/docreader/checks";
import { FAMILY_UI, isFamilyRead, runChallanChecks, runInvoiceChecks, runMtcChecks, type FamilyRead } from "@/lib/docreader/families";

export type Result = { ok: true; draftId?: string | null } | { ok: false; error: string };

const HEADER = ["doc_kind", "direction", "seller_entity_named", "buyer_name", "buyer_gstin", "po_number", "document_number", "po_date", "currency",
  "payment_terms", "delivery_terms", "net_amount", "tax_amount", "total_amount"] as const;
const LINE = ["description", "grade", "thickness_mm", "width_mm", "length_mm", "qty", "qty_unit", "weight_kg", "rate", "rate_unit", "amount"] as const;

/** What the person changed, field by field, against what the AI read. The AI's version comes from the database, never from the browser. */
function diff(before: Read, after: Read) {
  const out: { field: string; from: string; to: string }[] = [];
  for (const k of HEADER) if (String(before[k] ?? "") !== String(after[k] ?? "")) out.push({ field: k, from: String(before[k] ?? ""), to: String(after[k] ?? "") });
  if (before.is_firm_order !== after.is_firm_order) out.push({ field: "is_firm_order", from: String(before.is_firm_order), to: String(after.is_firm_order) });
  const n = Math.max(before.lines.length, after.lines.length);
  for (let i = 0; i < n; i++) {
    const b = before.lines[i], a = after.lines[i];
    if (!b) { out.push({ field: `lines.${i}`, from: "", to: "added" }); continue; }
    if (!a) { out.push({ field: `lines.${i}`, from: "present", to: "removed" }); continue; }
    for (const k of LINE) if (String(b[k] ?? "") !== String(a[k] ?? "")) out.push({ field: `lines.${i}.${k}`, from: String(b[k] ?? ""), to: String(a[k] ?? "") });
  }
  return out;
}

export async function reviewDocument(id: string, decision: "confirmed" | "corrected" | "rejected", edited: Read | null, note: string, acknowledged: string[] = []): Promise<Result> {
  let draftId: string | null = null;
  try {
    const me = await currentStaff();
    if (!me || !canUploadDocs(me.role)) return { ok: false, error: "Your role cannot review documents" };
    const rows = await q<{ extracted: Read | null }>(`select extracted from public.documents where id = $1::uuid`, [id]);
    const before = rows[0]?.extracted;
    let final: Read | null = null;
    let changes: ReturnType<typeof diff> = [];
    if (decision !== "rejected") {
      if (!before || !Array.isArray(before.lines)) return { ok: false, error: "Nothing was read from this document, so it can only be rejected" };
      final = edited ?? before;
      if (!Array.isArray(final.lines)) return { ok: false, error: "The form is incomplete" };
      changes = diff(before, final);
      decision = changes.length > 0 ? "corrected" : "confirmed";
      // the rules run again here on what is being confirmed; every value still flagged needs the person to say they looked at it
      const flagged = runChecks(final).filter((c) => c.level === "amber");
      const open = flagged.filter((c) => !acknowledged.includes(checkKey(c)));
      if (open.length > 0) return { ok: false, error: `${open.length} flagged check${open.length === 1 ? "" : "s"} still need${open.length === 1 ? "s" : ""} you to tick "I checked this against the document".` };
      if (flagged.length > 0) note = `${note.trim()}${note.trim() ? " | " : ""}Looked at flagged: ${flagged.map((c) => c.field).join(", ")}`;
    }
    const r = await call<{ draft: string | null }>(`select public.review_document($1::uuid, $2, $3::jsonb, $4::jsonb, $5) as draft`, [id, decision, final ? JSON.stringify(final) : null, JSON.stringify(changes), note]);
    draftId = r[0]?.draft ?? null; // a confirmed customer order or enquiry also becomes a draft
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  revalidatePath("/drafts");
  return { ok: true, draftId };
}

// ---------------------------------------------------------------- vendor invoices and mill certificates

/** What the person changed, field by field, against what the AI read (the AI's version comes from the database, never from the browser). */
function diffFamily(before: FamilyRead, after: FamilyRead) {
  const cfg = FAMILY_UI[after.family];
  const b = before as unknown as Record<string, unknown>, a = after as unknown as Record<string, unknown>;
  const out: { field: string; from: string; to: string }[] = [];
  for (const h of cfg.header) if (String(b[h.key] ?? "") !== String(a[h.key] ?? "")) out.push({ field: h.key, from: String(b[h.key] ?? ""), to: String(a[h.key] ?? "") });
  const bl = (b[cfg.listKey] as Record<string, string>[]) ?? [], al = (a[cfg.listKey] as Record<string, string>[]) ?? [];
  const n = Math.max(bl.length, al.length);
  for (let i = 0; i < n; i++) {
    if (!bl[i]) { out.push({ field: `${cfg.listKey}.${i}`, from: "", to: "added" }); continue; }
    if (!al[i]) { out.push({ field: `${cfg.listKey}.${i}`, from: "present", to: "removed" }); continue; }
    for (const c of cfg.cols) if (String(bl[i][c.key] ?? "") !== String(al[i][c.key] ?? "")) out.push({ field: `${cfg.listKey}.${i}.${c.key}`, from: String(bl[i][c.key] ?? ""), to: String(al[i][c.key] ?? "") });
  }
  return out;
}

export async function reviewFamilyDocument(id: string, decision: "confirmed" | "corrected" | "rejected", edited: FamilyRead | null, note: string, acknowledged: string[] = []): Promise<Result> {
  let draftId: string | null = null;
  try {
    const me = await currentStaff();
    if (!me || !canUploadDocs(me.role)) return { ok: false, error: "Your role cannot review documents" };
    const rows = await q<{ extracted: FamilyRead | null }>(`select extracted from public.documents where id = $1::uuid`, [id]);
    const before = rows[0]?.extracted;
    let final: FamilyRead | null = null;
    let changes: ReturnType<typeof diffFamily> = [];
    if (decision !== "rejected") {
      if (!isFamilyRead(before)) return { ok: false, error: "Nothing was read from this document, so it can only be rejected" };
      final = { ...(edited ?? before), family: before.family } as FamilyRead; // the kind of document is fixed by what was read
      const list = final.family === "invoice" || final.family === "challan" ? final.lines : final.items;
      if (!Array.isArray(list)) return { ok: false, error: "The form is incomplete" };
      changes = diffFamily(before, final);
      decision = changes.length > 0 ? "corrected" : "confirmed";
      const flagged = (final.family === "invoice" ? runInvoiceChecks(final) : final.family === "challan" ? runChallanChecks(final) : runMtcChecks(final)).filter((c) => c.level === "amber");
      const open = flagged.filter((c) => !acknowledged.includes(checkKey(c)));
      if (open.length > 0) return { ok: false, error: `${open.length} flagged check${open.length === 1 ? "" : "s"} still need${open.length === 1 ? "s" : ""} you to tick "I checked this against the document".` };
      if (flagged.length > 0) note = `${note.trim()}${note.trim() ? " | " : ""}Looked at flagged: ${flagged.map((c) => c.field).join(", ")}`;
    }
    const r = await call<{ draft: string | null }>(`select public.review_document($1::uuid, $2, $3::jsonb, $4::jsonb, $5) as draft`, [id, decision, final ? JSON.stringify(final) : null, JSON.stringify(changes), note]);
    draftId = r[0]?.draft ?? null;
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  revalidatePath("/drafts");
  return { ok: true, draftId };
}
