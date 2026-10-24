import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { ParamSelect } from "@/components/FilterBar";
import { TallyCompare } from "@/components/TallyCompare";
import { compare, readTallyParams } from "@/lib/tally";

type SP = Promise<Record<string, string | undefined>>;

export default function TallyPayablesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readTallyParams(sp);
  const data = await compare("payable", p);
  return (
    <TallyCompare
      title="Creditors: what we owe, Tally against the sheets" path="/tally/payables" exportKind="tally-payables" sp={sp} q={p.q} show={p.show} data={data}
      tallyLabel="Tally balance" sheetLabel="Sheet to pay"
      extra={<ParamSelect name="group" label="Tally group" value={p.group === "all" ? "goods" : p.group} options={[{ value: "goods", label: "Creditors for goods" }, { value: "expenses", label: "Creditors for expenses" }, { value: "both", label: "Both" }]} />}
      note="Tally keeps a separate ledger per kind of dealing (for example “NAME (Pur)”); they are added together by name. The sheet side is the amount still to pay on purchase invoices for Sambhav Pipes & Fittings, which is mostly goods, so “Creditors for goods” is the fair comparison. A supplier we paid in advance shows a negative balance in Tally."
    />
  );
}
