import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, Skeleton, td, Th } from "@/components/ui";
import { canExport, canUploadDocs, currentStaff } from "@/lib/auth";
import { SHOWS, aiSpendToday, documentsList, expireStuckDocuments, type DocRow, type Show } from "@/lib/documents";
import { KIND } from "@/lib/docreader/labels";
import { UploadBox } from "./UploadBox";

type SP = Promise<Record<string, string | undefined>>;

const TABS: Record<Show, string> = { review: "To review", done: "Reviewed", failed: "Could not be read", all: "All" };

export default function DocumentsPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Documents" help="A document goes Reading, then To review, then Confirmed (or Rejected). “Checks” counts the automatic number checks that failed. Confirming a document makes a draft; nothing else changes."
        hint="Upload a purchase order, handwritten note or WhatsApp screenshot. The system reads it, checks the numbers, and waits for a person to confirm. A confirmed customer order or enquiry becomes a draft under Drafts; nothing is posted to orders or the books."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));

function status(d: DocRow) {
  if (d.duplicate_of) return <Badge info="The same file was uploaded before, so this entry is a duplicate. Work from the first one.">Copy</Badge>;
  if (d.review_status === "confirmed") return <Badge tone="ok" info="A person checked what the system read and confirmed it.">Confirmed</Badge>;
  if (d.review_status === "rejected") return <Badge tone="error" info="A person decided this document cannot be used.">Rejected</Badge>;
  if (d.extraction_status === "failed") return <Badge tone="error" info="The system could not read this file (blurred, empty or an unsupported kind). Open it to enter the details by hand or reject it.">Not read</Badge>;
  if (d.extraction_status === "pending") return <Badge tone="info" info="The system is still reading the file. Refresh in a minute.">Reading…</Badge>;
  return <Badge tone="warning" info="The system has read it and checked the numbers. A person now needs to look at the details and confirm.">To review</Badge>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const show = (SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as Show) : "review";
  const me = await currentStaff();
  await expireStuckDocuments();
  const [rows, spend] = await Promise.all([documentsList(show), me && canExport(me.role) ? aiSpendToday() : Promise.resolve(null)]);
  return (
    <div className="space-y-6">
      {me && canUploadDocs(me.role) ? <UploadBox /> : <p className="text-muted">Your role can look at documents but not upload them.</p>}
      {spend && <p className="text-[0.82rem] text-muted">AI reading today: ${spend.spent.toFixed(2)}{spend.cap != null ? ` of the $${spend.cap} daily limit` : ""}. Reading stops for the day at the limit.</p>}
      <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line" aria-label="Documents">
        {SHOWS.map((s) => (
          <Link key={s} href={s === "review" ? "/documents" : `/documents?show=${s}`} aria-current={s === show ? "page" : undefined}
            className={"border-b-2 px-1 pb-3 text-[0.95rem] font-semibold transition-colors " + (s === show ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
            {TABS[s]}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line">
                <Th>File</Th><Th info="What the document was read as: a customer PO, an enquiry, a vendor invoice or a mill certificate.">Kind</Th><Th info="The buyer, vendor or mill named on the document.">From</Th><Th info="The number on the document: PO number, invoice number or certificate number.">Ref</Th><Th>Date</Th>
                <Th right>Lines</Th><Th right>Checks</Th><Th info="Reading: still being read. To review: waiting for a person to check and confirm. Confirmed: approved. Rejected: not usable. Not read: could not be read. Copy: the same file was uploaded before.">Status</Th><Th info="When the file was uploaded.">Uploaded</Th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface/60">
                    <td className={td + " max-w-[16rem]"}><Link href={`/documents/${d.id}`} className="block truncate font-semibold text-brand hover:underline" title={d.original_filename}>{d.original_filename}</Link></td>
                    <td className={td}>{d.kind ? (KIND[d.kind] ?? d.kind) : ""}{d.kind && d.firm === false ? <span className="ml-1 text-muted">(not an order)</span> : null}</td>
                    <td className={td + " max-w-[14rem] truncate"}>{d.buyer}</td>
                    <td className={td}>{d.ref}</td>
                    <td className={td + " whitespace-nowrap"}>{d.doc_date}</td>
                    <td className={td + " text-right"}>{d.lines ?? ""}</td>
                    <td className={td + " text-right"}>{d.amber ? <Badge tone="warning">{d.amber} to check</Badge> : d.kind ? <span className="text-ok">clear</span> : null}{d.second ? <span className="ml-1.5 text-[0.75rem] text-muted" title="Read twice: the stronger model checked it">×2</span> : null}</td>
                    <td className={td}>{status(d)}</td>
                    <td className={td + " whitespace-nowrap text-muted"}>{when(d.created_at)}{d.uploaded_by ? ` · ${d.uploaded_by.split(" ")[0]}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
