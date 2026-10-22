import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { PayTable, day, type Col } from "@/components/PayList";
import { orderDetail } from "@/lib/orders";

type P = Promise<{ no: string }>;
type Line = Record<string, string | boolean | null>;
const s = (v: string | boolean | null | undefined) => (v == null || v === "" || v === false ? "" : String(v));
const na = (v: string | boolean | null | undefined) => { const t = s(v); return /^(na|n\/a|no|nil|-)$/i.test(t.trim()) ? "" : t; };

export default function OrderPage({ params }: { params: P }) {
  return <Suspense fallback={<Card><Skeleton rows={10} /></Card>}><Body params={params} /></Suspense>;
}

async function Body({ params }: { params: P }) {
  await connection();
  const { no } = await params;
  if (!/^[0-9A-Za-z\-\/ ]{1,20}$/.test(no)) notFound();
  const { order, lines } = await orderDetail(decodeURIComponent(no));
  if (!order) notFound();
  const first = lines[0] ?? {};
  const facts: [string, string][] = [
    ["Customer", s(order.client)], ["Company", (order.company ?? "").replace("SAI", "Sai")], ["Salesperson", s(order.salesperson)], ["PO no.", s(order.po_no)],
    ["Order date", day(order.order_date)], ["Promised delivery", day(order.etd)], ["Delivery to", s(order.delivery_location)],
    ["Transporter", na(order.transporters)], ["Vehicle", na(order.vehicles)], ["Transport terms", na(first.transport_terms)],
    ["Documents needed", na(first.documents)], ["People needed at loading", na(first.people_needed)], ["Weighing", na(first.weighing)],
    ["Packing and forwarding", na(first.packing)], ["Loading charges", na(first.loading)], ["Freight", na(first.freight)], ["Extra charges", na(first.extra_charges)],
    ["Tests", na(first.tests)], ["Lab", na(first.lab)], ["Inspection", na(first.inspection)], ["Third-party testing", na(first.third_party_testing)], ["Sample cutting", na(first.sample_cutting)],
  ];
  const cols: Col<Line>[] = [
    { label: "Sr", cell: (r) => s(r.sr_no) },
    { label: "Grade", cell: (r) => <span className="font-semibold">{s(r.grade)}</span>, nowrap: false },
    { label: "Size", cell: (r) => s(r.size), nowrap: false },
    { label: "Qty", right: true, cell: (r) => `${s(r.qty)} ${s(r.unit)}`.trim() },
    { label: "Rate", right: true, cell: (r) => s(r.rate) },
    { label: "From", cell: (r) => s(r.material) },
    { label: "Plot", cell: (r) => s(r.plot) },
    { label: "Done", cell: (r) => (r.done ? <Badge tone="ok">Sent</Badge> : <Badge tone="warning">To send</Badge>) },
    { label: "Note", cell: (r) => s(r.instructions), nowrap: false },
  ];
  const notes = lines.map((l) => s(l.ongoing_message) || s(l.completed_note)).filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders/list" className="mb-2 inline-flex items-center gap-1 text-[0.85rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> All orders</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-[1.7rem] font-extrabold tracking-[-0.02em]">Order {order.order_no}</h2>
          <Badge tone={order.status === "Complete" ? "ok" : "warning"}>{order.status === "Complete" ? "Complete" : "Open"}</Badge>
          <span className="text-[0.9rem] text-muted">{order.done_lines} of {order.lines} lines sent</span>
          {order.po_url && /^https?:\/\//i.test(order.po_url) && (
            <a href={order.po_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border border-line bg-field px-3 py-1.5 text-[0.85rem] font-medium text-muted hover:text-ink"><ExternalLink className="h-4 w-4" /> Open the customer PO</a>
          )}
        </div>
      </div>

      <Card title="Order details">
        <dl className="grid gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt className="text-[0.72rem] font-semibold uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5 text-[0.93rem]">{v}</dd></div>
          ))}
        </dl>
      </Card>

      <Card title={`Lines (${lines.length})`}>
        <PayTable cols={cols} rows={lines} />
      </Card>

      {notes.length > 0 && (
        <Card title="Notes from the sheet">
          <ul className="divide-y divide-line">{[...new Set(notes)].map((n, i) => <li key={i} className="px-5 py-3 text-[0.9rem]">{n}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
