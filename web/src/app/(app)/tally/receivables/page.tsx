import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { TallyCompare } from "@/components/TallyCompare";
import { compare, readTallyParams } from "@/lib/tally";

type SP = Promise<Record<string, string | undefined>>;

export default function TallyReceivablesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readTallyParams(sp);
  const data = await compare("receivable", p);
  return (
    <TallyCompare
      title="Debtors: what customers owe, Tally against the sheets" path="/tally/receivables" exportKind="tally-receivables" sp={sp} q={p.q} show={p.show} data={data}
      tallyLabel="Tally balance" sheetLabel="Sheet pending"
      note="Tally keeps a separate ledger for each kind of dealing with a party (for example “NAME (Sale)” and “NAME (Rent)”); they are added together here by name. The sheet side is the pending amount in your Debtors sheet for Sambhav Pipes & Fittings. A customer who paid in advance shows a negative balance in Tally."
    />
  );
}
