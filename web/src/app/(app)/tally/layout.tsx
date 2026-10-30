import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canSeeBusiness, currentStaff } from "@/lib/auth";
import { SectionTabs } from "@/components/SectionTabs";
import { Card, PageHeader, Skeleton } from "@/components/ui";

const TABS: [string, string][] = [
  ["/tally", "Status"], ["/tally/parties", "Customers and vendors"], ["/tally/receivables", "Debtors vs sheets"], ["/tally/payables", "Creditors vs sheets"], ["/tally/invoices", "Invoices and paperwork"],
];

export default function TallyLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Tally"
        hint="A read-only copy of Sambhav's Tally books, set against your sheets. A small program on the Tally PC reads Tally and sends it here. Nothing is ever written back to Tally." help="These pages are a copy of Tally as it was when the last sync finished (see Status), not a live view. A positive balance means the party owes us; a negative one means we owe them. Debtors and creditors are compared with the payment sheets."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Gate>{children}</Gate>
      </Suspense>
    </>
  );
}

/** Open to every staff login; an outside partner login sees nothing here. */
async function Gate({ children }: { children: ReactNode }) {
  const me = await currentStaff();
  if (!canSeeBusiness(me?.role)) {
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Tally is open to staff logins only.</p></Card>;
  }
  return (
    <>
      <Suspense fallback={null}><SectionTabs tabs={TABS} label="Tally" keep={[]} /></Suspense>
      {children}
    </>
  );
}
