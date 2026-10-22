import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, Skeleton } from "@/components/ui";
import { FilterShell, ParamSelect } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { ListFooter, PayTable, day, linker, type Col } from "@/components/PayList";
import { isoDay } from "@/lib/money";
import { ordersList, readOrderParams, type OrderRow } from "@/lib/orders";
import { PAGE_SIZE } from "@/lib/payments";
import { todayIST } from "@/lib/filters";

type SP = Promise<Record<string, string | undefined>>;

export default function OrdersListPage({ searchParams }: { searchParams: SP }) {
  return <Suspense fallback={<Card><Skeleton rows={12} /></Card>}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const p = readOrderParams(sp);
  const d = await ordersList(p);
  const today = todayIST();
  const link = linker("/orders/list", sp);
  const cols: Col<OrderRow>[] = [
    { label: "Order", cell: (r) => <Link href={`/orders/${r.order_no}`} className="font-semibold text-brand hover:underline">{r.order_no}</Link> },
    { label: "Date", cell: (r) => day(r.order_date) },
    { label: "Company", cell: (r) => (r.company ?? "").replace("SAI", "Sai") },
    { label: "Customer", cell: (r) => r.client, nowrap: false },
    { label: "Salesperson", cell: (r) => r.salesperson },
    { label: "PO no.", cell: (r) => r.po_no },
    { label: "Lines", right: true, cell: (r) => `${r.done_lines}/${r.lines}` },
    { label: "Status", cell: (r) => <Badge tone={r.status === "Complete" ? "ok" : "warning"}>{r.status === "Complete" ? "Complete" : "Open"}</Badge> },
    { label: "Due", cell: (r) => { const late = r.status === "Open" && r.etd && isoDay(r.etd) < today; return <span className={late ? "font-semibold text-bad" : ""}>{day(r.etd)}</span>; } },
    { label: "Material", cell: (r) => r.material },
    { label: "Grades", cell: (r) => r.grades, nowrap: false },
    { label: "Transporter", cell: (r) => r.transporters },
  ];
  return (
    <FilterShell grades={[]} hide={["book", "grade", "thickness", "unit"]}
      extra={<><PayExtras entity={p.company ?? "all"} q={p.q} placeholder="Order, customer, PO, grade, vehicle" />
        <ParamSelect name="show" label="Show" value={p.show} options={[{ value: "all", label: "All orders" }, { value: "open", label: "Open" }, { value: "late", label: "Open and late" }, { value: "complete", label: "Complete" }]} /></>}>
      <Card title="Orders">
        <PayTable cols={cols} rows={d.rows} />
        <ListFooter total={d.total} sum={d.sum} sumLabel="Lines" page={d.page} pages={d.pages} size={PAGE_SIZE} hrefFor={(n) => link({ page: n })} format={(v) => v.toLocaleString("en-IN")} />
      </Card>
    </FilterShell>
  );
}
