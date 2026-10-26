import { NextResponse } from "next/server";
import { connection } from "next/server";
import { ping } from "@/lib/db";

/** For an uptime monitor: 200 when the site can reach its database, 503 when it cannot. No sign-in and no data, only yes or no. */
export async function GET() {
  await connection();
  const ok = await ping();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
