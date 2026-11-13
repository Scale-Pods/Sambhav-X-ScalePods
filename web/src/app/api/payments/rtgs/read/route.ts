import { NextResponse, type NextRequest } from "next/server";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { driveFile, driveId, driveReady } from "@/lib/drive";
import { readBank } from "@/lib/bankRead";

const used = new Map<string, number[]>(); // 40 readings an hour per person
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const MIME = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/** Reads the supplier's bank details off a purchase invoice: the bill in Drive (by its link) or a file the person uploads. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me || !canUploadDocs(me.role)) return fail("Your login may not prepare payment forms.", 403);
  const now = Date.now(), recent = (used.get(me.id) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 40) return fail("That is the limit of 40 readings an hour. Try again later.", 429);
  used.set(me.id, [...recent, now]);
  try {
    let bytes: Buffer, mime: string, supplier = "";
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const f = await req.formData();
      const file = f.get("file");
      supplier = typeof f.get("supplier") === "string" ? String(f.get("supplier")).slice(0, 200) : "";
      if (!(file instanceof File)) return fail("No file.");
      if (file.size > 6_000_000) return fail("The file is too large (6 MB at most).");
      bytes = Buffer.from(await file.arrayBuffer()); mime = file.type;
    } else {
      const b = (await req.json().catch(() => null)) as { link?: string; supplier?: string } | null;
      const id = driveId(b?.link);
      supplier = (b?.supplier ?? "").slice(0, 200);
      if (!id) return fail("That bill has no Drive link.");
      if (!driveReady()) return fail("This server cannot open Drive yet. Upload the invoice instead.", 503);
      const d = await driveFile(id); bytes = d.bytes; mime = d.mime;
    }
    if (!MIME.test(mime)) return fail("Only PDF or picture files can be read.");
    const r = await readBank(bytes, mime, supplier);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 200) : "The invoice could not be read.", 502);
  }
}
