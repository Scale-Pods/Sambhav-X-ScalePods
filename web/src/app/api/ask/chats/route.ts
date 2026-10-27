import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/auth";
import { listChats } from "@/lib/ask/chats";

/** The signed-in person's own chats, pinned first, newest first. */
export async function GET() {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await listChats(), { headers: { "Cache-Control": "no-store" } });
}
