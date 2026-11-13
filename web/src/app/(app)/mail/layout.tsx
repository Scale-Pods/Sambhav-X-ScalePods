import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canSeeBusiness, currentStaff } from "@/lib/auth";
import { Info } from "@/components/Info";
import { SectionTabs } from "@/components/SectionTabs";
import { Card, Skeleton } from "@/components/ui";

const TABS: [string, string][] = [["/mail", "Overview"], ["/mail/quotations", "Quotations"], ["/mail/inbox", "Inbox"], ["/mail/mailbox", "Mailbox"], ["/mail/clients", "Clients"], ["/mail/leads", "IndiaMART leads"], ["/mail/dispatch", "Mill dispatch"], ["/mail/mailboxes", "Mailboxes"]];

// One slim row: the title, then the tabs. The long explanation sits behind the "i" so the page below gets the room.
const HELP = (
  <>
    <p>Enquiry mail, quotations and clients from your Email Tracker, the leads from IndiaMART, and the mill&apos;s dispatch mails read from the connected mailboxes. The tracker and the leads are read-only copies that refresh once a day.</p>
    <p className="mt-2">Pending means nobody has replied yet. Urgent and Follow up come from the status in the Email Tracker sheet. Leads are enquiries from IndiaMART; buy leads are people who want to buy.</p>
  </>
);

export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

/** Names, emails and phone numbers are in here: staff logins only. */
async function Gate({ children }: { children: ReactNode }) {
  const me = await currentStaff();
  const allowed = canSeeBusiness(me?.role);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-0 border-b border-line">
        <h1 className="pb-2.5 font-display text-[1.45rem] font-extrabold leading-none tracking-[-0.02em]">Mail and leads<Info className="!h-5 !w-5 !text-[0.72rem]">{HELP}</Info></h1>
        {allowed && <Suspense fallback={null}><SectionTabs tabs={TABS} label="Mail and leads" compact /></Suspense>}
      </div>
      {allowed
        ? children
        : <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Mail and leads are open to staff logins only.</p></Card>}
    </>
  );
}
