import "server-only";
import { canSeeBusiness, currentStaff } from "./auth";
import { serviceQuery } from "./db";

// Which mailbox a Mail & leads page is showing. Two kinds of source feed these pages:
//  - the Email Tracker sheet, a copy of one mailbox's tracker (quotations, inbox, clients), and
//  - the mailboxes connected to the app by Google sign-in, from which only the mill's dispatch mails are read.
// The choice is the "mb" address parameter: "all" (default), "tracker", or a connected mailbox's id.

/** The mailbox the Email Tracker sheet reads (named as the "Digest Email" in the sheet's settings). */
export const TRACKER_ADDRESS = "sambhavpipes@gmail.com";

export type Source = { value: string; label: string; address: string; kind: "tracker" | "mailbox"; connected: boolean; last_synced_at: string | null; id: string | null };
export type Scope = {
  sources: Source[];
  value: string;                 // the choice, as written in the address
  tracker: boolean;              // do the tracker sheet's pages (overview, quotations, inbox, clients) apply to this choice?
  mailboxIds: string[] | null;   // the connected mailboxes whose dispatch mails apply; null = all of them
  label: string;                 // the choice in words
  admin: boolean;                // may add or remove a mailbox
};

/** The sources for the dropdown. Mail is open to every staff login; the list holds no secrets (never the Google login). */
export async function mailSources(): Promise<Source[]> {
  const me = await currentStaff().catch(() => null);
  if (!canSeeBusiness(me?.role)) return [];
  const [t] = await serviceQuery<{ at: string | null }>(`select last_synced_at::text at from public.sheet_sources where key = 'email_tracker'`);
  const boxes = await serviceQuery<{ id: string; address: string; last_synced_at: string | null }>(
    `select m.id, m.address, m.last_synced_at::text from public.mailboxes m join public.mailbox_tokens k on k.mailbox_id = m.id where m.active order by m.address`);
  const trackerBox = boxes.find((b) => b.address.toLowerCase() === TRACKER_ADDRESS);
  const out: Source[] = [{ value: "tracker", label: `${TRACKER_ADDRESS} (Email Tracker)`, address: TRACKER_ADDRESS, kind: "tracker", connected: Boolean(trackerBox), last_synced_at: t?.at ?? null, id: trackerBox?.id ?? null }];
  for (const b of boxes) if (b.address.toLowerCase() !== TRACKER_ADDRESS) out.push({ value: b.id, label: b.address, address: b.address, kind: "mailbox", connected: true, last_synced_at: b.last_synced_at, id: b.id });
  return out;
}

export async function mailScope(raw: string | undefined): Promise<Scope> {
  const sources = await mailSources();
  const me = await currentStaff().catch(() => null);
  const admin = me?.role === "owner" || me?.role === "admin";
  const hit = sources.find((s) => s.value === raw);
  if (!hit) return { sources, value: "all", tracker: true, mailboxIds: null, label: "All mailboxes", admin };
  if (hit.kind === "tracker") return { sources, value: "tracker", tracker: true, mailboxIds: hit.id ? [hit.id] : [], label: hit.label, admin };
  return { sources, value: hit.value, tracker: false, mailboxIds: [hit.id as string], label: hit.label, admin };
}
