import Link from "next/link";
import { Suspense } from "react";
import { Clock, FileSpreadsheet, Layers, Lock } from "lucide-react";
import { canExport, currentStaff } from "@/lib/auth";
import { sheetSources } from "@/lib/sheets";
import { stockBookTabs } from "@/lib/stockSheet";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "-";

export default function SheetsPage() {
  return (
    <>
      <PageHeader
        title="Sheet view"
        hint="Your sheets, tab by tab, the way you know them. Both views are read-only: the stock books laid out from the checked ledger, and exact copies of the Google Sheets."
      />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const [me, sources, wb1, wb2] = await Promise.all([currentStaff(), sheetSources(), stockBookTabs("WB1"), stockBookTabs("WB2")]);
  const admin = canExport(me?.role);
  const books = [
    { code: "WB1", name: "WB1 · SPF alloy plates", tabs: wb1 },
    { code: "WB2", name: "WB2 · SPF and Ridhi Siddhi", tabs: wb2 },
  ].filter((b) => b.tabs.length > 0);
  return (
    <div className="space-y-8">
      {books.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-bold">Stock books, laid out like your sheets</h2>
          <p className="mt-1 max-w-3xl text-[0.9rem] text-muted">Purchase, sales and balance side by side, by thickness, tab by tab. Built from the checked stock ledger, so the balance is calculated from the rows.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {books.map((b) => (
              <Link key={b.code} href={`/sheets/stock/${b.code}`} className="block rounded-lg border border-line bg-card p-5 shadow-[0_1px_2px_rgba(24,34,45,0.04)] transition-colors hover:border-accent/50">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-soft text-brand"><Layers className="h-5 w-5" /></span>
                  <Badge tone="ok">Checked ledger</Badge>
                </div>
                <p className="mt-3 font-display text-[1.05rem] font-bold leading-snug">{b.name}</p>
                <p className="mt-1 text-[0.88rem] text-muted">{b.tabs.length} tabs · {new Intl.NumberFormat("en-IN").format(b.tabs.reduce((a, t) => a + t.lots, 0))} plates · {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(b.tabs.reduce((a, t) => a + t.balance_kg, 0) / 1000)} t in stock</p>
                <p className="mt-3 text-[0.8rem] text-muted">{b.tabs.slice(0, 6).map((t) => t.tab).join(" · ")}{b.tabs.length > 6 ? " …" : ""}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display text-lg font-bold">Your Google Sheets, as copied</h2>
        <p className="mt-1 max-w-3xl text-[0.9rem] text-muted">Exact copies of the sheets, refreshed once a day (and whenever we ask for a fresh copy). Keep editing in Google Sheets until each part moves into the app.</p>
        {!admin || sources.length === 0 ? (
          <Card className="mt-4">
            <p className="flex items-center gap-2 px-5 py-8 text-[0.92rem] text-muted"><Lock className="h-4 w-4" /> The copies of the sheets are open to the owner and administrators for now, because they hold payments and expenses.</p>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        )}
      </section>
    </div>
  );
}
