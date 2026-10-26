import { NextResponse } from "next/server";
import { canExport, currentStaff } from "@/lib/auth";
import { tallyLive } from "@/lib/tally";

/** What the Tally PC is doing right now (idle, waiting for it to pick up "Sync now", or running with a percent). Polled by the Tally page every few seconds. */
export async function GET() {
  const me = await currentStaff().catch(() => null);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canExport(me.role)) return NextResponse.json({ error: "Only the owner or an administrator can see this" }, { status: 403 });
  return NextResponse.json(await tallyLive(), { headers: { "Cache-Control": "no-store" } });
}
