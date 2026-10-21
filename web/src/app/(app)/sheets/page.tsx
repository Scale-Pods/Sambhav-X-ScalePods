import Link from "next/link";
import { Suspense } from "react";
import { Clock, FileSpreadsheet, Lock } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { sheetSources } from "@/lib/sheets";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "-";

export default function SheetsPage() {
  return (
    <>
      <PageHeader
        title="Sheet view"
        hint="Your Google Sheets, tab by tab, the way you know them. This is a read-only copy that refreshes every 15 minutes during working hours; keep editing in Google Sheets until each part moves into the app."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const [me, sources] = await Promise.all([currentStaff(), sheetSources()]);
  if (!canExport(me?.role) || sources.length === 0) {
    return (
      <Card>
        <p className="flex items-center gap-2 px-5 py-10 text-[0.95rem] text-muted"><Lock className="h-4 w-4" /> The sheet view is open to the owner and administrators for now, because the sheets hold payments and expenses.</p>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sources.map((s) => {
        const tabs = (s.tabs ?? []).filter((t) => !t.hidden).length;
        const body = (
          <>
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ok-soft text-ok"><FileSpreadsheet className="h-5 w-5" /></span>
              {s.active && s.tabs ? <Badge tone="ok">Live copy</Badge> : <Badge tone="neutral">Waiting for access</Badge>}
            </div>
            <p className="mt-3 font-display text-[1.05rem] font-bold leading-snug">{s.name}</p>
            {s.active && s.tabs ? (
              <>
                <p className="mt-1 text-[0.88rem] text-muted">{tabs} tabs · {new Intl.NumberFormat("en-IN").format(s.rows)} rows</p>
                <p className="mt-3 flex items-center gap-1.5 text-[0.8rem] text-muted"><Clock className="h-3.5 w-3.5" /> Last change in the sheet {when(s.last_modified_at)} · checked {when(s.last_synced_at)}</p>
              </>
            ) : (
              <p className="mt-1 text-[0.88rem] text-muted">Shown here as soon as the sheet is shared with the reader account.</p>
            )}
          </>
        );
        return s.active && s.tabs ? (
          <Link key={s.key} href={`/sheets/${s.key}`} className="block rounded-lg border border-line bg-card p-5 shadow-[0_1px_2px_rgba(24,34,45,0.04)] transition-colors hover:border-accent/50">{body}</Link>
        ) : (
          <div key={s.key} className="rounded-lg border border-dashed border-line bg-card/60 p-5 opacity-75">{body}</div>
        );
      })}
    </div>
  );
}
