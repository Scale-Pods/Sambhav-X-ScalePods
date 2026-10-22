import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { PayTabs } from "@/components/PayTabs";
import { Card, PageHeader, Skeleton } from "@/components/ui";

export default function PaymentsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Invoices and payments"
        hint="Sales and purchase invoices, expenses, and who owes what, read from your Payment Better sheets and forms. A read-only copy that refreshes once a day; keep entering new bills in the forms for now."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Gate>{children}</Gate>
      </Suspense>
    </>
  );
}

/** Money pages are for the owner and administrators for now. */
async function Gate({ children }: { children: ReactNode }) {
  const me = await currentStaff();
  if (!canExport(me?.role)) {
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Invoices and payments are open to the owner and administrators for now.</p></Card>;
  }
  return (
    <>
      <Suspense fallback={null}><PayTabs /></Suspense>
      {children}
    </>
  );
}
