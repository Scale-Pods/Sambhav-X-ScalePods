import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth";
import { ask, type Turn } from "@/lib/ask/engine";

export const maxDuration = 60;

/** A question in plain words. Answered from the read-only lookups the person's role may use; see lib/ask. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { question?: unknown; history?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (question.length < 2 || question.length > 600) return NextResponse.json({ ok: false, error: "Ask a question of up to 600 characters." }, { status: 400 });
  const history: Turn[] = Array.isArray(body?.history)
    ? (body!.history as unknown[]).filter((h): h is Turn => typeof (h as Turn)?.q === "string" && typeof (h as Turn)?.a === "string").slice(-3)
    : [];
  const r = await ask(question, history, me.role);
  return NextResponse.json(r, { status: r.ok ? 200 : 429 });
}
