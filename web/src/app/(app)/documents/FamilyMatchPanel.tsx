import Link from "next/link";
import { Badge } from "@/components/ui";
import type { InvoiceMatch, LotHit, MtcMatch } from "@/lib/docmatch_family";

const kg = (n: number | null) => (n == null ? "" : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)} kg`);
const rs = (n: number | null) => (n == null ? "" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n));
const label = "mr-2 text-[0.72rem] font-semibold uppercase tracking-wider text-muted";

function Hits({ hits }: { hits: LotHit[] }) {
  return (
    <>
      {hits.map((h) => (
        <span key={h.lot_no} className="mr-3 inline-block">
          <Link href={`/plates/${h.lot_no}`} className="font-medium text-brand hover:underline">Plate {h.lot_no}</Link>
          <span className="text-muted"> {h.grade ?? ""} {h.thickness_mm != null ? `${h.thickness_mm} mm` : ""} · {h.status}{h.balance_kg ? ` · ${kg(h.balance_kg)}` : ""}</span>
        </span>
      ))}
    </>
  );
}

/** A vendor invoice or a mill certificate next to what we already hold. Read-only: it suggests, a person decides. */
export function FamilyMatchPanel({ m }: { m: InvoiceMatch | MtcMatch }) {
  return (
    <div className="mb-5 space-y-3 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
      <h3 className="font-display text-[0.95rem] font-bold">Against what we already know</h3>
      {m.family === "invoice" ? (
        <>
          <div>
            <span className={label}>Vendor in Tally</span>
            {m.ledger ? <><Badge tone="ok">Found</Badge> <span className="font-medium">{m.ledger.name}</span> <span className="text-muted">(by {m.ledger.how === "gstin" ? "GSTIN" : "name"})</span></> : <><Badge tone="info">Not found</Badge> <span className="text-muted">No ledger with this GSTIN or name: a new vendor, or a misread GSTIN.</span></>}
          </div>
          <div>
            <span className={label}>Already in Tally</span>
            {m.vouchers.length ? (
              <ul className="mt-1 space-y-0.5">{m.vouchers.map((v) => <li key={v.voucher_no + v.date}><Badge tone="warning">Already there</Badge> <span className="font-medium">Purchase voucher {v.voucher_no}</span> <span className="text-muted">· {v.date} · {rs(v.amount)} · {v.party} · matched on {v.how}{v.reference ? ` · their ref ${v.reference}` : ""}</span></li>)}</ul>
            ) : <><Badge tone="info">Not found</Badge> <span className="text-muted">No purchase voucher with this invoice number, or this amount near this date.</span></>}
          </div>
          {m.sheet.length > 0 && (
            <div>
              <span className={label}>In the payment sheets</span>
              <ul className="mt-1 space-y-0.5">{m.sheet.map((s, i) => <li key={i}><Badge tone="warning">Already there</Badge> <span className="font-medium">{s.invoice_no}</span> <span className="text-muted">· {s.entity} · {s.vendor} · {s.invoice_date ?? ""} · {rs(s.amount)}</span></li>)}</ul>
            </div>
          )}
          {m.same_invoice.length > 0 && (
            <div>
              <span className={label}>Uploaded before</span>
              {m.same_invoice.map((d) => <Link key={d.id} href={`/documents/${d.id}`} className="mr-3 font-medium text-brand hover:underline">{d.file}</Link>)}
              <Badge tone="warning">same invoice number</Badge>
            </div>
          )}
          {m.plates.length > 0 && (
            <div>
              <span className={label}>Plates on the lines</span>
              <ul className="mt-1 space-y-0.5">{m.plates.map((p, i) => <li key={i}><span className="font-medium">{p.key}</span> → {p.hits.length ? <Hits hits={p.hits} /> : <Badge tone="info">not in our books yet</Badge>}</li>)}</ul>
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <span className={label}>Certificate</span>
            {m.filed.length ? <><Badge tone="warning">Already filed</Badge> <span className="text-muted">{m.filed.map((f) => `${f.cert_no} · ${f.links} plate link${f.links === 1 ? "" : "s"}`).join("; ")}</span></> : <><Badge tone="info">Not filed yet</Badge> <span className="text-muted">Confirming files it and links the plates below.</span></>}
            {m.same_certificate.length > 0 && <div className="mt-1">{m.same_certificate.map((d) => <Link key={d.id} href={`/documents/${d.id}`} className="mr-3 font-medium text-brand hover:underline">{d.file}</Link>)}<Badge tone="warning">same certificate number</Badge></div>}
          </div>
          <div>
            <span className={label}>Plates in our books</span>
            <ul className="mt-1 space-y-0.5">
              {m.items.map((it, i) => (
                <li key={i}>
                  <span className="text-muted">Row {i + 1}: </span><span className="font-medium">{[it.heat_no && `heat ${it.heat_no}`, it.plate_no && `plate ${it.plate_no}`].filter(Boolean).join(" · ") || "no number"}</span>{" → "}
                  {it.hits.length ? <Hits hits={it.hits} /> : <Badge tone="info">not in our books</Badge>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[0.78rem] text-muted">{m.items.filter((i) => i.hits.length).length} of {m.items.length} rows match plates we hold. Only those are linked when you confirm.</p>
          </div>
        </>
      )}
    </div>
  );
}
