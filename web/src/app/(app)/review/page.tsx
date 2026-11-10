import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { reviewList } from "@/lib/queries";
import { gradeOptions } from "@/lib/analytics";
import { parseFilter } from "@/lib/filters";
import { FilterShell } from "@/components/FilterBar";
import { kg } from "@/lib/format";
import { canDecide, currentStaff } from "@/lib/auth";
import { ApproveButton } from "./ApproveButton";
import { Badge, Card, PageHeader, Skeleton, td, Th } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

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
        title="Needs review" help="Serious needs action, Check should be looked at, Note is for information. Nothing is changed until a person decides, and the decision is recorded."
        hint="Things that need a person to look and decide. Nothing was fixed silently: each item waits until someone approves it, and the decision is recorded. Small notes carried over from the old sheets are kept on their own tab."
      />
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // these pages work out today's date: render them at request time, never while the shell is prepared
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const f = parseFilter(sp as Record<string, string>, "all");
  const view: "decide" | "old" | "all" = sp.view === "old" ? "old" : sp.view === "all" ? "all" : "decide";
  const [{ rows, kinds, total: shown, pageSize }, me, grades] = await Promise.all([reviewList(sp.kind, sp.severity, page, 50, f, view), currentStaff(), gradeOptions()]);
  const pages = Math.max(1, Math.ceil(shown / pageSize));
  const link = (p: number) => { const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); u.set("page", String(p)); return `/review?${u}`; };
  const mayDecide = canDecide(me?.role);
  const isOld = (k: { kind: string; severity: string }) => k.kind === "legacy_data" && k.severity !== "error";
  const count = (list: typeof kinds) => list.reduce((s, k) => s + Number(k.n), 0);
  const nDecide = count(kinds.filter((k) => !isOld(k)));
  const nOld = count(kinds.filter(isOld));
  const inView = kinds.filter((k) => (view === "all" ? true : view === "old" ? isOld(k) : !isOld(k)));
  const chip = (on: boolean) => "rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset " + (on ? "bg-brand text-white ring-brand" : "bg-field text-muted ring-line hover:text-ink");
  const tab = (on: boolean) => "-mb-px border-b-2 px-4 py-2.5 text-[0.95rem] font-semibold " + (on ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink");
  return (
    <FilterShell grades={grades} hide={["unit"]}>
    <Card>
      <div className="flex flex-wrap gap-x-1 border-b border-line px-3 pt-1">
        <Link href="/review" className={tab(view === "decide")}>Needs a decision ({kg(nDecide)})</Link>
        <Link href="/review?view=old" className={tab(view === "old")}>Old sheet notes ({kg(nOld)})</Link>
        <Link href="/review?view=all" className={tab(view === "all")}>Everything ({kg(nDecide + nOld)})</Link>
      </div>
      <p className="border-b border-line bg-surface/50 px-5 py-3 text-[0.88rem] text-muted">
        {view === "old"
          ? "These are small mismatches carried over from your old sheets, for example a sale dated before its receipt, or a row with no receipt date. Nothing here is wrong with the new system. They are listed so that nothing is hidden; you can leave them."
          : view === "all"
            ? "Every open item: the ones that need a decision, and the old sheet notes."
            : "These are the items where a person has to look and decide: a plate sold for more weight than was received, a duplicate plate number, or a sale of a plate that was never purchased. Press Approve once you have checked one; who decided and when is recorded."}
      </p>
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-4">
        <Link href={view === "decide" ? "/review" : `/review?view=${view}`} className={chip(!sp.kind && !sp.severity)}>All ({kg(count(inView))})</Link>
        {inView.map((k) => (
          <Link key={k.kind + k.severity} href={`/review?${view === "decide" ? "" : `view=${view}&`}kind=${k.kind}&severity=${k.severity}`} className={chip(sp.kind === k.kind && sp.severity === k.severity)}>
            {KIND[k.kind] ?? k.kind} · {SEV[k.severity]?.label} ({k.n})
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-surface/60">
            <tr><Th info="Serious needs action, Check should be looked at, Note is for information.">Level</Th><Th>What was found</Th><Th>Plate</Th><Th right>Action</Th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className="align-top hover:bg-surface/60">
                <td className={td + " whitespace-nowrap"}><Badge tone={SEV[r.severity]?.tone} info={r.severity === "error" ? "Serious: a figure is probably wrong and needs action." : r.severity === "warning" ? "Check: something looks odd and should be looked at." : "Note: for information, no action needed."}>{SEV[r.severity]?.label}</Badge></td>
                <td className={td}>
                  <p className="leading-snug">{r.message}</p>
                  <p className="mt-0.5 text-[0.78rem] text-muted">{KIND[r.kind] ?? r.kind}</p>
                </td>
                <td className={td + " whitespace-nowrap"}>{r.lot_no ? <Link href={`/plates/${r.lot_no}`} className="font-medium text-brand hover:underline">Plate #{r.lot_no}</Link> : <span className="text-muted">not loaded</span>}</td>
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
    </FilterShell>
  );
}
