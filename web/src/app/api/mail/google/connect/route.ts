import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canExport, currentStaff } from "@/lib/auth";
import { authUrl } from "@/lib/mail/google";

/** Starts "Connect Gmail": sends an administrator to Google to allow read-only access to a mailbox. */
export async function GET(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me || !canExport(me.role)) return NextResponse.json({ error: "Only the owner or an administrator may connect a mailbox." }, { status: 403 });
  const state = randomBytes(16).toString("hex"); // checked again when Google sends the person back
  let to: string;
  try { to = authUrl(new URL(req.url).origin, state); } catch (e) { return NextResponse.redirect(new URL(`/mail/mailboxes?error=${encodeURIComponent(e instanceof Error ? e.message : "not set up")}`, req.url)); }
  const res = NextResponse.redirect(to);
  res.cookies.set("mail_oauth", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/mail/google" });
  return res;
}
