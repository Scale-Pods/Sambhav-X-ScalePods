import Link from "next/link";
import { Badge } from "@/components/ui";
import type { ChallanMatch, InvoiceMatch, LotHit, MtcMatch } from "@/lib/docmatch_family";

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

const VERDICT: Record<string, { tone: "ok" | "warning" | "error" | "info"; text: string }> = {
  ok: { tone: "ok", text: "In stock" }, short: { tone: "warning", text: "Not enough pieces" }, thickness: { tone: "error", text: "Thickness differs" },
  not_found: { tone: "info", text: "Not in our books" }, several: { tone: "warning", text: "Several plates" }, recorded: { tone: "info", text: "Already in the stock book" },
};

/** An outward challan against our plates, line by line. Read-only: nothing is posted from here. */
function ChallanPanel({ m }: { m: ChallanMatch }) {
  const diff = m.written_kg ? ((m.est_kg - m.written_kg) / m.written_kg) * 100 : null;
  return (
    <div className="mb-5 space-y-3 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
      <h3 className="font-display text-[0.95rem] font-bold">Against our plates</h3>
      {m.same.length > 0 && (
        <div>
          <span className={label}>Seen before</span>
          {m.same.map((d) => <Link key={d.id} href={`/documents/${d.id}`} className="mr-3 font-medium text-brand hover:underline">{d.file}</Link>)}
          <Badge tone="warning">same challan number and company</Badge>
        </div>
      )}
      <ul className="space-y-2">
        {m.lines.map((l) => {
          const v = VERDICT[l.verdict];
          return (
            <li key={l.n} className="border-b border-line pb-2 last:border-0 last:pb-0">
              <span className="text-muted">Line {l.n}: </span><span className="font-medium">{l.key}</span> <Badge tone={v.tone}>{v.text}</Badge>
              {l.hits.length > 0 && <div className="mt-0.5"><Hits hits={l.hits} />{l.best?.balance_pieces != null && <span className="text-muted">· {l.best.balance_pieces} pcs left</span>}</div>}
              {l.est_kg != null && <span className="ml-1 text-[0.82rem] text-muted">about {kg(l.est_kg)}</span>}
              {l.notes.map((n, i) => <p key={i} className="text-[0.82rem] text-warn">{n}</p>)}
              {l.similar.length > 0 && <p className="text-[0.82rem] text-muted">Did you mean: <Hits hits={l.similar} />? Correct the heat number above if so.</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-[0.82rem] text-muted">
        {m.lines.filter((l) => l.verdict === "ok" || l.verdict === "several" || l.verdict === "recorded").length} of {m.lines.length} lines match plates we hold{m.lines.some((l) => l.verdict === "recorded") ? `, ${m.lines.filter((l) => l.verdict === "recorded").length} already with their sale in the stock book` : ""}. By the plates&apos; own weights the challan comes to about {kg(m.est_kg)}
        {m.written_kg != null ? `; ${kg(m.written_kg)} is written${diff != null ? ` (${diff > 0 ? "+" : ""}${diff.toFixed(1)}%)` : ""}` : ""}. Nothing is deducted from stock yet.
      </p>
    </div>
  );
}

/** A vendor invoice, a mill certificate or a delivery challan next to what we already hold. Read-only: it suggests, a person decides. */
export function FamilyMatchPanel({ m }: { m: InvoiceMatch | MtcMatch | ChallanMatch }) {
  if (m.family === "challan") return <ChallanPanel m={m} />;
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
