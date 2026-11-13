import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Skeleton } from "@/components/ui";
import { canExport, currentStaff } from "@/lib/auth";
import { MailboxView } from "./MailboxView";

export const metadata = { title: "Mailbox · Sambhav Stock" };
type SP = Promise<Record<string, string | undefined>>;

export default function MailboxPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const me = await currentStaff().catch(() => null);
  return <MailboxView sp={sp} admin={canExport(me?.role)} />;
}
