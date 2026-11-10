import Link from "next/link";
import { ageing, heatmap, recentSales, stockByGrade, timeline, topSold } from "@/lib/analytics";
import { gated, loadControl, loadMail, loadOrders, loadPay, loadStock, loadTallyGap, loadTallyStatus, loadVehicles, tallyEntityOf } from "@/lib/business";
import { periodLabel, rangeLabel, todayIST, unitLabel, weight, type Filter } from "@/lib/filters";
import { date, num } from "@/lib/format";
import { rupeesShort } from "@/lib/money";
import { Badge, Card, Stat, td, Th, type Delta } from "@/components/ui";
import { AgeChart, HBarChart, Heatmap, InOutChart, StockLevelChart } from "@/components/charts/Charts";
import { AgeingChart, MoneyHBar, SalesPurchaseChart } from "@/components/charts/MoneyCharts";
import { CountHBar, MonthlyCountChart, OrdersByMonthChart, TonnesByMonthChart } from "@/components/charts/OrderCharts";
import { day } from "@/components/PayList";
import { carry, f0, safe, Section, TileLink, type OverviewProps } from "./shared";
import { tallyState } from "./Top";

function change(now: number, before: number | null, goodWhenUp: boolean | null, f: Filter): Delta | undefined {
  if (before == null) return undefined;
  if (before === 0) return { text: now ? "nothing in the previous period" : "no movement either period", tone: "neutral", up: null };
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  const tone = goodWhenUp === null || pct === 0 ? "neutral" : up === goodWhenUp ? "good" : "bad";
  return { text: `${Math.abs(pct)}% vs previous ${f.preset === "fy" || f.preset === "lastfy" ? "period" : "same length"}`, tone, up: pct === 0 ? null : up };
}

const who = (e: string | null) => (e ? ` · ${e === "SAI" ? "Sai" : "SPF"} only` : " · SPF and Sai together");

