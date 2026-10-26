import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { ACCEPTED_TYPES } from "@/lib/docreader/engine";
import { MAX_DOC_BYTES } from "@/lib/docupload";

/**
 * Step 1 of an upload: check who is asking and what they claim to send, and hand back a one-time signed link so the browser can send the file
 * straight to storage (a file does not pass through this server, so the host's 4.5 MB request limit does not apply). Step 2 is /finish.
 */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canUploadDocs(me.role)) return NextResponse.json({ error: "Your role cannot upload documents" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { name?: unknown; size?: unknown; mime?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const size = typeof body?.size === "number" ? body.size : 0;
  const mime = typeof body?.mime === "string" ? body.mime : "";
  if (!name) return NextResponse.json({ error: "No file was named" }, { status: 400 });
  if (!ACCEPTED_TYPES.includes(mime)) return NextResponse.json({ error: "Only PDF, JPG, PNG and WebP files can be read" }, { status: 400 });
  if (!Number.isFinite(size) || size < 1 || size > MAX_DOC_BYTES) return NextResponse.json({ error: "The file must be between 1 byte and 25 MB" }, { status: 400 });

  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safe}`;
  const supabase = await supabaseServer();
  const r = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (r.error || !r.data) return NextResponse.json({ error: "The upload could not be started" }, { status: 500 });
  return NextResponse.json({ path, token: r.data.token });
}
