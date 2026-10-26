import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { canExport, currentStaff } from "@/lib/auth";
import { AskBox } from "./AskBox";

export default function AskPage() {
  return (
    <>
      <PageHeader title="Ask" hint="Ask in plain words about stock, orders, money, mail or Tally. It looks the answer up in your records and shows where it came from. It only reads: it cannot change anything." />
      <Suspense fallback={<Card><Skeleton rows={5} /></Card>}>
        <Body />
      </Suspense>
    </>
  );
}

const STOCK = ["Do we have SA 387 GR 22 CL2, 50 mm, 2500 × 12000?", "How much SA 516 Gr 70 do we have in stock?", "Find plate with heat number 65534SC"];
const ADMIN = ["Give me the overview", "Which customers owe us the most?", "Which orders are open?", "Show the Tally invoice 730/26-27", "Any new leads this week?"];

async function Body() {
  const me = await currentStaff().catch(() => null);
  return <AskBox suggestions={canExport(me?.role) ? [...ADMIN, ...STOCK] : STOCK} />;
}
