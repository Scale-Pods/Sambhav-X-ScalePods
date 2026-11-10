"use client";

import { Th } from "@/components/ui";

import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, LegendKey } from "./ChartCard";
import { compact, full, useChartTheme } from "./theme";

type Unit = "t" | "kg";
const scale = (kg: number, u: Unit) => (u === "t" ? kg / 1000 : kg);
const uname = (u: Unit) => (u === "t" ? "t" : "kg");
const th = "px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted";
const td = "px-4 py-2 text-[0.88rem]";

/** Shared tooltip: values lead, names follow; rows keyed with a short stroke. */
type TipEntry = { dataKey?: unknown; value?: unknown; name?: unknown; color?: unknown };
function Tip({ active, payload, label, unit, labelFmt }: { active?: boolean; payload?: ReadonlyArray<TipEntry>; label?: unknown; unit: Unit; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2 text-[0.8rem] shadow-lg">
      <p className="mb-1 font-medium text-muted">{labelFmt ? labelFmt(String(label)) : String(label)}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-[2px] w-3 rounded-full" style={{ background: String(p.color) }} />
          <span className="num font-semibold text-ink">{full(Number(p.value), unit === "t" ? 1 : 0)} {uname(unit)}</span>
          <span className="text-muted">{String(p.name)}</span>
        </p>
      ))}
    </div>
  );
}

