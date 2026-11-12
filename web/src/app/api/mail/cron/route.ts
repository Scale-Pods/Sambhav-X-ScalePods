import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncAll } from "@/lib/mill/sync";

export const maxDuration = 60;

/** Started every 15 minutes by Vercel's scheduler (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>"; nobody is signed in. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const results = await syncAll();
  return NextResponse.json({ ok: results.every((r) => !r.error), results });
}
