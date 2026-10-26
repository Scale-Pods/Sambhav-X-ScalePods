import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { call, q, userMessage } from "@/lib/db";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { sniffType } from "@/lib/docreader/sniff";
import { DOC_PATH, MAX_DOC_BYTES } from "@/lib/docupload";

/**
 * Step 2 of an upload: the file is already in storage. Read it back, work out its real type from its first bytes, check its size, spot a copy of a
 * file we already have, and only then register it. A file that fails a check is removed again.
 */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canUploadDocs(me.role)) return NextResponse.json({ error: "Your role cannot upload documents" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { path?: unknown; name?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  const name = typeof body?.name === "string" && body.name ? body.name : "document";
  if (!DOC_PATH.test(path)) return NextResponse.json({ error: "Unexpected file location" }, { status: 400 });

  const supabase = await supabaseServer();
  const drop = async () => { await supabase.storage.from("documents").remove([path]).catch(() => {}); };
  try {
    const dl = await supabase.storage.from("documents").download(path);
    if (dl.error || !dl.data) return NextResponse.json({ error: "The file did not arrive. Please try again." }, { status: 400 });
    const bytes = Buffer.from(await dl.data.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_DOC_BYTES) { await drop(); return NextResponse.json({ error: "The file must be between 1 byte and 25 MB" }, { status: 400 }); }
    const mime = sniffType(bytes);
    if (!mime) { await drop(); return NextResponse.json({ error: "This is not a PDF, JPG, PNG or WebP file" }, { status: 400 }); }

    const sha = createHash("sha256").update(bytes).digest("hex");
    const same = await q<{ storage_path: string }>(`select storage_path from public.documents where sha256 = $1 and duplicate_of is null order by created_at limit 1`, [sha]);
    let keep = path;
    if (same[0] && same[0].storage_path !== path) { keep = same[0].storage_path; await drop(); } // a copy: keep pointing at the first file
    const r = await call<{ id: string; duplicate_of: string | null }>(`select * from public.register_document($1, $2, $3, $4, $5)`, [name, mime, bytes.length, sha, keep]);
    return NextResponse.json({ id: r[0].id, duplicate_of: r[0].duplicate_of, name });
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 500 });
  }
}
