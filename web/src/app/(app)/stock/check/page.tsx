import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { StockFitView } from "@/components/StockFitView";
import { type FitInput, stockFit } from "@/lib/stockfit";

type SP = Promise<Record<string, string | string[] | undefined>>;
const ROWS = 5;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const number = (s: string) => { const n = Number(s.replace(/,/g, "").trim()); return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null; };

export default function StockCheckPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Stock check" hint="Someone asks for a plate: type the grade, thickness and size and see at once whether we have it. Nothing is reserved." help="A plate fits if it is the same grade, its thickness is within 0.05 mm, and it is at least as wide and as long as asked (either way round). A plate that was cut counts at the length that is left. “In stock” means the stock covers the request; “Only part” means some, not all; “Not in stock” means nothing fits." />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const field = "w-full rounded-md border border-line bg-field px-2 py-1.5 text-[0.9rem] focus:border-brand";

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const rows = Array.from({ length: ROWS }, (_, i) => {
    const n = i + 1;
    return { g: one(sp[`g${n}`]).slice(0, 60), t: one(sp[`t${n}`]), w: one(sp[`w${n}`]), l: one(sp[`l${n}`]), q: one(sp[`q${n}`]), u: one(sp[`u${n}`]) || "nos" };
  });
  const asked = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.g.trim() !== "" || r.t.trim() !== "");
  const results = await Promise.all(asked.map(async ({ r, i }) => {
    const qty = number(r.q);
    const input: FitInput = {
      grade: r.g.trim(), thk: number(r.t), width: number(r.w), length: number(r.l),
      needPcs: r.u === "nos" && qty ? Math.round(qty) : null,
      needKg: qty && r.u === "kg" ? qty : qty && r.u === "mt" ? qty * 1000 : null,
    };
    return { i, fit: await stockFit(input) };
  }));

  return (
    <div className="space-y-6">
      <Card>
        <form method="get" className="px-5 py-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-[0.88rem]">
              <thead>
                <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted">
                  {["Grade", "Thickness mm", "Width mm", "Length mm", "Quantity", "Unit"].map((h) => <th key={h} className="px-1 pb-1.5 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const n = i + 1;
                  return (
                    <tr key={n}>
                      <td className="px-1 py-1"><input name={`g${n}`} defaultValue={r.g} placeholder={n === 1 ? "e.g. SA 387 GR 22 CL2" : ""} className={field} autoComplete="off" /></td>
                      <td className="px-1 py-1"><input name={`t${n}`} defaultValue={r.t} inputMode="decimal" className={field + " w-24"} /></td>
                      <td className="px-1 py-1"><input name={`w${n}`} defaultValue={r.w} inputMode="decimal" className={field + " w-24"} /></td>
                      <td className="px-1 py-1"><input name={`l${n}`} defaultValue={r.l} inputMode="decimal" className={field + " w-24"} /></td>
                      <td className="px-1 py-1"><input name={`q${n}`} defaultValue={r.q} inputMode="decimal" className={field + " w-24"} /></td>
                      <td className="px-1 py-1"><select name={`u${n}`} defaultValue={r.u} className={field + " w-24"}><option value="nos">plates</option><option value="kg">kg</option><option value="mt">MT</option></select></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Check stock</button>
            <p className="text-[0.82rem] text-muted">Width and length are optional. With them, only plates big enough (either way round) count.</p>
          </div>
        </form>
      </Card>

      {results.length > 0 && (
        <Card title="Result">
          <div className="space-y-2 px-5 py-4 text-[0.9rem]">
            {results.map(({ i, fit }) => <StockFitView key={i} fit={fit} title={`Row ${i + 1}:`} />)}
          </div>
        </Card>
      )}
    </div>
  );
}
