import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { canSeeBusiness, currentStaff } from "@/lib/auth";
import { OrderTabs } from "@/components/OrderTabs";
import { Card, PageHeader, Skeleton } from "@/components/ui";

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Orders and dispatch" help="Open means at least one order line has not been sent; Complete means every line has. Orders come from the order form (Dispatch FMS sheet). The vehicle register shows what left the yard."
        hint="Customer orders from your order form and Dispatch FMS sheet, which ones are still open, and the vehicle register. A read-only copy that refreshes once a day; keep entering orders in the form for now."
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
    return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Orders and dispatch are open to staff logins only.</p></Card>;
  }
  return (
    <>
      <Suspense fallback={null}><OrderTabs /></Suspense>
      {children}
    </>
  );
}
