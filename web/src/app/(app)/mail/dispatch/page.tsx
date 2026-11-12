import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton, td, Th } from "@/components/ui";
import { MailboxFilter } from "@/components/MailboxFilter";
import { canDecide, currentStaff } from "@/lib/auth";
import { mailScope } from "@/lib/mailboxes";
import { dispatchContext, receiptsList } from "@/lib/mill/view";
import { ReceiptCard, when } from "./ReceiptCard";

export const metadata = { title: "Mill dispatch · Sambhav Stock" };
type SP = Promise<Record<string, string | undefined>>;
const t3 = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n));

export default function DispatchPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={8} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const me = await currentStaff().catch(() => null);
  const decide = canDecide(me?.role);
  const scope = await mailScope(sp.mb);
  const receipts = await receiptsList(scope.mailboxIds);
  const pending = receipts.filter((r) => r.status === "pending"), done = receipts.filter((r) => r.status !== "pending");
  const ctx = await dispatchContext(receipts);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <MailboxFilter mb={sp.mb} />
        <p className="text-[0.85rem] text-muted">The mill&apos;s dispatch mails, read for you. Nothing is added to stock until a person approves it.</p>
      </div>
      {sp.connected && <p className="rounded-lg bg-ok-soft px-4 py-3 text-[0.92rem] text-ok">Connected {sp.connected}.</p>}

      <section aria-label="Waiting for approval" className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Waiting for approval{pending.length ? ` (${pending.length})` : ""}</h2>
        {pending.length === 0 && <Card><p className="px-5 py-8 text-center text-muted">Nothing is waiting{scope.value === "all" ? "" : ` in ${scope.label}`}. When the mill&apos;s mail arrives it appears here.</p></Card>}
        {pending.map((r) => <Card key={r.id}><div className="px-5 py-4"><ReceiptCard r={r} ctx={ctx} canDecide={decide} /></div></Card>)}
      </section>

      {done.length > 0 && (
        <Card title="Earlier mails">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line"><Th>Mail</Th><Th>Mailbox</Th><Th>Received</Th><Th right>Plates</Th><Th right>Tonnes</Th><Th>Decision</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {done.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.subject || "Dispatch details"} {r.is_test && <Badge tone="warning">Test</Badge>}</td>
                    <td className={td + " text-[0.85rem] text-muted"}>{r.mailbox ?? ""}</td>
                    <td className={td}>{when(r.received_at ?? r.created_at)}</td>
                    <td className={td + " text-right"}>{r.totals.rows}</td>
                    <td className={td + " text-right"}>{t3(r.totals.tonnes)}</td>
                    <td className={td}><Badge tone={r.status === "approved" ? "ok" : "neutral"}>{r.status === "approved" ? "Added to stock" : "Set aside"}</Badge> <span className="text-[0.82rem] text-muted">{r.decided_by ? `by ${r.decided_by} · ` : ""}{when(r.decided_at)}{r.note ? ` · ${r.note}` : ""}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
