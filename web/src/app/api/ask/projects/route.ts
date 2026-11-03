import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call, userMessage } from "@/lib/db";
import { listProjects } from "@/lib/ask/chats";

/** The signed-in person's own projects (a name, their standing instructions, how many chats). */
export async function GET() {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await listProjects().catch(() => []), { headers: { "Cache-Control": "no-store" } });
}

/** Make a project. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { name?: unknown; instructions?: unknown } | null;
  if (typeof b?.name !== "string" || b.name.trim().length === 0) return NextResponse.json({ error: "Give the project a name." }, { status: 400 });
  try {
    const r = await call<{ id: string }>(`select public.ask_project_save(null, $1, $2) id`, [b.name, typeof b.instructions === "string" ? b.instructions : ""]);
    return NextResponse.json({ id: r[0].id });
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 400 });
  }
}
