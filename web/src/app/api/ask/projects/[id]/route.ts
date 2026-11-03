import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call, userMessage } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const ID = /^[0-9a-f-]{36}$/i;

/** Change a project's name or instructions. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { name?: unknown; instructions?: unknown } | null;
  if (typeof b?.name !== "string" || b.name.trim().length === 0) return NextResponse.json({ error: "Give the project a name." }, { status: 400 });
  try {
    await call(`select public.ask_project_save($1::uuid, $2, $3)`, [id, b.name, typeof b.instructions === "string" ? b.instructions : ""]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 400 });
  }
}

/** Remove a project. Its chats are kept and go back to the plain list. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  await call(`select public.ask_project_delete($1::uuid)`, [id]);
  return NextResponse.json({ ok: true });
}
