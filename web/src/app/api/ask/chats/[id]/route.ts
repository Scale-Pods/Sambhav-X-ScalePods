import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call, userMessage } from "@/lib/db";
import { getChat } from "@/lib/ask/chats";

type Ctx = { params: Promise<{ id: string }> };
const ID = /^[0-9a-f-]{36}$/i;

/** One chat with its messages. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const c = await getChat(id);
  if (!c) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json(c, { headers: { "Cache-Control": "no-store" } });
}

/** Rename, pin or unpin, move into a project (or out of it), or change the model or "Look in" of a chat. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { title?: unknown; pinned?: unknown; model?: unknown; scope?: unknown; projectId?: unknown } | null;
  try {
    if (b && "projectId" in b) {
      // put the chat into one of the person's projects, or take it out (null)
      const pid = typeof b.projectId === "string" && ID.test(b.projectId) ? b.projectId : null;
      await call(`select public.ask_set_chat_project($1::uuid, $2::uuid)`, [id, pid]);
    }
    if (b && ("title" in b || "pinned" in b || "model" in b || "scope" in b)) {
      await call(`select public.ask_update_chat($1::uuid, $2, $3, $4, $5)`, [
        id, typeof b.title === "string" ? b.title : null, typeof b.pinned === "boolean" ? b.pinned : null, typeof b.model === "string" ? b.model : null, typeof b.scope === "string" ? b.scope : null,
      ]);
    }
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/** Delete a chat (it disappears from the list; the question log for the administrator stays). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  await call(`select public.ask_delete_chat($1::uuid)`, [id]);
  return NextResponse.json({ ok: true });
}
