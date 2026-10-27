import { NextResponse, type NextRequest } from "next/server";
import { canExport, currentStaff } from "@/lib/auth";
import { sheetTab } from "@/lib/sheets";

/** One tab of a sheet copy as JSON, for the sheet view's instant tab switching. Owner and administrators only, like the page. */
export async function GET(req: NextRequest) {
  const me = await currentStaff().catch((e) => { console.error(`[sheet-tab] sign-in check failed: ${e instanceof Error ? e.message : String(e)}`); return null; });
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canExport(me.role)) return NextResponse.json({ error: "Only the owner or an administrator can open the sheet copies" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const key = sp.get("key") ?? "", tab = sp.get("tab") ?? "";
  if (!/^[a-z0-9_]{1,60}$/.test(key) || !tab || tab.length > 120) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  let data;
  try {
    data = await sheetTab(key, tab, Math.max(1, Number(sp.get("page")) || 1), (sp.get("q") ?? "").trim().slice(0, 100));
  } catch (e) {
    console.error(`[sheet-tab] failed ${key} / ${tab}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "The tab could not be read" }, { status: 500 });
  }
  // the copies change once a day: the browser may keep a tab for 5 minutes, so going back and forth costs nothing
  return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=300" } });
}
