import { NextResponse, type NextRequest } from "next/server";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { readDocument } from "@/lib/docreader/engine";

export const maxDuration = 300; // a read takes 10-40 seconds; the stronger second read adds to it

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canUploadDocs(me.role)) return NextResponse.json({ error: "Your role cannot read documents" }, { status: 403 });
  const r = await readDocument(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
