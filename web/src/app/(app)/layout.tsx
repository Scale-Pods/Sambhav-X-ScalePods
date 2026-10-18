import { Suspense, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { Gate } from "@/components/Gate";
import { BrandLoader } from "@/components/ui";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <Suspense fallback={<BrandLoader />}>
        <Gate>{children}</Gate>
      </Suspense>
    </Shell>
  );
}
