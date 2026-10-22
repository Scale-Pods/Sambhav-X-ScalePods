import Link from "next/link";
import { Badge } from "@/components/ui";
import type { Read } from "@/lib/docreader/checks";
import type { Matches } from "@/lib/docmatch";

/** What the document looks like next to what we already know. Read-only: it suggests, a person decides. */
export function MatchPanel({ read, m }: { read: Read; m: Matches }) {
  const isOrder = read.is_firm_order && read.direction !== "we_buy_from_supplier" && read.direction !== "our_own_document";
  const lines = m.grades.filter((g) => g.raw !== "");
  return (
    <div className="mb-5 space-y-3 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
      <h3 className="font-display text-[0.95rem] font-bold">Against what we already know</h3>

      <div>
        <span className="mr-2 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Order in the sheets</span>
        {m.orders.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {m.orders.map((o) => (
              <li key={o.order_no}>
                <Badge tone="warning">Already there</Badge>{" "}
                <Link href={`/orders/${encodeURIComponent(o.order_no)}`} className="font-medium text-brand hover:underline">Order {o.order_no}</Link>
                <span className="text-muted"> · {o.client} · PO {o.po_no} · {o.order_date ?? "no date"} · {o.status}</span>
              </li>
            ))}
          </ul>
        ) : isOrder ? (
          <span>{read.po_number || read.document_number ? <Badge tone="info">Not found</Badge> : <Badge>No PO number to look up</Badge>} <span className="text-muted">{read.po_number || read.document_number ? "No order in the Dispatch FMS has this PO number, so this looks new." : "Check by customer and sizes."}</span></span>
        ) : <span className="text-muted">Not an incoming order, so nothing to look up.</span>}
      </div>

      {read.buyer_name && (
        <div>
          <span className="mr-2 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Customer</span>
          {m.customers.length === 0 ? <><Badge tone="info">New name</Badge> <span className="text-muted">No similar customer in the orders so far.</span></>
            : (
              <ul className="mt-1 space-y-0.5">
                {m.customers.map((c, i) => (
                  <li key={c.client}>
                    {i === 0 && (m.exactCustomer ? <Badge tone="ok">Known customer</Badge> : <Badge tone="warning">Closest match</Badge>)}{" "}
                    <span className="font-medium">{c.client}</span>
                    <span className="text-muted"> · {c.orders} order{c.orders === 1 ? "" : "s"}{c.last_order ? `, last ${c.last_order}` : ""} · {Math.round(c.score * 100)}% alike</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {lines.length > 0 && (
        <div>
          <span className="mr-2 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Grades</span>
          <ul className="mt-1 space-y-0.5">
            {lines.map((g) => (
              <li key={g.line}>
                <span className="text-muted">Line {g.line + 1}: </span>
                <span className="font-medium">{g.raw}</span>{" → "}
                {g.how === "list" ? <Badge tone="ok">{g.code}</Badge>
                  : g.how === "close" ? <><Badge tone="warning">Not an exact spelling</Badge> <span className="text-muted">closest: {g.candidates.join(", ")}</span></>
                  : <Badge tone="error">Not in the grade list</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
