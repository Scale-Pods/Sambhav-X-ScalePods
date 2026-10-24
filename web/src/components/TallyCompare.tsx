import { Badge, Card, Stat } from "./ui";
import { ParamSearch, ParamSelect } from "./FilterBar";
import { ListFooter, PayTable, linker, type Col } from "./PayList";
import { amount, rupeesShort } from "@/lib/money";
import type { CompareRow, CompareSummary } from "@/lib/tally";
import { PAGE_SIZE } from "@/lib/payments";

const STATUS: Record<CompareRow["status"], { tone: "ok" | "warning" | "error" | "info"; label: string }> = {
  same: { tone: "ok", label: "Same" }, differs: { tone: "warning", label: "Differs" }, only_tally: { tone: "info", label: "Only in Tally" }, only_sheet: { tone: "error", label: "Only in sheet" },
};

/** Tally's balance for each party beside what the sheets say is pending. Shared by the debtors and creditors pages. */
export function TallyCompare({ title, path, exportKind, sp, q, show, extra, data, tallyLabel, sheetLabel, note }: {
  title: string; path: string; exportKind: string; sp: Record<string, string | undefined>; q: string; show: string; extra?: React.ReactNode;
  data: { rows: CompareRow[]; summary: CompareSummary; total: number; page: number; pages: number }; tallyLabel: string; sheetLabel: string; note: string;
}) {
  const s = data.summary;
  const gap = s.tally_total - s.sheet_total;
  const pct = s.sheet_total ? (gap / s.sheet_total) * 100 : 0;
  const link = linker(path, sp);
  const cols: Col<CompareRow>[] = [
    { label: "Status", cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    { label: "In Tally", cell: (r) => <span className="font-semibold">{r.tally_name}</span>, nowrap: false },
    { label: "In the sheet", cell: (r) => (r.sheet_name && r.sheet_name !== r.tally_name ? r.sheet_name : r.sheet_name ? <span className="text-muted">same name</span> : null), nowrap: false },
    { label: tallyLabel + " (₹)", right: true, cell: (r) => (r.tally_name ? amount(r.tally) : "") },
    { label: sheetLabel + " (₹)", right: true, cell: (r) => (r.sheet_name ? amount(r.sheet) : "") },
    { label: "Difference (₹)", right: true, cell: (r) => (r.status === "same" ? "" : <span className={Math.abs(r.diff) >= 100000 ? "font-semibold text-bad" : "text-warn"}>{r.diff > 0 ? "+" : "−"}{amount(Math.abs(r.diff))}</span>) },
    { label: "Sheet bills", right: true, cell: (r) => r.bills },
  ];
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={"Tally: " + tallyLabel.toLowerCase()} value={rupeesShort(s.tally_total)} sub="Net of advances and credit balances" />
        <Stat label={"Sheets: " + sheetLabel.toLowerCase()} value={rupeesShort(s.sheet_total)} sub="Sambhav Pipes & Fittings only" />
        <Stat label="Difference" value={(gap >= 0 ? "+" : "−") + rupeesShort(Math.abs(gap))} sub={`${Math.abs(pct).toFixed(1)}% ${gap >= 0 ? "more in Tally" : "less in Tally"}`} tone={Math.abs(pct) > 2 ? "accent" : undefined} />
        <Stat label="Parties" value={String(s.same + s.differs + s.only_tally + s.only_sheet)} sub={`${s.same} same · ${s.differs} differ · ${s.only_tally} only Tally · ${s.only_sheet} only sheet`} />
      </div>
      <p className="mb-5 max-w-3xl text-[0.88rem] text-muted">{note}</p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {extra}
        <ParamSelect name="show" label="Show" value={show} options={[{ value: "all", label: "Everything" }, { value: "gap", label: "Everything that is not the same" }, { value: "differs", label: "Differs" }, { value: "only_tally", label: "Only in Tally" }, { value: "only_sheet", label: "Only in the sheet" }, { value: "same", label: "Same" }]} />
        <ParamSearch placeholder="Party name" value={q} />
      </div>
      <Card title={title}>
        <PayTable cols={cols} rows={data.rows} empty="Nothing matches." />
        <ListFooter total={data.total} page={data.page} pages={data.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/" + exportKind)} format={rupeesShort} />
      </Card>
    </>
  );
}
