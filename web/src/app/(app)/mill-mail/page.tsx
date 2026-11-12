import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, Skeleton, td, Th } from "@/components/ui";
import { canDecide, canExport, currentStaff } from "@/lib/auth";
import { q, serviceQuery } from "@/lib/db";
import type { Consignment, DispatchRow } from "@/lib/mill/dispatchTable";
import { MailboxButtons, ReceiptButtons } from "./Buttons";

export const metadata = { title: "Mill mails · Sambhav Stock" };
type SP = Promise<Record<string, string | undefined>>;

export default function MillMailPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Mill mails" hint="The mill's dispatch mails, read for you. Nothing is added to stock until a person approves it."
        help="The app looks in the connected mailbox for the mill's Dispatch details mails, reads the table in each one and shows it here. Approving adds each plate to the stock book with its pieces and weight, once: the same mill invoice item can never be added twice. Setting a mail aside adds nothing." />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}><Body searchParams={searchParams} /></Suspense>
    </>
  );
}

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "");
const kg = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n * 1000));
const t3 = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n));
const rate = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n));

type Receipt = {
  id: string; status: "pending" | "approved" | "rejected"; rows: DispatchRow[]; consignments: Consignment[]; totals: { rows: number; pieces: number; tonnes: number; value: number }; warnings: string[];
  is_test: boolean; created_at: string; decided_at: string | null; note: string | null; decided_by: string | null;
  subject: string | null; from_name: string | null; from_addr: string | null; received_at: string | null; source_kind: string | null;
};

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const me = await currentStaff().catch(() => null);
  const admin = canExport(me?.role), decide = canDecide(me?.role);

  const receipts = await q<Receipt>(
    `select r.id, r.status, r.rows, r.consignments, r.totals, r.warnings, r.is_test, r.created_at::text, r.decided_at::text, r.note, (select s.full_name from public.staff s where s.id = r.decided_by) decided_by,
            m.subject, m.from_name, m.from_addr, m.received_at::text, m.source_kind
       from public.mill_receipts r left join public.mill_mails m on m.id = r.message_id
      order by (r.status = 'pending') desc, coalesce(m.received_at, r.created_at) desc limit 40`);
  const pending = receipts.filter((r) => r.status === "pending");
  const done = receipts.filter((r) => r.status !== "pending");

  // what would stop an approval: a grade the mill wrote that our list does not know, or a company that has no stock book yet
  const texts = [...new Set(pending.flatMap((r) => r.rows.map((x) => x.grade_text ?? "")).filter(Boolean))];
  const grades = texts.length
    ? await q<{ txt: string; code: string | null }>(
        `select t.txt, g.code from unnest($1::text[]) t(txt)
           left join lateral (select a.grade_id from public.grade_aliases a where translate(a.alias_norm, 'O', '0') = translate(app.norm_text(t.txt), 'O', '0') limit 1) x on true
           left join public.grades g on g.id = x.grade_id`, [texts])
    : [];
  const gradeOf = new Map(grades.map((g) => [g.txt, g.code]));
  const books = new Set((await q<{ code: string }>(`select distinct e.code from public.stock_books b join public.entities e on e.id = b.owner_entity_id`)).map((b) => b.code));

  const boxes = admin
    ? await serviceQuery<{ mailbox_id: string; address: string; last_synced_at: string | null; last_error: string | null; sender_filter: string; subject_filter: string }>(
        `select m.id mailbox_id, m.address, m.last_synced_at::text, t.last_error, t.sender_filter, t.subject_filter from public.mailboxes m join public.mailbox_tokens t on t.mailbox_id = m.id order by m.address`)
    : [];

  return (
    <div className="space-y-6">
      {sp.connected && <p className="rounded-lg bg-ok-soft px-4 py-3 text-[0.92rem] text-ok">Connected {sp.connected}. The app will look for the mill&apos;s mails every 15 minutes.</p>}
      {sp.error && <p className="rounded-lg bg-bad-soft px-4 py-3 text-[0.92rem] text-bad">{sp.error}</p>}

      {admin && (
        <Card title="Mailbox">
          {boxes.length === 0 ? (
            <div className="px-5 py-4">
              <p className="text-[0.95rem]">No mailbox is connected yet. Connect one and the app starts reading the mill&apos;s mails. It can only read: it can never send, change or delete a mail.</p>
              <a href="/api/mail/google/connect" className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Connect Gmail</a>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {boxes.map((b) => (
                <div key={b.mailbox_id} className="space-y-2 px-5 py-4">
                  <p className="font-semibold">{b.address} <Badge tone={b.last_error ? "error" : "ok"}>{b.last_error ? "Problem" : "Connected"}</Badge></p>
                  <p className="text-[0.88rem] text-muted">Looks for mails with &ldquo;{b.subject_filter}&rdquo; in the subject{b.sender_filter ? ` from ${b.sender_filter}` : ""}. Last looked {b.last_synced_at ? when(b.last_synced_at) : "never"}.</p>
                  {b.last_error && <p className="text-[0.88rem] text-bad">{b.last_error}</p>}
                  <MailboxButtons mailboxId={b.mailbox_id} />
                </div>
              ))}
              <div className="px-5 py-3"><a href="/api/mail/google/connect" className="text-[0.88rem] font-medium text-brand hover:underline">Connect another mailbox</a></div>
            </div>
          )}
        </Card>
      )}

      <section aria-label="Waiting for approval" className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Waiting for approval{pending.length ? ` (${pending.length})` : ""}</h2>
        {pending.length === 0 && <Card><p className="px-5 py-8 text-center text-muted">Nothing is waiting. When the mill&apos;s mail arrives it appears here.</p></Card>}
        {pending.map((r) => {
          const unknown = [...new Set(r.rows.filter((x) => x.grade_text && !gradeOf.get(x.grade_text)).map((x) => x.grade_text as string))];
          const noBook = [...new Set(r.rows.map((x) => x.entity).filter((e): e is "SPF" | "SAI" => e != null && !books.has(e)))];
          const blocked = unknown.length ? `The grade ${unknown.map((g) => `"${g}"`).join(", ")} is not in the grade list yet. Add it as a name of the right grade first.` : noBook.length ? `There is no stock book for ${noBook.join(", ")} yet, so these plates cannot be added.` : null;
          return (
            <Card key={r.id}>
              <div className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{r.subject || "Dispatch details"} {r.is_test && <Badge tone="warning">Test mail</Badge>}</p>
                    <p className="text-[0.85rem] text-muted">From {r.from_name || r.from_addr || "?"} · received {when(r.received_at ?? r.created_at)}{r.source_kind ? ` · table read from the ${r.source_kind.replace("_", " ")}` : ""}</p>
                  </div>
                  <p className="text-[0.92rem]"><b>{r.totals.rows}</b> plates · <b>{r.totals.pieces}</b> pieces · <b>{t3(r.totals.tonnes)} t</b></p>
                </div>
                {r.consignments.length > 0 && (
                  <p className="text-[0.85rem] text-muted">{r.consignments.map((c) => `${c.entity ?? "?"} → ${c.destination ?? "?"}, truck ${c.truck_no ?? "?"} (${c.plates} plates, ${t3(c.tonnes)} t)`).join(" · ")}</p>
                )}
                {r.warnings.map((w, i) => <p key={i} className="text-[0.85rem] text-warn">{w}</p>)}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr className="border-b border-line"><Th>Company</Th><Th>Batch (heat)</Th><Th>Grade</Th><Th>Size mm</Th><Th right>Pieces</Th><Th right>Kg</Th><Th right info="Rupees per tonne, from the mill's mail.">Rate/t</Th><Th>Mill invoice item</Th><Th>Check</Th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {r.rows.map((x, i) => (
                        <tr key={i}>
                          <td className={td}>{x.entity ?? "?"}</td>
                          <td className={td + " font-medium"}>{x.batch}</td>
                          <td className={td}>{x.grade_text}{x.grade_text && gradeOf.get(x.grade_text) ? <span className="block text-[0.78rem] text-muted">= {gradeOf.get(x.grade_text)}</span> : x.grade_text ? <span className="block text-[0.78rem] text-warn">not in the grade list</span> : null}</td>
                          <td className={td + " whitespace-nowrap"}>{x.thickness_mm} × {x.width_mm} × {x.length_mm}</td>
                          <td className={td + " text-right"}>{x.pieces}</td>
                          <td className={td + " text-right"}>{kg(x.tonnes)}</td>
                          <td className={td + " text-right"}>{rate(x.upr)}</td>
                          <td className={td + " whitespace-nowrap text-[0.82rem]"}>{x.invoice_item}</td>
                          <td className={td}>{x.warnings.length === 0 ? <Badge tone="ok">OK</Badge> : <span className="text-[0.82rem] text-warn">{x.warnings.join("; ")}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ReceiptButtons id={r.id} canDecide={decide} blocked={blocked} />
              </div>
            </Card>
          );
        })}
      </section>

      {done.length > 0 && (
        <Card title="Earlier mails">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line"><Th>Mail</Th><Th>Received</Th><Th right>Plates</Th><Th right>Tonnes</Th><Th>Decision</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {done.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.subject || "Dispatch details"} {r.is_test && <Badge tone="warning">Test</Badge>}</td>
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
