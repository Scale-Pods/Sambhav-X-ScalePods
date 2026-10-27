import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call } from "@/lib/db";

/** Thumbs up or down on an answer (0 clears it). The administrator uses the thumbs-downs to see which lookups need work. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { messageId?: unknown; value?: unknown } | null;
  const id = typeof b?.messageId === "string" && /^[0-9a-f-]{36}$/i.test(b.messageId) ? b.messageId : null;
  const v = b?.value === 1 || b?.value === -1 ? b.value : 0;
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  await call(`select public.ask_set_feedback($1::uuid, $2::smallint)`, [id, v]);
  return NextResponse.json({ ok: true });
}
