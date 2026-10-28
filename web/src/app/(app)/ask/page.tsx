import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Card, Skeleton } from "@/components/ui";
import { canExport, canUploadDocs, currentStaff } from "@/lib/auth";
import { MODELS } from "@/lib/ask/engine";
import { spendToday } from "@/lib/ask/chats";
import { SCOPE_LABEL, SCOPES } from "@/lib/ask/tools";
import { AskApp } from "./AskApp";

export const metadata = { title: "Digital Brain · Sambhav Stock" };

export default function AskPage() {
  return (
    <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
      <Body />
    </Suspense>
  );
}

const STOCK = ["Do we have SA 387 GR 22 CL2, 50 mm, 2500 × 12000?", "How much SA 516 Gr 70 do we have in stock?", "Find the plate with heat number 65534SC"];
const ADMIN = ["Give me the overview", "Which customers owe us the most?", "Which orders are open?", "Show the Tally invoice 730/26-27", "Any new leads this week?"];

async function Body() {
  await connection();
  const me = await currentStaff().catch(() => null);
  const admin = canExport(me?.role);
  const docs = canUploadDocs(me?.role);
  const allowed = admin ? [...SCOPES] : docs ? (["all", "stock", "documents"] as const) : (["all", "stock"] as const);
  const spend = admin ? await spendToday().catch(() => null) : null;
  return (
    <>
      <AskApp
        canAttach={docs}
        suggestions={admin ? [...ADMIN, ...STOCK] : STOCK}
        scopes={allowed.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
        models={(Object.keys(MODELS) as (keyof typeof MODELS)[]).map((k) => ({ value: k, label: MODELS[k].label, hint: MODELS[k].hint }))}
        spend={spend}
      />
      {admin && <p className="mt-3 text-[0.82rem] text-muted"><Link href="/ask/log" className="font-medium text-brand hover:underline">See every question that was asked, what it used and what it cost →</Link></p>}
    </>
  );
}