const fmtBucket = (k: string, bucket: string) => {
  const d = new Date(k + "T00:00:00Z");
  if (bucket === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  if (bucket === "week") return "w/c " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

type Point = { k: string; received: number; sold: number; closing: number };

/** Received vs sold per period: grouped columns, one axis. */
export function InOutChart({ points, bucket, unit, note }: { points: Point[]; bucket: string; unit: Unit; note?: string }) {
  const t = useChartTheme();
  const data = points.map((p) => ({ ...p, label: fmtBucket(p.k, bucket), received: scale(p.received, unit), sold: scale(p.sold, unit) }));
  return (
    <ChartCard
      title="Received vs sold"
      subtitle={`Per ${bucket}, in ${uname(unit) === "t" ? "tonnes" : "kg"}${note ? ` · ${note}` : ""}`}
      legend={<span className="hidden gap-3 sm:flex"><LegendKey color={t.in} label="Received" /><LegendKey color={t.out} label="Sold" /></span>}
      table={<SimpleTable head={["Period", `Received (${uname(unit)})`, `Sold (${uname(unit)})`]} rows={data.map((d) => [d.label, full(d.received, unit === "t" ? 1 : 0), full(d.sold, unit === "t" ? 1 : 0)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={compact} width={44} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} unit={unit} />} />
            <Bar dataKey="received" name="Received" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="sold" name="Sold" fill={t.out} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Stock level at the end of each period: a single line with a light wash. */
export function StockLevelChart({ points, bucket, unit }: { points: Point[]; bucket: string; unit: Unit }) {
  const t = useChartTheme();
  const data = points.map((p) => ({ label: fmtBucket(p.k, bucket), closing: scale(p.closing, unit) }));
  const last = data.at(-1);
  return (
    <ChartCard
      title="Stock level"
      subtitle={`At the end of each ${bucket}${last ? ` · now ${full(last.closing, unit === "t" ? 1 : 0)} ${uname(unit)}` : ""}`}
      table={<SimpleTable head={["Period", `Stock (${uname(unit)})`]} rows={data.map((d) => [d.label, full(d.closing, unit === "t" ? 1 : 0)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={compact} width={44} domain={["auto", "auto"]} />
            <Tooltip cursor={{ stroke: t.axis, strokeWidth: 1 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} unit={unit} />} />
            <Area type="monotone" dataKey="closing" name="Stock" stroke={t.in} strokeWidth={2} fill={t.in} fillOpacity={0.1}
              dot={false} activeDot={{ r: 4, stroke: t.card, strokeWidth: 2, fill: t.in }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** One series of horizontal bars (long grade names stay readable). Clicking a bar can open the matching plates. */
export function HBarChart({ title, subtitle, rows, unit, tone, valueLabel }: {
  title: string; subtitle: string; rows: { label: string; kg: number; extra?: string; href?: string | null }[]; unit: Unit; tone: "in" | "out";
  valueLabel: string;
}) {
  const t = useChartTheme();
  const color = tone === "in" ? t.in : t.out;
  const max = Math.max(...rows.map((r) => r.kg), 1);
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={<SimpleTable head={["Grade", `${valueLabel} (${uname(unit)})`, ""]} rows={rows.map((r) => [r.label, full(scale(r.kg, unit), unit === "t" ? 1 : 0), r.extra ?? ""])} />}
    >
      {rows.length === 0 ? <Empty /> : (
        <ul className="space-y-2.5 px-2 pb-1">
          {rows.map((r) => {
            const href = r.href ?? null;
            const body = (
              <div className="group grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-3" title={`${r.label}: ${full(scale(r.kg, unit), unit === "t" ? 1 : 0)} ${uname(unit)}`}>
                <span className="truncate text-[0.85rem] text-ink">{r.label}</span>
                <span className="relative h-[14px]">
                  <span className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(1.5, (r.kg / max) * 100)}%`, background: color }} />
                </span>
                <span className="num w-20 text-right text-[0.85rem] font-semibold text-ink">{full(scale(r.kg, unit), unit === "t" ? 1 : 0)}<span className="ml-1 font-normal text-muted">{uname(unit)}</span></span>
              </div>
            );
            return <li key={r.label}>{href ? <Link href={href} className="block rounded-md focus-visible:outline-2">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </ChartCard>
  );
}

/** Stock held by age band: ordered columns, one series. */
export function AgeChart({ rows, unit }: { rows: { band: string; kg: number; plates: number }[]; unit: Unit }) {
  const t = useChartTheme();
  const data = rows.map((r) => ({ ...r, v: scale(r.kg, unit) }));
  const old = rows.slice(3).reduce((a, r) => a + r.kg, 0), all = rows.reduce((a, r) => a + r.kg, 0);
  return (
    <ChartCard
      title="How long stock has been held"
      subtitle={all ? `${Math.round((old / all) * 100)}% of stock is more than 6 months old` : "Days since each plate was received"}
      table={<SimpleTable head={["Age", `Stock (${uname(unit)})`, "Plates"]} rows={data.map((d) => [d.band, full(d.v, unit === "t" ? 1 : 0), String(d.plates)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="28%" margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="band" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={compact} width={44} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} unit={unit} />} />
            <Bar dataKey="v" name="Stock" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}
              label={{ position: "top", fill: t.muted, fontSize: 11, formatter: (v: unknown) => compact(Number(v)) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Where the stock sits: grade × thickness, one hue from light (little) to dark (a lot). */
export function Heatmap({ grades, thicknesses, cells, unit, hrefs }: {
  grades: string[]; thicknesses: number[]; cells: Record<string, number>; unit: Unit; hrefs: Record<string, string>;
}) {
  const t = useChartTheme();
  const values = Object.values(cells);
  const max = Math.max(...values, 1);
  const step = (v: number) => t.seq[Math.min(4, Math.floor((v / max) * 5))];
  const ink = (i: number) => (i >= 3 ? "#ffffff" : t.ink);
  return (
    <ChartCard
      title="Where the stock sits"
      subtitle={`Stock left by grade and thickness (mm), eight biggest grades, ${uname(unit) === "t" ? "tonnes" : "kg"}`}
      legend={<span className="hidden items-center gap-1 text-[0.72rem] text-muted sm:flex">less {t.seq.map((c) => <span key={c} className="h-2.5 w-4 rounded-[2px]" style={{ background: c }} />)} more</span>}
      table={<SimpleTable head={["Grade", "Thickness (mm)", `Stock (${uname(unit)})`]} rows={Object.entries(cells).map(([k, v]) => { const [g, th] = k.split("|"); return [g, th, full(scale(v, unit), unit === "t" ? 1 : 0)]; })} />}
    >
      {grades.length === 0 ? <Empty /> : (
        <div className="overflow-x-auto px-2 pb-1">
          <table className="no-grid border-separate" style={{ borderSpacing: 2 }}>
            <thead>
              <tr><th className="sticky left-0 z-10 bg-card" />{thicknesses.map((x) => <th key={x} className="num px-1 pb-1 text-center text-[0.7rem] font-medium text-muted">{x}</th>)}</tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g}>
                  <th className="sticky left-0 z-10 bg-card pr-3 text-left text-[0.8rem] font-medium text-ink"><Link href={hrefs[g] ?? "/plates"} className="hover:text-brand hover:underline">{g}</Link></th>
                  {thicknesses.map((x) => {
                    const v = cells[`${g}|${x}`];
                    if (!v) return <td key={x} className="h-8 min-w-[2.4rem] rounded-[3px] bg-surface" />;
                    const i = Math.min(4, Math.floor((v / max) * 5));
                    return (
                      <td key={x} tabIndex={0} title={`${g}, ${x} mm: ${full(scale(v, unit), unit === "t" ? 1 : 0)} ${uname(unit)}`}
                        className="num h-8 min-w-[2.4rem] rounded-[3px] px-1 text-center text-[0.7rem] font-semibold outline-offset-1 hover:outline hover:outline-2 hover:outline-brand focus-visible:outline-2"
                        style={{ background: step(v), color: ink(i) }}>
                        {compact(scale(v, unit))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

function Empty() {
  return <p className="px-4 py-12 text-center text-[0.9rem] text-muted">Nothing in this period with these filters.</p>;
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full">
      <thead className="sticky top-0 border-b border-line bg-card"><tr>{head.map((h, i) => <Th key={i} right={i > 0}>{h}</Th>)}</tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={td + (j > 0 ? " num text-right" : "")}>{c}</td>)}</tr>)}
      </tbody>
    </table>
  );
}
