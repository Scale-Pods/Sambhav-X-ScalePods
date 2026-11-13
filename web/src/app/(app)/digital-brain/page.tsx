import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui";
import { AskBody } from "./AskBody";

export const metadata = { title: "Digital Brain · Sambhav Stock" };

export default function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
      <AskBody searchParams={searchParams} />
    </Suspense>
  );
}
