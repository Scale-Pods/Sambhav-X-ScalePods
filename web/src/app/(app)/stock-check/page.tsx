import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui";
import { AskBody } from "../digital-brain/AskBody";

export const metadata = { title: "Stock check · Sambhav Stock" };

/** Stock check: ask whether we have a plate, in words or with a photo of the enquiry, and get the answer with the plates behind it. The same chat as the Digital Brain, looking only in the stock. */
export default function StockCheckPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
      <AskBody searchParams={searchParams} mode="stock" />
    </Suspense>
  );
}
