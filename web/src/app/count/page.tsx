import { Suspense } from "react";
import { Info, Radio } from "lucide-react";
import { stockList } from "@/lib/queries";
import { mm, num } from "@/lib/format";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { CountScreen } from "./CountScreen";

export default function CountPage() {
  return (
    <>
      <PageHeader title="Physical count" hint="Used in the yard on a phone or tablet. Selling and dispatch carry on while you count; the system keeps track of what moved." />
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-brand/20 bg-brand-soft px-5 py-3.5 text-brand-dark">
        <span className="flex items-center gap-2 font-semibold"><Radio className="h-4 w-4" /> Count window</span>
        <span className="text-[0.92rem]">Not started. When it opens, every plate that comes in or goes out is logged against the window, and the system takes it out of the counted figure for you.</span>
      </div>
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body />
      </Suspense>
      <p className="mt-5 flex items-center gap-2 text-sm text-muted"><Info className="h-4 w-4" /> Preview only: nothing you enter here is saved.</p>
    </>
  );
}

async function Body() {
  const { rows } = await stockList({ all: false, page: 1 }, 400);
  const plates = rows.map((r) => ({
    lot_no: Number(r.lot_no), ident: (r.plate_no ?? r.heat_no) as string, grade: r.grade,
    size: `${mm(r.thk)} × ${mm(r.wid)} × ${mm(r.len)}`, kg: num(r.kg), pcs: num(r.pcs), book: r.book,
  }));
  return <CountScreen plates={plates} />;
}
