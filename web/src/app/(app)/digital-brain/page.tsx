import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Card, Skeleton } from "@/components/ui";
import { canExport, canUploadDocs, currentStaff } from "@/lib/auth";
import { AI_MODE_KEY, MODEL_LIST, THINK_HARDER_KEY, defaultModel, label, typicalUsd } from "@/lib/ask/models";
import { providerReady } from "@/lib/ask/providers";
import { spendToday } from "@/lib/ask/chats";
import { SCOPE_LABEL, SCOPES } from "@/lib/ask/tools";
import { AskApp } from "./AskApp";

export const metadata = { title: "Digital Brain · Sambhav Stock" };

export default function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

const STOCK = ["Do we have SA 387 GR 22 CL2, 50 mm, 2500 × 12000?", "How much SA 516 Gr 70 do we have in stock?", "Find the plate with heat number 65534SC"];
const ADMIN = ["Give me the overview", "Which customers owe us the most?", "Which orders are open?", "Show the Tally invoice 730/26-27", "Any new leads this week?"];

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const initialChat = /^[0-9a-f-]{36}$/i.test(sp.chat ?? "") ? sp.chat! : null;
  const me = await currentStaff().catch(() => null);
  const admin = canExport(me?.role);
  const docs = canUploadDocs(me?.role);
  const allowed = admin ? [...SCOPES] : docs ? (["all", "stock", "documents"] as const) : (["all", "stock"] as const);
  const spend = admin ? await spendToday().catch(() => null) : null;
  const roles: Record<string, string> = {};
  for (const [k, v] of [[defaultModel().key, "Digital Brain default"], [AI_MODE_KEY, "AI mode"], [THINK_HARDER_KEY, "Think harder"]]) roles[k] = roles[k] ? roles[k] + ", " + v : v;
  return (
    <>
      <AskApp
        canAttach={docs}
        initialChat={initialChat}
        suggestions={admin ? [...ADMIN, ...STOCK] : STOCK}
        scopes={allowed.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
        models={MODEL_LIST.map((m) => {
          const rs = typicalUsd(m) * 88;
          return { value: m.key, label: label(m), provider: m.provider, ready: providerReady(m.provider), hint: `${m.note} About ₹${rs < 1 ? rs.toFixed(2) : rs.toFixed(1)} a question ($${m.in} in / $${m.out} out per 1M tokens).` };
        })}
        defaultModel={defaultModel().key}
        roles={roles}
        spend={spend}
      />
      {admin && <p className="mt-3 text-[0.82rem] text-muted"><Link href="/digital-brain/log" className="font-medium text-brand hover:underline">See every question that was asked, what it used and what it cost →</Link></p>}
    </>
  );
}
