import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { canDecide, canUploadDocs, currentStaff } from "@/lib/auth";
import { postedOf } from "@/lib/challanPost";
import { documentDetail, expireStuckDocuments } from "@/lib/documents";
import { draftOfDocument } from "@/lib/drafts";
import { matchRead } from "@/lib/docmatch";
import { matchChallan, matchInvoice, matchMtc, type ChallanHit } from "@/lib/docmatch_family";
import { isFamilyRead, type ChallanRead } from "@/lib/docreader/families";
import { inputsFromRead, stockFit } from "@/lib/stockfit";
import { StockFitView } from "@/components/StockFitView";
import { supabaseServer } from "@/lib/supabase";
import { ChallanPostPanel, UndoPosting, type PostLine } from "../ChallanPost";
import { FamilyMatchPanel } from "../FamilyMatchPanel";
import { FamilyReviewForm } from "../FamilyReviewForm";
import { MatchPanel } from "../MatchPanel";
import { ReadAgain } from "../ReadAgain";
import { ReviewForm } from "../ReviewForm";

type P = Promise<{ id: string }>;

export default function DocumentPage({ params }: { params: P }) {
  return (
    <>
      <Link href="/documents" className="mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-medium text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All documents</Link>
      <Suspense fallback={<Card><Skeleton rows={10} /></Card>}>
        <Body params={params} />
      </Suspense>
    </>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));
const rupees = (n: number) => (n < 0.01 ? "under ₹0.01" : `₹${(n * 88).toFixed(2)}`); // rough: the cost is tracked in dollars

