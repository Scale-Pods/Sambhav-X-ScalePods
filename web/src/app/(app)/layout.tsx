import { Suspense, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { Gate } from "@/components/Gate";
import { Skeleton } from "@/components/ui";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <Suspense fallback={<Skeleton rows={8} />}>
        <Gate>{children}</Gate>
      </Suspense>
    </Shell>
  );
}
