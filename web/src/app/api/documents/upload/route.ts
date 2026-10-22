import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { call, q, userMessage } from "@/lib/db";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { ACCEPTED_TYPES } from "@/lib/docreader/engine";

const MAX_BYTES = 25 * 1024 * 1024;

/** One file per request: keep it in private storage, register it, flag a copy of a file we already have. Reading is a separate call. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canUploadDocs(me.role)) return NextResponse.json({ error: "Your role cannot upload documents" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was sent" }, { status: 400 });
  const mime = file.type || "";
  if (!ACCEPTED_TYPES.includes(mime)) return NextResponse.json({ error: "Only PDF, JPG, PNG and WebP files can be read" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "The file must be between 1 byte and 25 MB" }, { status: 400 });

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    const same = await q<{ storage_path: string }>(`select storage_path from public.documents where sha256 = $1 and duplicate_of is null order by created_at limit 1`, [sha]);
    let path = same[0]?.storage_path;
    if (!path) {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
      path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safe}`;
      const supabase = await supabaseServer();
      const up = await supabase.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) return NextResponse.json({ error: "The file could not be stored" }, { status: 500 });
    }
    const r = await call<{ id: string; duplicate_of: string | null }>(`select * from public.register_document($1, $2, $3, $4, $5)`, [file.name, mime, file.size, sha, path]);
    return NextResponse.json({ id: r[0].id, duplicate_of: r[0].duplicate_of, name: file.name });
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 500 });
  }
}
