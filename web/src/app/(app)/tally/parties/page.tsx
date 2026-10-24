import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { ParamSearch, ParamSelect } from "@/components/FilterBar";
import { ListFooter, PayTable, linker, type Col } from "@/components/PayList";
import { PAGE_SIZE } from "@/lib/payments";
import { partiesList, readTallyParams, type PartyRow } from "@/lib/tally";
import { amount, rupeesShort } from "@/lib/money";

type SP = Promise<Record<string, string | undefined>>;

export default function PartiesPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

const GROUP_LABEL: Record<string, string> = { "Sundry Debtors": "Customer", "SUNDRY CREDITORS (FOR GOODS)": "Vendor (goods)", "SUNDRY CREDITORS (FOR EXPENSES)": "Vendor (expenses)" };

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readTallyParams(sp);
  const d = await partiesList(p);
  const link = linker("/tally/parties", sp);
  const cols: Col<PartyRow>[] = [
    { label: "Name", cell: (r) => <span className="font-semibold">{r.name}</span>, nowrap: false },
    { label: "Kind", cell: (r) => GROUP_LABEL[r.parent_group ?? ""] ?? r.parent_group },
    { label: "GSTIN", cell: (r) => r.gstin },
    { label: "State", cell: (r) => r.state },
    { label: "In your orders", right: true, cell: (r) => (Number(r.orders) > 0 ? <Badge tone="info">{r.orders} order{Number(r.orders) === 1 ? "" : "s"}</Badge> : null) },
    { label: "Balance (₹)", right: true, cell: (r) => (r.balance == null || Number(r.balance) === 0 ? "" : <span className={Number(r.balance) > 0 ? "font-semibold" : "text-muted"}>{amount(Math.abs(Number(r.balance)))} {Number(r.balance) > 0 ? "Dr" : "Cr"}</span>) },
  ];
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ParamSelect name="group" label="Kind" value={p.group} options={[{ value: "all", label: "All" }, { value: "debtors", label: "Customers" }, { value: "goods", label: "Vendors (goods)" }, { value: "expenses", label: "Vendors (expenses)" }, { value: "other", label: "Other accounts" }]} />
        <ParamSelect name="show" label="Show" value={p.show} options={[{ value: "all", label: "Everything" }, { value: "owing", label: "With a balance" }, { value: "nogstin", label: "Customers and vendors with no GSTIN" }]} />
        <ParamSearch placeholder="Name, GSTIN" value={p.q} />
      </div>
      <Card title="Tally ledgers">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} exportHref={link({ page: undefined }, "/api/export/tally-parties")} format={rupeesShort}
          sum={d.debit - d.credit} sumLabel="Net (Dr − Cr)" />
      </Card>
    </>
  );
}
