import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/auth";
import { listChats } from "@/lib/ask/chats";

/** The signed-in person's own chats, pinned first, newest first. */
export async function GET(req: Request) {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const origin = sp.get("origin") === "ai_mode" || sp.get("origin") === "brain" ? sp.get("origin")! : undefined;
  const search = (sp.get("q") ?? "").trim().slice(0, 60) || undefined;
  return NextResponse.json(await listChats(origin, search), { headers: { "Cache-Control": "no-store" } });
}
