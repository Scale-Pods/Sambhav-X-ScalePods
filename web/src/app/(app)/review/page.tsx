import Link from "next/link";
import { Suspense } from "react";
import { reviewList } from "@/lib/queries";
import { kg } from "@/lib/format";
import { canDecide, currentStaff } from "@/lib/auth";
import { ApproveButton } from "./ApproveButton";
import { Badge, Card, PageHeader, Skeleton, td, th } from "@/components/ui";

type SP = Promise<{ kind?: string; severity?: string; page?: string }>;

const KIND: Record<string, string> = {
  legacy_data: "Old sheet data",
  weight_warning: "Weight above received",
  duplicate_key: "Duplicate plate number",
  blocked_entry: "Blocked entry",
  other: "Other",
};
const SEV: Record<string, { tone: "error" | "warning" | "info"; label: string }> = {
  error: { tone: "error", label: "Serious" },
  warning: { tone: "warning", label: "Check" },
  info: { tone: "info", label: "Note" },
};

export default function ReviewPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Needs review"
        hint="Things your sheets could not settle on their own. Nothing was fixed silently: each item waits for a person to correct it or approve it, and the decision is recorded."
      />
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [{ rows, kinds, total: shown, pageSize }, me] = await Promise.all([reviewList(sp.kind, sp.severity, page), currentStaff()]);
  const pages = Math.max(1, Math.ceil(shown / pageSize));
  const link = (p: number) => `/review?${new URLSearchParams({ ...(sp.kind ? { kind: sp.kind } : {}), ...(sp.severity ? { severity: sp.severity } : {}), page: String(p) })}`;
  const mayDecide = canDecide(me?.role);
  const total = kinds.reduce((s, k) => s + Number(k.n), 0);
  const chip = (on: boolean) => "rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset " + (on ? "bg-brand text-white ring-brand" : "bg-white text-muted ring-line hover:text-ink");
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-4">
        <Link href="/review" className={chip(!sp.kind && !sp.severity)}>All ({kg(total)})</Link>
        {kinds.map((k) => (
          <Link key={k.kind + k.severity} href={`/review?kind=${k.kind}&severity=${k.severity}`} className={chip(sp.kind === k.kind && sp.severity === k.severity)}>
            {KIND[k.kind] ?? k.kind} · {SEV[k.severity]?.label} ({k.n})
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-surface/60">
            <tr><th className={th}>Level</th><th className={th}>What was found</th><th className={th}>Plate</th><th className={th + " text-right"}>Action</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className="align-top hover:bg-surface/60">
                <td className={td + " whitespace-nowrap"}><Badge tone={SEV[r.severity]?.tone}>{SEV[r.severity]?.label}</Badge></td>
                <td className={td}>
                  <p className="leading-snug">{r.message}</p>
                  <p className="mt-0.5 text-[0.78rem] text-muted">{KIND[r.kind] ?? r.kind}</p>
                </td>
                <td className={td + " whitespace-nowrap"}>{r.lot_no ? <Link href={`/stock/${r.lot_no}`} className="font-medium text-brand hover:underline">Plate #{r.lot_no}</Link> : <span className="text-muted">not loaded</span>}</td>
                <td className={td + " text-right"}>
                  {mayDecide ? <div className="flex justify-end"><ApproveButton id={r.id} /></div> : <span className="text-sm text-muted">view only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
        <span>{kg(shown)} items · page {page} of {pages}. Approving records who decided, when, and why.</span>
        <div className="flex gap-2">
          {page > 1 && <Link href={link(page - 1)} className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface">Previous</Link>}
          {page < pages && <Link href={link(page + 1)} className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface">Next</Link>}
        </div>
      </div>
    </Card>
  );
}
