import { mailScope } from "@/lib/mailboxes";
import { MailboxSelect } from "./MailboxSelect";

/** The mailbox dropdown for a Mail & leads page: `mb` is the page's "mb" address parameter. */
export async function MailboxFilter({ mb }: { mb: string | undefined }) {
  const s = await mailScope(mb);
  return <MailboxSelect value={s.value} options={s.sources.map((x) => ({ value: x.value, label: x.label }))} canAdd={s.admin} />;
}

/** Shown on a tracker page (overview, quotations, clients) when the chosen mailbox has no tracker data. */
export function NoTracker({ what, label }: { what: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-5 py-10 text-center">
      <p className="font-semibold">{what} come from the Email Tracker sheet.</p>
      <p className="mt-1 text-[0.9rem] text-muted">{label} is read for the mill&apos;s dispatch mails only. Its mails are in the Inbox and under Mill dispatch.</p>
    </div>
  );
}
