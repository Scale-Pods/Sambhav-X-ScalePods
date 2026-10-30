import { Suspense } from "react";
import { connection } from "next/server";
import { gradeOptions } from "@/lib/analytics";
import { parseFilter, periodLabel } from "@/lib/filters";
import { readOrderParams } from "@/lib/orders";
import { readPayParams } from "@/lib/payments";
import { Card, PageHeader, Skeleton, StatsSkeleton } from "@/components/ui";
import { FilterShell } from "@/components/FilterBar";
import { PayExtras } from "@/components/PayBar";
import { AttentionList, Headline, SectionNav } from "@/components/overview/Top";
import { AskSection, ControlSection, MailSection, MoneySection, OrdersSection, StockSection, TallySection } from "@/components/overview/Sections";
import type { OverviewProps } from "@/components/overview/shared";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function Overview({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Business overview"
        hint="Stock, money, orders, mail, Tally and the physical count on one page, worked out from your records and never typed by hand."
        help="Each part is a short version of its own page: open the part's link for the full page. The period and the stock book apply to stock, mail and the money and order totals; the Company choice applies to money and orders. Debtors, creditors and open orders are always today's position."
      />
      <Suspense fallback={<><StatsSkeleton /><Card className="mt-6"><Skeleton rows={6} /></Card></>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const part = (rows = 6) => <Card className="mt-12"><Skeleton rows={rows} /></Card>;

async function Body({ searchParams }: { searchParams: SP }) {
  await connection(); // these pages work out today's date: render them at request time, never while the shell is prepared
  const sp = await searchParams;
  const f = parseFilter(sp, "fy");
  const props: OverviewProps = { f, pay: readPayParams(sp), ord: readOrderParams(sp), sp: sp as Record<string, string | undefined> };
  const grades = await gradeOptions().catch(() => [] as string[]); // only the grade picker needs it: the page still shows without
  return (
    <FilterShell grades={grades} extra={<PayExtras entity={props.pay.entity ?? "all"} />}>
      <p className="-mt-3 mb-5 text-[0.88rem] text-muted">
        Showing <span className="font-semibold text-ink">{periodLabel(f)}</span>{props.pay.entity ? ` · ${props.pay.entity === "SAI" ? "Sai" : "SPF"} only for money and orders` : " · SPF and Sai together for money and orders"}.
      </p>

      <Suspense fallback={<StatsSkeleton />}><Headline {...props} /></Suspense>
      <div className="mt-6"><Suspense fallback={<Card><Skeleton rows={4} /></Card>}><AttentionList {...props} /></Suspense></div>
      <SectionNav />

      <Suspense fallback={part(10)}><StockSection {...props} /></Suspense>
      <Suspense fallback={part(8)}><MoneySection {...props} /></Suspense>
      <Suspense fallback={part(8)}><OrdersSection {...props} /></Suspense>
      <Suspense fallback={part(8)}><MailSection {...props} /></Suspense>
      <Suspense fallback={part(5)}><TallySection /></Suspense>
      <Suspense fallback={part(3)}><ControlSection /></Suspense>
      <AskSection />
    </FilterShell>
  );
}
