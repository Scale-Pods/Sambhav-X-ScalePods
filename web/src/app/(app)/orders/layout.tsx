import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { OrderTabs } from "@/components/OrderTabs";
import { Card, PageHeader, Skeleton } from "@/components/ui";

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Orders and dispatch"
        hint="Customer orders from your order form and Dispatch FMS sheet, which ones are still open, and the vehicle register. A read-only copy that refreshes once a day; keep entering orders in the form for now."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Gate>{children}</Gate>
      </Suspense>
    </>
  );
}

/** Order data is for the owner and administrators for now. */
async function Gate({ children }: { children: ReactNode }) {
  const me = await currentStaff();
  if (!canExport(me?.role)) {
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Orders and dispatch are open to the owner and administrators for now.</p></Card>;
  }
  return (
    <>
      <Suspense fallback={null}><OrderTabs /></Suspense>
      {children}
    </>
  );
}