// ---------------------------------------------------------------- stock (the page this one replaced, unchanged)
export async function StockSection({ f }: OverviewProps) {
  return safe("Stock", async () => {
    const [k, tl, byGrade, ages, sold, heat, recent] = await Promise.all([loadStock(f), gated(() => timeline(f)), gated(() => stockByGrade(f)), gated(() => ageing(f)), gated(() => topSold(f)), gated(() => heatmap(f)), gated(() => recentSales(f))]);
    const u = f.unit;
    const asOf = f.to ?? todayIST();
    const keep = (extra: Record<string, string>) => {
      const p = new URLSearchParams(extra);
      if (f.book) p.set("book", f.book);
      if (u === "kg") p.set("u", "kg");
      return `/plates?${p}`;
    };
    return (
      <Section id="stock" title="Stock" hint={`What came in, what went out and what is left, worked out from every purchase and sale. Showing ${periodLabel(f)} (${rangeLabel(f)}); stock figures are as of ${date(asOf)}.`} href="/summary" linkLabel="Open the Summary">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label={`Stock on ${date(asOf)}`} value={weight(k.stock, u)} unit={unitLabel(u)} sub={`${weight(k.stock, "kg")} kg`} />
          <Stat label="Received in period" value={weight(k.received, u)} unit={unitLabel(u)} delta={change(k.received, k.prevReceived, null, f)} />
          <Stat label="Sold in period" value={weight(k.sold, u)} unit={unitLabel(u)} delta={change(k.sold, k.prevSold, true, f)} />
          <Stat label="Plates in stock" value={f0.format(k.plates)} sub="each traceable to its heat / plate no." />
          <TileLink href="/review"><Stat label="Needs a decision" value={f0.format(k.review)} tone="accent" sub="review items waiting →" /></TileLink>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3"><InOutChart points={tl.points} bucket={tl.bucket} unit={u} note={tl.clipped ? "last 24 months shown" : undefined} /></div>
          <div className="xl:col-span-2"><StockLevelChart points={tl.points} bucket={tl.bucket} unit={u} /></div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <HBarChart
              title="Stock by grade"
              subtitle={`What is left on ${date(asOf)}; click a grade to see its plates`}
              rows={byGrade.map((r) => ({ label: r.grade, kg: r.kg, extra: `${r.plates} plates`, href: r.grade.startsWith("Other grades") ? null : keep({ g: r.grade }) }))}
              unit={u} tone="in" valueLabel="Stock"
            />
          </div>
          <div className="xl:col-span-2"><AgeChart rows={ages} unit={u} /></div>
        </div>

        <div className="mt-6">
          <Heatmap grades={heat.grades} thicknesses={heat.thicknesses} cells={heat.cells} unit={u} hrefs={Object.fromEntries(heat.grades.map((g) => [g, keep({ g })]))} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <HBarChart title="Fastest-moving grades" subtitle={`Sold in ${rangeLabel(f)}`} rows={sold.map((r) => ({ label: r.grade, kg: r.kg, href: keep({ g: r.grade }) }))} unit={u} tone="out" valueLabel="Sold" />
          </div>
          <Card title="Latest sales" className="xl:col-span-3">
            {recent.length === 0 ? <p className="px-5 py-12 text-center text-[0.9rem] text-muted">No sales in this period with these filters.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line">
                    <tr><Th>Date</Th><Th>Grade</Th><Th>Plate / heat</Th><Th right>Weight</Th><Th>Book</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {recent.map((r, i) => (
                      <tr key={i} className="hover:bg-surface/60">
                        <td className={td + " num whitespace-nowrap"}>{date(r.movement_date)}</td>
                        <td className={td}>{r.grade}</td>
                        <td className={td}><Link href={`/plates/${r.lot_no}`} className="font-medium text-brand hover:underline">{r.ident}</Link></td>
                        <td className={td + " num whitespace-nowrap text-right font-medium"}>{weight(-num(r.weight_kg), u)} {unitLabel(u)}</td>
                        <td className={td}><Badge>{r.book}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </Section>
    );
  });
}

// ---------------------------------------------------------------- money
export async function MoneySection({ pay, sp }: OverviewProps) {
  return safe("Money", async () => {
    const o = await loadPay(pay);
    const diff = o.typed.debtors && !pay.entity ? o.rec.total - o.typed.debtors : null;
    return (
      <Section id="money" title="Money" hint={`Invoices and expenses for ${periodLabel(pay.f)}${who(pay.entity)}. Debtors and creditors are today's position, whatever the period. Read from your payment sheets.`} href={carry(sp, "/payments")} linkLabel="Open Invoices and payments">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TileLink href={carry(sp, "/payments/sales")}><Stat label="Sales invoiced" value={rupeesShort(o.sales.s)} sub={`${f0.format(o.sales.n)} invoices`} /></TileLink>
          <TileLink href={carry(sp, "/payments/purchases")}><Stat label="Purchases invoiced" value={rupeesShort(o.purchases.s)} sub={`${f0.format(o.purchases.n)} invoices`} /></TileLink>
          <TileLink href={carry(sp, "/payments/expenses")}><Stat label="Expenses" value={rupeesShort(o.expenses.s)} sub={`${f0.format(o.expenses.n)} bills`} /></TileLink>
          <Stat label="Blocked debtors" value={rupeesShort(o.rec.blocked)} sub="marked Blocked in the sheet" />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3"><SalesPurchaseChart points={o.monthly} /></div>
          <div className="xl:col-span-2"><AgeingChart rows={o.ageing} /></div>
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <MoneyHBar title="Who owes us the most" subtitle="Open invoices, today" rows={o.topDebtors} tone="in" head="Customer" />
          <MoneyHBar title="Who we owe the most" subtitle="Open supplier invoices, today" rows={o.topCreditors} tone="out" head="Supplier" />
          <MoneyHBar title="Owed, by salesperson" subtitle="Open invoices, today" rows={o.byPerson} tone="in" head="Salesperson" />
          <MoneyHBar title="Expenses by type" subtitle={`${periodLabel(pay.f)}, top 8`} rows={o.expByCat} tone="out" head="Type" />
        </div>
        {diff != null && (
          <p className="mt-4 text-[0.88rem] text-muted">Checked against your sheet: customers owe <span className="font-semibold text-ink">{rupeesShort(o.rec.total)}</span> from every open invoice; the sheet&apos;s own typed total is <span className="font-semibold text-ink">{rupeesShort(o.typed.debtors)}</span>{Math.abs(diff) < 1000 ? ", so they agree." : `, a difference of ${rupeesShort(Math.abs(diff))}.`}</p>
        )}
      </Section>
    );
  });
}

// ---------------------------------------------------------------- orders and dispatch
export async function OrdersSection({ ord, sp }: OverviewProps) {
  return safe("Orders and dispatch", async () => {
    const [o, v] = await Promise.all([loadOrders(ord), loadVehicles(ord)]);
    return (
      <Section id="orders" title="Orders and dispatch" hint={`Orders received in ${periodLabel(ord.f)}${who(ord.company)}. Open orders are today's position, whatever the period.`} href={carry(sp, "/orders")} linkLabel="Open Orders and dispatch">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TileLink href={carry(sp, "/orders/list", { show: "open" })}><Stat label="Open orders" value={f0.format(o.open.n)} sub={`${f0.format(o.open.lines)} lines still to send`} tone="accent" /></TileLink>
          <TileLink href={carry(sp, "/orders/list", { show: "late" })}><Stat label="Past the delivery date" value={f0.format(o.open.late)} sub="open, and the promised date has gone" /></TileLink>
          <TileLink href={carry(sp, "/orders/list")}><Stat label="Orders received" value={f0.format(o.period.n)} sub={`${f0.format(o.period.lines)} lines · ${f0.format(o.period.done)} completed`} /></TileLink>
          <TileLink href={carry(sp, "/orders/vehicles")}><Stat label="Sent from the yards" value={weight(v.kg, "t")} unit="t" sub={`${f0.format(v.trips)} trips in ${periodLabel(ord.f)}`} /></TileLink>
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <OrdersByMonthChart points={o.monthly} />
          <TonnesByMonthChart points={v.monthly} />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3"><CountHBar title="Who orders the most" subtitle={periodLabel(ord.f) + ", top 10 customers"} rows={o.topClients} tone="in" head="Customer" unit="orders" /></div>
          <Card title="Open orders, oldest delivery date first" className="xl:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-surface/60"><tr><Th>Order</Th><Th>Customer</Th><Th>Due</Th><Th right>Lines</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {o.openOldest.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">No open orders.</td></tr>}
                  {o.openOldest.slice(0, 6).map((r) => (
                    <tr key={r.order_no} className="hover:bg-surface/60">
                      <td className={td}><Link href={`/orders/${r.order_no}`} className="font-semibold text-brand hover:underline">{r.order_no}</Link></td>
                      <td className={td + " max-w-[10rem] truncate"} title={r.client ?? ""}>{r.client}</td>
                      <td className={td + " whitespace-nowrap"}>{day(r.etd)}</td>
                      <td className={td + " num text-right"}>{r.done_lines}/{r.lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Section>
    );
  });
}

// ---------------------------------------------------------------- mail, leads, quotations
export async function MailSection({ f, sp }: OverviewProps) {
  return safe("Mail and leads", async () => {
    const o = await loadMail(f);
    return (
      <Section id="mail" title="Mail and leads" hint={`Quotations and leads for ${periodLabel(f)}. The inbox is today's position, whatever the period. Read from your Email Tracker and IndiaMART sheets.`} href="/mail" linkLabel="Open Mail and leads">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TileLink href="/mail/inbox"><Stat label="Mails waiting for a reply" value={f0.format(o.inbox.pending)} sub={`${f0.format(o.inbox.urgent)} urgent · ${f0.format(o.inbox.follow)} follow-ups · ${f0.format(o.inbox.fresh)} new`} tone="accent" /></TileLink>
          <TileLink href={carry(sp, "/mail/quotations", { show: "followup" }, ["p", "from", "to"])}><Stat label="Quotes with no follow-up" value={f0.format(o.quotes.followup)} sub="quoted three or more days ago" /></TileLink>
          <TileLink href={carry(sp, "/mail/quotations", {}, ["p", "from", "to"])}><Stat label="Quotations sent" value={f0.format(o.quotes.n)} sub={`${f0.format(o.quotes.numbered)} with a quotation number`} /></TileLink>
          <TileLink href={carry(sp, "/mail/leads", {}, ["p", "from", "to"])}><Stat label="IndiaMART leads" value={f0.format(o.leads.n)} sub={`${f0.format(o.leads.buy)} buy leads`} /></TileLink>
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <MonthlyCountChart title="IndiaMART leads" subtitle="Per month" points={o.leadsMonthly} name="Leads" tone="in" />
          <MonthlyCountChart title="Quotations sent" subtitle="Per month, by the date quoted" points={o.quotesMonthly} name="Quotations" tone="out" />
          <CountHBar title="What leads ask for" subtitle="Top 10 products" rows={o.leadProducts} tone="in" head="Product" unit="leads" />
          <CountHBar title="What is being quoted" subtitle="Top 10 materials in the quotation tracker" rows={o.quoteMaterials} tone="out" head="Material" unit="quotes" />
        </div>
      </Section>
    );
  });
}

// ---------------------------------------------------------------- Tally
export async function TallySection({ pay }: OverviewProps) {
  return safe("Tally", async () => {
    const entity = tallyEntityOf(pay.entity);
    const [s, gap] = await Promise.all([loadTallyStatus(entity), loadTallyGap(entity)]);
    const ts = tallyState(s);
    const c = s.counts;
    const none = !c.vouchers && !c.receivable_bills;
    const diffRec = gap.rec.tally_total - gap.rec.sheet_total;
    const diffPay = gap.pay.tally_total - gap.pay.sheet_total;
    return (
      <Section id="tally" title="Tally" hint={`A read-only reflection of your accounts: nothing here is ever written back to Tally. Compared with the ${entity === "SAI" ? "Sai" : "SPF"} payment sheets, which are the other side of the same books.`} href="/tally" linkLabel="Open Tally">
        {ts.tone !== "ok" && (
          <p className="mb-4 rounded-lg border border-line border-l-4 border-l-accent bg-card px-4 py-3 text-[0.9rem] text-muted">
            {ts.tone === "wait" ? "Waiting for the Tally PC. " : "Tally data may be out of date. "}
            {ts.line}. The figures below are what was last received{c.bills_as_of ? ` (bills as of ${c.bills_as_of})` : ""}; they update by themselves after the next sync.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TileLink href="/tally"><Stat label="Connection" value={ts.word} sub={ts.line} /></TileLink>
          <TileLink href="/tally/parties"><Stat label="Customers and vendors" value={f0.format(c.ledgers)} sub={`${f0.format(c.stock_items)} stock items`} /></TileLink>
          <TileLink href="/tally/receivables"><Stat label="Debtors in Tally" value={rupeesShort(gap.rec.tally_total)} sub={none ? "nothing received yet" : `sheets say ${rupeesShort(gap.rec.sheet_total)}`} tone="accent" /></TileLink>
          <TileLink href="/tally/payables"><Stat label="Creditors in Tally" value={rupeesShort(gap.pay.tally_total)} sub={none ? "nothing received yet" : `sheets say ${rupeesShort(gap.pay.sheet_total)}`} /></TileLink>
        </div>
        {!none && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card title="Customers: Tally against the sheets" help="Each customer's balance in Tally is matched to the same customer's open invoices in the payment sheets. Names are matched on their words, so small spelling differences still match.">
              <div className="space-y-1.5 px-5 py-4 text-[0.92rem]">
                <p><span className="font-semibold">{f0.format(gap.rec.same)}</span> agree · <span className="font-semibold">{f0.format(gap.rec.differs)}</span> differ · <span className="font-semibold">{f0.format(gap.rec.only_tally)}</span> only in Tally · <span className="font-semibold">{f0.format(gap.rec.only_sheet)}</span> only in the sheets</p>
                <p className="text-muted">Overall gap: {rupeesShort(Math.abs(diffRec))} {diffRec >= 0 ? "more" : "less"} in Tally than the sheets show.</p>
                <Link href="/tally/receivables" className="inline-block pt-1 text-[0.88rem] font-medium text-brand hover:underline">See the customers that differ →</Link>
              </div>
            </Card>
            <Card title="Suppliers: Tally against the sheets" help="The same match for suppliers: Tally's creditors for goods against the open supplier bills in the payment sheets.">
              <div className="space-y-1.5 px-5 py-4 text-[0.92rem]">
                <p><span className="font-semibold">{f0.format(gap.pay.same)}</span> agree · <span className="font-semibold">{f0.format(gap.pay.differs)}</span> differ · <span className="font-semibold">{f0.format(gap.pay.only_tally)}</span> only in Tally · <span className="font-semibold">{f0.format(gap.pay.only_sheet)}</span> only in the sheets</p>
                <p className="text-muted">Overall gap: {rupeesShort(Math.abs(diffPay))} {diffPay >= 0 ? "more" : "less"} in Tally than the sheets show.</p>
                <Link href="/tally/payables" className="inline-block pt-1 text-[0.88rem] font-medium text-brand hover:underline">See the suppliers that differ →</Link>
              </div>
            </Card>
          </div>
        )}
        <p className="mt-4 text-[0.84rem] text-muted">Turnover by month and the top customers from Tally vouchers will appear here once the Tally PC is syncing sales vouchers.</p>
      </Section>
    );
  });
}

// ---------------------------------------------------------------- count and control
export async function ControlSection() {
  return safe("Count and control", async () => {
    const c = await loadControl();
    const ses = c.session;
    return (
      <Section id="control" title="Count and control" hint="The physical count, what waits for a decision, and the documents and drafts the AI has prepared." href="/review" linkLabel="Open Needs review">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <TileLink href="/review"><Stat label="Needs a decision" value={f0.format(c.decide)} sub={`${f0.format(c.old_notes)} old sheet notes kept apart`} tone="accent" /></TileLink>
          <TileLink href="/documents"><Stat label="Documents to review" value={f0.format(c.docs_review)} sub={c.docs_failed ? `${f0.format(c.docs_failed)} could not be read` : "none failed"} /></TileLink>
          <TileLink href="/drafts"><Stat label="Open drafts" value={f0.format(c.drafts)} sub="orders and enquiries to work from" /></TileLink>
          <TileLink href="/count"><Stat label="Physical count" value={ses ? ses.status[0].toUpperCase() + ses.status.slice(1) : "None started"} sub={ses ? `${ses.name}: ${f0.format(Number(ses.lines))} plates counted` : "no count session yet"} /></TileLink>
          <TileLink href="/mill-orders"><Stat label="Still to arrive from mills" value={weight(c.mill.pending_kg, "t")} unit="t" sub={`${f0.format(c.mill.open_lines)} of ${f0.format(c.mill.lines)} mill order lines open`} /></TileLink>
        </div>
      </Section>
    );
  });
}

// ---------------------------------------------------------------- ask
const QUESTIONS = [
  "How much SA 387 Gr 11 do we have, by thickness?",
  "What do customers owe us, and who is more than 90 days late?",
  "Which open orders are past their delivery date?",
  "Which quotes have had no follow-up?",
  "Do Tally and the payment sheets agree on what customers owe?",
  "Give me a short summary of the whole business today.",
];

export async function AskSection() {
  return (
    <Section id="ask" title="Ask the business" hint="Ask in plain words. The answer comes from the same records as this page, with links to check them. It only reads; it cannot change anything." href="/digital-brain" linkLabel="Open Digital Brain">
      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((q) => (
          <Link key={q} href={`/digital-brain?q=${encodeURIComponent(q)}`} className="rounded-full border border-line bg-field px-3.5 py-1.5 text-left text-[0.88rem] hover:border-brand hover:text-brand">{q}</Link>
        ))}
      </div>
    </Section>
  );
}
