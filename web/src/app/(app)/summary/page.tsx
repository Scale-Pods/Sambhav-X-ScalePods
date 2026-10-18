import Link from "next/link";
import { Suspense } from "react";
import { summaryRows } from "@/lib/queries";
import { kg, mm, num } from "@/lib/format";
import { Card, PageHeader, Skeleton, th, td } from "@/components/ui";

type SP = Promise<{ book?: string }>;

export default function SummaryPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Summary"
        hint="Same layout as your Summary sheet: grade and thickness, with what was bought, what was sold and what is left. The balance is calculated, never typed."
      />
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  const { book = "WB1" } = await searchParams;
  const rows = await summaryRows(book);
  const grades = [...new Set(rows.map((r) => r.grade))];
  const tot = rows.reduce((a, r) => ({ recv: a.recv + num(r.recv), sold: a.sold + num(r.sold), kg: a.kg + num(r.kg), plates: a.plates + num(r.plates) }), { recv: 0, sold: 0, kg: 0, plates: 0 });
  return (
    <Card
      aside={
        <div className="flex rounded-lg bg-surface p-1 text-sm font-medium">
          {["WB1", "WB2"].map((b) => (
            <Link key={b} href={`/summary?book=${b}`} className={"rounded-md px-4 py-1.5 " + (b === book ? "bg-field text-brand-dark shadow-sm" : "text-muted")}>
              {b === "WB1" ? "WB1 · SPF alloy plates" : "WB2 · SPF + RS"}
            </Link>
          ))}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-surface/60">
            <tr>
              <th className={th}>Grade</th><th className={th}>Thickness</th>
              <th className={th + " text-right"}>Purchased (kg)</th><th className={th + " text-right"}>Sold (kg)</th>
              <th className={th + " text-right"}>Balance (kg)</th><th className={th + " text-right"}>Plates left</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => {
              const gr = rows.filter((r) => r.grade === g);
              const sub = gr.reduce((a, r) => ({ recv: a.recv + num(r.recv), sold: a.sold + num(r.sold), kg: a.kg + num(r.kg) }), { recv: 0, sold: 0, kg: 0 });
              return (
                <GradeBlock key={g} grade={g} rows={gr} sub={sub} />
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-line bg-brand-soft/60">
            <tr>
              <td className={td + " font-semibold"} colSpan={2}>Total {book}</td>
              <td className={td + " num text-right font-semibold"}>{kg(tot.recv)}</td>
              <td className={td + " num text-right font-semibold"}>{kg(tot.sold)}</td>
              <td className={td + " num text-right font-semibold text-brand-dark"}>{kg(tot.kg)}</td>
              <td className={td + " num text-right font-semibold"}>{kg(tot.plates)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function GradeBlock({ grade, rows, sub }: { grade: string; rows: { thk: string; recv: string; sold: string; kg: string; plates: string }[]; sub: { recv: number; sold: number; kg: number } }) {
  return (
    <>
      <tr className="border-t border-line bg-surface/70">
        <td className={td + " font-semibold"} colSpan={2}>{grade}</td>
        <td className={td + " num text-right font-semibold"}>{kg(sub.recv)}</td>
        <td className={td + " num text-right font-semibold"}>{kg(sub.sold)}</td>
        <td className={td + " num text-right font-semibold"}>{kg(sub.kg)}</td>
        <td className={td}></td>
      </tr>
      {rows.map((r) => (
        <tr key={r.thk} className="border-t border-line/70 hover:bg-brand-soft/30">
          <td className={td}></td>
          <td className={td + " num"}>
            <Link href={`/stock?q=${encodeURIComponent(grade)}`} className="hover:text-brand hover:underline">{mm(r.thk)} mm</Link>
          </td>
          <td className={td + " num text-right"}>{kg(r.recv)}</td>
          <td className={td + " num text-right"}>{kg(r.sold)}</td>
          <td className={td + " num text-right font-medium " + (num(r.kg) < -0.5 ? "text-bad" : "")}>{kg(r.kg)}</td>
          <td className={td + " num text-right text-muted"}>{kg(r.plates)}</td>
        </tr>
      ))}
    </>
  );
}
