import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { call, q, userMessage } from "@/lib/db";

/** The signed-in person's own saved questions. */
export async function GET() {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rows = await q(`select id, title, question, model, scope from public.ask_saved order by created_at desc limit 50`);
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** Save a question (with the model and "Look in" it was asked with). */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { title?: unknown; question?: unknown; model?: unknown; scope?: unknown } | null;
  const question = typeof b?.question === "string" ? b.question.trim() : "";
  if (question.length < 2 || question.length > 600) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  try {
    const r = await call<{ id: string }>(`select public.ask_save_question($1, $2, $3, $4) id`, [
      typeof b?.title === "string" ? b.title : "", question, typeof b?.model === "string" ? b.model : "claude-haiku-5-5", typeof b?.scope === "string" ? b.scope : "all",
    ]);
    return NextResponse.json({ id: r[0].id });
  } catch (e) {
    return NextResponse.json({ error: userMessage(e) }, { status: 400 });
  }
}
