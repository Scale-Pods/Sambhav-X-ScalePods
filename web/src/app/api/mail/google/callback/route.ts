import { NextResponse, type NextRequest } from "next/server";
import { canExport, currentStaff } from "@/lib/auth";
import { serviceQuery } from "@/lib/db";
import { seal } from "@/lib/mail/crypto";
import { exchangeCode, gmail } from "@/lib/mail/google";

/** Google sends the person back here with a one-time code. It is swapped for a refresh token, which is stored encrypted next to the mailbox. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (query: string) => { const r = NextResponse.redirect(new URL(`/mail/mailboxes?${query}`, url.origin)); r.cookies.delete({ name: "mail_oauth", path: "/api/mail/google" }); return r; };
  const me = await currentStaff().catch(() => null);
  if (!me || !canExport(me.role)) return NextResponse.json({ error: "Only the owner or an administrator may connect a mailbox." }, { status: 403 });
  if (url.searchParams.get("error")) return back(`error=${encodeURIComponent("Google did not allow it: " + url.searchParams.get("error"))}`);
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state || !code || state !== req.cookies.get("mail_oauth")?.value) return back("error=" + encodeURIComponent("The sign-in could not be checked. Please press Connect Gmail again."));
  try {
    const t = await exchangeCode(code, url.origin);
    if (!t.refresh_token) return back("error=" + encodeURIComponent("Google did not give a lasting login. Remove this app's access in your Google account and connect again."));
    const profile = await gmail<{ emailAddress: string }>(t.access_token, "/profile");
    const address = profile.emailAddress.toLowerCase();
    let [box] = await serviceQuery<{ id: string }>(`select id from public.mailboxes where lower(address) = $1`, [address]);
    if (!box) {
      [box] = await serviceQuery<{ id: string }>(
        `insert into public.mailboxes (address, kind, entity_id, owner_staff_id) values ($1, $2::public.mailbox_kind, (select id from public.entities where code = 'SPF'), $3) returning id`,
        [address, /@(gmail|googlemail)\.com$/.test(address) ? "gmail_consumer" : "workspace", me.id]);
    }
    await serviceQuery(
      `insert into public.mailbox_tokens (mailbox_id, token_enc, connected_by) values ($1, $2, $3)
       on conflict (mailbox_id) do update set token_enc = excluded.token_enc, connected_by = excluded.connected_by, connected_at = now(), last_error = null`,
      [box.id, seal(t.refresh_token), me.id]);
    await serviceQuery(`update public.mailboxes set active = true where id = $1`, [box.id]);
    return back(`connected=${encodeURIComponent(address)}`);
  } catch (e) {
    return back("error=" + encodeURIComponent(e instanceof Error ? e.message.slice(0, 200) : "The mailbox could not be connected."));
  }
}
