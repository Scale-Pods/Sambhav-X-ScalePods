import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft, Lock } from "lucide-react";
import { Badge, Card, PageHeader, Skeleton, td, th } from "@/components/ui";
import { canExport, currentStaff } from "@/lib/auth";
import { q } from "@/lib/db";

export default function AskLogPage() {
  return (
    <>
      <Link href="/ask" className="mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to Digital Brain</Link>
      <PageHeader title="Questions asked" hint="Every question the Digital Brain has answered: who asked, which records it looked at, how long it took and what it cost. Only the owner and administrators see this page." />
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body />
      </Suspense>
    </>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));
type Row = { created_at: string; person: string | null; question: string; answer: string | null; tools: { name: string; rows: number | null }[]; usd: number; seconds: number | null; error: string | null; model: string | null };
type Bad = { asked_at: string; person: string; question: string | null; answer: string; model: string | null; tools: { name: string }[] };

async function Body() {
  await connection();
  const me = await currentStaff().catch(() => null);
  if (!canExport(me?.role)) return <Card><p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> Only the owner and administrators can see this.</p></Card>;
  const [rows, bad, [tot]] = await Promise.all([
    q<Row>(`select l.created_at, s.full_name person, l.question, l.answer, l.tools, l.usd::float8 usd, l.seconds::float8 seconds, l.error, l.model
              from public.ask_log l left join public.staff s on s.id = l.staff_id order by l.created_at desc limit 150`),
    q<Bad>(`select asked_at, person, question, answer, model, tools from public.ask_feedback_log()`),
    q<{ n: number; usd: number; errors: number }>(`select count(*)::int n, coalesce(sum(usd), 0)::float8 usd, count(*) filter (where error is not null)::int errors from public.ask_log where created_at > now() - interval '30 days'`),
  ]);
  return (
    <div className="space-y-6">
      <p className="text-[0.92rem] text-muted">Last 30 days: <span className="font-medium text-ink">{tot.n}</span> questions, <span className="font-medium text-ink">${tot.usd.toFixed(2)}</span> spent, <span className="font-medium text-ink">{tot.errors}</span> that failed.</p>
      {bad.length > 0 && (
        <Card title={`Marked "not a good answer" (${bad.length})`}>
          <ul className="divide-y divide-line text-[0.9rem]">
            {bad.map((b, i) => (
              <li key={i} className="px-5 py-3">
                <p className="text-[0.78rem] text-muted">{when(b.asked_at)} · {b.person} · {b.model ?? ""}{b.tools.length ? ` · ${[...new Set(b.tools.map((t) => t.name))].join(", ")}` : ""}</p>
                <p className="mt-0.5 font-medium">{b.question}</p>
                <p className="mt-0.5 whitespace-pre-line text-muted">{b.answer.slice(0, 400)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Recent questions">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem]">
            <thead className="border-b border-line bg-surface/60"><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Question</th><th className={th}>Looked at</th><th className={th}>Model</th><th className={th + " text-right"}>Cost</th><th className={th + " text-right"}>Time</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={i} className="align-top">
                  <td className={td + " whitespace-nowrap"}>{when(r.created_at)}</td>
                  <td className={td + " whitespace-nowrap"}>{r.person ?? ""}</td>
                  <td className={td + " max-w-[26rem]"}><span title={r.answer ?? ""} className="line-clamp-2">{r.question}</span>{r.error && <Badge tone="error">failed</Badge>}</td>
                  <td className={td + " max-w-[14rem] text-[0.82rem] text-muted"}>{[...new Set(r.tools.map((t) => t.name))].join(", ")}</td>
                  <td className={td}>{r.model ?? "—"}</td>
                  <td className={td + " num text-right"}>${r.usd.toFixed(3)}</td>
                  <td className={td + " num text-right"}>{r.seconds != null ? `${r.seconds.toFixed(1)} s` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
