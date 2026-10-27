import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call } from "@/lib/db";

/** Remove a saved question. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  await call(`select public.ask_delete_saved($1::uuid)`, [id]);
  return NextResponse.json({ ok: true });
}
