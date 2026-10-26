import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { documentDetail, expireStuckDocuments } from "@/lib/documents";
import { draftOfDocument } from "@/lib/drafts";
import { matchRead } from "@/lib/docmatch";
import { matchInvoice, matchMtc } from "@/lib/docmatch_family";
import { isFamilyRead } from "@/lib/docreader/families";
import { inputsFromRead, stockFit } from "@/lib/stockfit";
import { StockFitView } from "@/components/StockFitView";
import { supabaseServer } from "@/lib/supabase";
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
  const me = await currentStaff();
  const supabase = await supabaseServer();
  const signed = await supabase.storage.from("documents").createSignedUrl(d.doc.storage_path, 900);
  const url = signed.data?.signedUrl;
  const canEdit = Boolean(me && canUploadDocs(me.role)) && d.doc.review_status === "pending";
  // a vendor invoice or a mill certificate has its own form and its own matches; everything else is an order or enquiry
  const family = d.read && isFamilyRead(d.read) ? d.read : null;
  const order = d.read && !isFamilyRead(d.read) ? d.read : null;
  const matches = order ? await matchRead(order) : null;
  const familyMatch = family ? (family.family === "invoice" ? await matchInvoice(family, d.doc.id) : await matchMtc(family, d.doc.id)) : null;
  const draft = await draftOfDocument(d.doc.id);
  // an order or enquiry from a customer: do we have the plates? (read-only; it reserves nothing)
  const wanted = order && order.direction === "customer_orders_from_us" ? inputsFromRead(order) : [];
  const fits = await Promise.all(wanted.map(async (w) => ({ line: w.line, fit: await stockFit(w.input) })));
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
        {fits.length > 0 && (
          <div className="mb-5 space-y-2 rounded-lg border border-line bg-card p-4 text-[0.9rem]">
            <h3 className="font-display text-[0.95rem] font-bold">Do we have it in stock?</h3>
            {fits.map((f) => <StockFitView key={f.line} fit={f.fit} title={`Line ${f.line + 1}:`} />)}
            <p className="text-[0.78rem] text-muted">Plates of the same grade and thickness (within 0.05 mm) that are big enough, either way round. Nothing is reserved.</p>
          </div>
        )}
        {family ? (
          <FamilyReviewForm key={d.doc.id + d.runs.length} id={d.doc.id} original={family} firstChecks={d.checks} canEdit={canEdit} />
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
