import { Suspense } from "react";
import { Lock, Radio } from "lucide-react";
import { canCount, canRunCount, currentStaff } from "@/lib/auth";
import { countLines, countSessions } from "@/lib/queries";
import { date, kg } from "@/lib/format";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { CountScreen } from "./CountScreen";
import { StartCount } from "./StartCount";

export default function CountPage() {
  return (
    <>
      <PageHeader title="Physical count" hint="Used in the yard on a phone or tablet. Selling and dispatch carry on while you count; every count is saved with who counted it and when." />
      <Suspense fallback={<Card><Skeleton rows={8} /></Card>}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const [me, sessions] = await Promise.all([currentStaff(), countSessions()]);
  const open = sessions.find((s) => s.status === "counting");
  const review = sessions.filter((s) => s.status === "review");
  const lines = open ? await countLines(open.id) : [];

  return (
    <div className="space-y-6">
      {open ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-brand/20 bg-brand-soft px-5 py-3.5 text-brand-dark">
          <span className="flex items-center gap-2 font-semibold"><Radio className="h-4 w-4" /> Count window open · {open.book}</span>
          <span className="text-[0.92rem]">{open.name}. Opened {date(open.started_at)}.</span>
        </div>
      ) : (
        <Card title="No count is open">
          <div className="space-y-4 p-5">
            <p className="text-[0.95rem] text-muted">When the count window opens, plates are counted here and saved straight away. The owner or an administrator opens it.</p>
            {canRunCount(me?.role) ? <StartCount /> : <p className="text-sm font-medium text-muted">You will be able to enter counts once it is opened.</p>}
          </div>
        </Card>
      )}

      {open && <CountScreen sessionId={open.id} book={open.book} lines={lines} canClose={canRunCount(me?.role)} canCount={canCount(me?.role)} />}

      {review.length > 0 && (
        <Card title="Closed, waiting for review">
          <ul className="divide-y divide-line">
            {review.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-muted" /> {s.name} <span className="text-sm font-normal text-muted">· {s.book}</span></span>
                <span className="num text-sm text-muted">{kg(s.lines)} plates · {kg(s.kg)} kg</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
