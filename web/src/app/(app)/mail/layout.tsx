import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canSeeBusiness, currentStaff } from "@/lib/auth";
import { SectionTabs } from "@/components/SectionTabs";
import { Card, PageHeader, Skeleton } from "@/components/ui";

const TABS: [string, string][] = [["/mail", "Overview"], ["/mail/quotations", "Quotations"], ["/mail/inbox", "Inbox"], ["/mail/clients", "Clients"], ["/mail/leads", "IndiaMART leads"], ["/mail/dispatch", "Mill dispatch"], ["/mail/mailboxes", "Mailboxes"]];

export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Mail and leads" help="Pending means nobody has replied yet. Urgent and Follow up come from the status in the Email Tracker sheet. Leads are enquiries from IndiaMART; buy leads are people who want to buy."
        hint="Enquiry mail, quotations and clients from your Email Tracker, the leads from IndiaMART, and the mill's dispatch mails read from the connected mailboxes. The tracker and leads are read-only copies that refresh once a day."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Gate>{children}</Gate>
      </Suspense>
    </>
  );
}

/** Names, emails and phone numbers are in here: the owner and administrators only for now. */
async function Gate({ children }: { children: ReactNode }) {
  const me = await currentStaff();
  if (!canSeeBusiness(me?.role)) {
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Mail and leads are open to staff logins only.</p></Card>;
  }
  return (
    <>
      <Suspense fallback={null}><SectionTabs tabs={TABS} label="Mail and leads" /></Suspense>
      {children}
    </>
  );
}
