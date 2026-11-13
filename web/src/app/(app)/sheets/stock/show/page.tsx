import { notFound, redirect } from "next/navigation";
import { buildHl, parseHl } from "@/lib/highlight";
import { locateHl } from "@/lib/stockSheet";

/** A link that works from anywhere in the app: /sheets/stock/show?hl=a12.d40 finds the book and the tab the marked rows are in and opens the sheet there. */
export default async function Show({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const hl = parseHl(sp.hl);
  const where = await locateHl([...hl.moves.keys()], [...hl.lots]);
  if (!where) {
    if (hl.moves.size === 0 && hl.lots.size === 1) redirect(`/plates/${[...hl.lots][0]}`);
    notFound();
  }
  const keep = buildHl([...hl.moves].map(([seq, tone]) => ({ seq, tone })), [...hl.lots]);
  redirect(`/sheets/stock/${where.book}?${new URLSearchParams({ tab: where.tab, hl: keep })}#t-${where.thk}`);
}
