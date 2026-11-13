import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { Card, Skeleton } from "@/components/ui";
import { contactHints, reminderRows } from "@/lib/reminders";
import { ReminderEditor } from "../ReminderEditor";

type SP = Promise<Record<string, string | undefined>>;

export default function PreparePage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={10} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const party = (sp.party ?? "").trim().slice(0, 200);
  const entity = sp.entity === "SAI" ? "SAI" : "SPF";
  const back = <Link href="/payments/reminders" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> All customers</Link>;
  if (!party) return <>{back}<Card><p className="px-5 py-10 text-muted">Which customer? Choose one from the list.</p></Card></>;
  const [{ asOf, overdue, soon }, hints] = await Promise.all([reminderRows(party, entity), contactHints(party).catch(() => [])]);
  if (overdue.length === 0) return <>{back}<Card><p className="px-5 py-10 text-muted">{party} has no invoice past its due date, so there is nothing to remind about.</p></Card></>;
  return (
    <>
      {back}
      <h2 className="mb-4 font-display text-[1.3rem] font-bold tracking-[-0.01em]">Payment reminder: {party}</h2>
      <ReminderEditor party={party} entity={entity} asOf={asOf} overdue={overdue} soon={soon} hints={hints} />
    </>
  );
}
