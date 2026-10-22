import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, Skeleton, td, th } from "@/components/ui";
import { canUploadDocs, currentStaff } from "@/lib/auth";
import { SHOWS, documentsList, type DocRow, type Show } from "@/lib/documents";
import { KIND } from "@/lib/docreader/labels";
import { UploadBox } from "./UploadBox";

type SP = Promise<Record<string, string | undefined>>;

const TABS: Record<Show, string> = { review: "To review", done: "Reviewed", failed: "Could not be read", all: "All" };

export default function DocumentsPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Documents"
        hint="Upload a purchase order, handwritten note or WhatsApp screenshot. The system reads it, checks the numbers, and waits for a person to confirm. Nothing is saved to orders from here yet."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));

function status(d: DocRow) {
  if (d.duplicate_of) return <Badge>Copy</Badge>;
  if (d.review_status === "confirmed") return <Badge tone="ok">Confirmed</Badge>;
  if (d.review_status === "rejected") return <Badge tone="error">Rejected</Badge>;
  if (d.extraction_status === "failed") return <Badge tone="error">Not read</Badge>;
  if (d.extraction_status === "pending") return <Badge tone="info">Reading…</Badge>;
  return <Badge tone="warning">To review</Badge>;
}

async function Body({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const show = (SHOWS as readonly string[]).includes(sp.show ?? "") ? (sp.show as Show) : "review";
  const me = await currentStaff();
  const rows = await documentsList(show);
  return (
    <div className="space-y-6">
      {me && canUploadDocs(me.role) ? <UploadBox /> : <p className="text-muted">Your role can look at documents but not upload them.</p>}
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
                <th className={th}>File</th><th className={th}>Kind</th><th className={th}>From</th><th className={th}>Ref</th><th className={th}>Date</th>
                <th className={th + " text-right"}>Lines</th><th className={th + " text-right"}>Checks</th><th className={th}>Status</th><th className={th}>Uploaded</th>
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
