import { NextResponse, type NextRequest } from "next/server";
import { canSeeBusiness, currentStaff } from "@/lib/auth";
import { attachmentBytes, liveMailboxes } from "@/lib/mail/live";

const UUID = /^[0-9a-f-]{36}$/i;
const MSG = /^[0-9a-f]{8,40}$/i;
const ATT = /^[A-Za-z0-9_-]{8,3000}$/;
// shown in the browser when asked to (view=1); everything else is only ever downloaded (a picture of type SVG could run script, so it is never shown from here)
const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i;

/** One attachment of a mail in a connected mailbox: staff logins only, and only for a mailbox that is connected to the app. */
export async function GET(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me || !canSeeBusiness(me.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const mb = sp.get("mb") ?? "", m = sp.get("m") ?? "", a = sp.get("a") ?? "";
  if (!UUID.test(mb) || !MSG.test(m) || !ATT.test(a)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!(await liveMailboxes()).some((b) => b.id === mb)) return NextResponse.json({ error: "That mailbox is not connected" }, { status: 404 });
  const name = (sp.get("name") ?? "attachment").replace(/[\r\n"\\/]/g, "_").slice(0, 150) || "attachment";
  const mime = sp.get("mime") ?? "";
  try {
    const bytes = await attachmentBytes(mb, m, a);
    const view = sp.get("view") === "1" && VIEWABLE.test(mime);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": view ? mime : "application/octet-stream",
        "content-disposition": `${view ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Gmail could not give that file" }, { status: 502 });
  }
}