async function Body({ params }: { params: P }) {
  await connection();
  const { id } = await params;
  await expireStuckDocuments();
  const d = await documentDetail(id);
  if (!d) notFound();
  const supabase = await supabaseServer();
  // a vendor invoice or a mill certificate has its own form and its own matches; everything else is an order or enquiry
  const family = d.read && isFamilyRead(d.read) ? d.read : null;
  const order = d.read && !isFamilyRead(d.read) ? d.read : null;
  // a confirmed challan is matched, shown and posted from the reading the person confirmed (with their corrections), not from the AI's first reading
  const finalRead = d.review?.final as { family?: string } | null | undefined;
  const confirmedChallan = family?.family === "challan" && d.doc.review_status === "confirmed" && finalRead?.family === "challan" ? (finalRead as unknown as ChallanRead) : null;
  const shown = confirmedChallan ?? family;
  // an order or enquiry from a customer: do we have the plates? (read-only; it reserves nothing)
  const wanted = order && order.direction === "customer_orders_from_us" ? inputsFromRead(order) : [];
  // everything the page needs is asked at the same time (one after another it was a dozen round trips to the database)
  const [me, signed, matches, familyMatch, draft, fits, posted] = await Promise.all([
    currentStaff(),
    supabase.storage.from("documents").createSignedUrl(d.doc.storage_path, 900),
    order ? matchRead(order) : Promise.resolve(null),
    shown ? (shown.family === "invoice" ? matchInvoice(shown, d.doc.id) : shown.family === "challan" ? matchChallan(shown, d.doc.id) : matchMtc(shown, d.doc.id)) : Promise.resolve(null),
    draftOfDocument(d.doc.id),
    Promise.all(wanted.map(async (w) => ({ line: w.line, fit: await stockFit(w.input) }))),
    confirmedChallan ? postedOf(d.doc.id) : Promise.resolve(null),
  ]);
  const decider = Boolean(me && canDecide(me.role));
  // the lines of the posting form: the plate each line most likely comes out of (the person may change it), and a weight worked out from the plate's own weight
  const hitText = (h: ChallanHit, similar = false) => `${similar ? "Similar: " : ""}Plate ${h.lot_no} · ${h.grade ?? ""} ${h.thickness_mm}×${h.width_mm}×${h.length_mm} · ${h.heat_no ?? h.plate_no ?? ""} · ${h.balance_pieces ?? "?"} pcs / ${Math.round(h.balance_kg ?? 0)} kg left`;
  const postLines: PostLine[] = confirmedChallan && familyMatch?.family === "challan"
    ? familyMatch.lines.map((m, i) => ({
        n: i, label: m.key, pieces: confirmedChallan.lines[i]?.pieces ?? "", balance: confirmedChallan.lines[i]?.balance ?? "", verdict: m.verdict,
        options: [...m.recorded.map((r) => ({ id: `rec:${r.lot_id}`, text: `Already in the stock book · Plate ${r.lot_no} · ${r.pieces} pcs (${r.note.slice(0, 60)}): record only, nothing moves` })), ...m.hits.map((h) => ({ id: h.id, text: hitText(h) })), ...m.similar.filter((s) => !m.hits.some((h) => h.id === s.id)).map((h) => ({ id: h.id, text: hitText(h, true) }))],
        lot: m.verdict === "recorded" && m.recorded[0] ? `rec:${m.recorded[0].lot_id}` : (m.verdict === "ok" || m.verdict === "several" || m.verdict === "short") && m.best ? m.best.id : "", kg: m.est_kg, warn: m.notes,
      }))
    : [];
  const url = signed.data?.signedUrl;
  const canEdit = Boolean(me && canUploadDocs(me.role)) && d.doc.review_status === "pending";
  const usd = d.runs.reduce((a, r) => a + r.usd, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card title={d.doc.original_filename} aside={url ? <a href={url} target="_blank" rel="noreferrer" className="text-[0.85rem] font-medium text-brand hover:underline">Open full size</a> : undefined}>
          <div className="max-h-[78vh] overflow-auto bg-surface p-2">
            {!url ? <p className="p-6 text-center text-muted">The file could not be opened.</p>
              : d.doc.mime_type === "application/pdf" ? <iframe src={url} title="Document" className="h-[74vh] w-full rounded bg-white" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={url} alt="The uploaded document" className="mx-auto h-auto max-w-full rounded bg-white" />}
          </div>
        </Card>
        <p className="mt-2 text-[0.8rem] text-muted">
          Uploaded {when(d.doc.created_at)}{d.doc.uploaded_by ? ` by ${d.doc.uploaded_by}` : ""}.
          {d.runs.length > 0 && <> Read by {d.runs.map((r) => (r.stage === "first" ? "Haiku 5.5" : "Sonnet 5.5")).join(" then ")}, {rupees(usd)}.</>}
        </p>
      </div>

      <div>
        {d.doc.duplicate_of && <div className="mb-4 rounded-lg border border-line bg-card p-4 text-[0.92rem]"><Badge>Copy</Badge> <span className="ml-1">The same file was uploaded before. <Link className="font-medium text-brand hover:underline" href={`/documents/${d.doc.duplicate_of}`}>Open the first copy</Link>.</span></div>}
        {draft && <div className="mb-4 rounded-lg border border-line bg-card p-4 text-[0.92rem]"><Badge tone="ok">Draft made</Badge> <span className="ml-1">This document became a {draft.kind === "order" ? "draft order" : draft.kind === "purchase_invoice" ? "draft purchase invoice" : "draft quotation"}. <Link className="font-medium text-brand hover:underline" href={`/drafts/${draft.id}`}>Open the draft</Link>.</span></div>}
        {d.review && (
          <div className="mb-4 rounded-lg border border-line bg-card p-4 text-[0.92rem]">
            <Badge tone={d.review.decision === "rejected" ? "error" : "ok"}>{d.review.decision === "rejected" ? "Rejected" : d.review.decision === "corrected" ? "Confirmed with corrections" : "Confirmed"}</Badge>
            <span className="ml-2 text-muted">by {d.review.reviewer}, {when(d.review.reviewed_at)}</span>
            {d.review.note && <p className="mt-2">{d.review.note}</p>}
            {d.review.changes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[0.85rem] text-muted">
                {d.review.changes.map((c, i) => <li key={i}><span className="font-mono text-[0.8rem]">{c.field}</span>: {c.from || "empty"} → {c.to || "empty"}</li>)}
              </ul>
            )}
          </div>
        )}
        {order && matches && <MatchPanel read={order} m={matches} />}
        {familyMatch && <FamilyMatchPanel m={familyMatch} />}
        {confirmedChallan && posted && (
          <div className="mb-5 space-y-2 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
            <div><Badge tone="ok">Posted to stock</Badge> <span className="ml-1 text-muted">on {when(posted.posted_at)}, challan dated {posted.dispatched_on ?? "?"}</span></div>
            <ul className="space-y-0.5 text-[0.86rem]">
              {posted.lines.map((l, i) => (
                <li key={i}>{l.lot_no != null ? <Link href={`/plates/${l.lot_no}`} className="font-medium text-brand hover:underline">Plate {l.lot_no}</Link> : <span className="font-medium">Not from our stock</span>}{l.heat_no ? ` · ${l.heat_no}` : ""} · {l.pieces ?? "?"} pcs · {l.weight_kg != null ? `${Math.round(l.weight_kg)} kg` : ""}{l.lot_no == null && l.note ? <span className="text-muted"> ({l.note.replace("Not from our stock: ", "")})</span> : null}</li>
              ))}
            </ul>
            <UndoPosting id={d.doc.id} canDecide={decider} />
          </div>
        )}
        {confirmedChallan && !posted && postLines.length > 0 && <ChallanPostPanel id={d.doc.id} lines={postLines} canDecide={decider} />}
        {fits.length > 0 && (
          <div className="mb-5 space-y-2 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
            <h3 className="font-display text-[0.95rem] font-bold">Do we have it in stock?</h3>
            {fits.map((f) => <StockFitView key={f.line} fit={f.fit} title={`Line ${f.line + 1}:`} />)}
            <p className="text-[0.78rem] text-muted">Plates of the same grade and thickness (within 0.05 mm) that are big enough, either way round. Nothing is reserved.</p>
          </div>
        )}
        {family && shown ? (
          <FamilyReviewForm key={d.doc.id + d.runs.length} id={d.doc.id} original={shown} firstChecks={d.checks} canEdit={canEdit} />
        ) : order ? (
          <ReviewForm key={d.doc.id + d.runs.length} id={d.doc.id} original={order} firstChecks={d.checks} canEdit={canEdit} />
        ) : (
          <Card>
            <div className="space-y-3 px-5 py-8 text-center text-muted">
              <p>{d.doc.extraction_status === "failed" ? "This document could not be read." : d.doc.extraction_status === "pending" ? "Still being read. Refresh in a few seconds." : "Nothing was read."}</p>
              {d.doc.extraction_status === "failed" && d.doc.review_status === "pending" && canEdit && <ReadAgain id={d.doc.id} />}
              {d.doc.extraction_status === "failed" && <p className="text-[0.85rem]">Or reject it from the list if it is not a document that can be read.</p>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
