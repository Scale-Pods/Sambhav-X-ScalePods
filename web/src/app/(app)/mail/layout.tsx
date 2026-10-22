import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { SectionTabs } from "@/components/SectionTabs";
import { Card, PageHeader, Skeleton } from "@/components/ui";

const TABS: [string, string][] = [["/mail", "Overview"], ["/mail/quotations", "Quotations"], ["/mail/inbox", "Inbox"], ["/mail/clients", "Clients"], ["/mail/leads", "IndiaMART leads"]];

export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Mail and leads"
        hint="Enquiry mail, quotations and clients from your Email Tracker, and the leads from IndiaMART. A read-only copy that refreshes once a day; the Email Tracker sheet keeps doing its work for now."
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
  if (!canExport(me?.role)) {
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Mail and leads are open to the owner and administrators for now.</p></Card>;
  }
  return (
    <>
      <Suspense fallback={null}><SectionTabs tabs={TABS} label="Mail and leads" /></Suspense>
      {children}
    </>
  );
}
