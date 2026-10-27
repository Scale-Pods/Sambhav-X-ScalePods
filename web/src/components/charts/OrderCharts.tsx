"use client";

import { Th } from "@/components/ui";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, LegendKey } from "./ChartCard";
import { useChartTheme } from "./theme";

const th = "px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted";
const td = "px-4 py-2 text-[0.88rem]";
const f0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const monthLabel = (k: string) => new Date(k + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full">
      <thead className="border-b border-line bg-surface/60"><tr>{head.map((h, i) => <Th key={h} right={i > 0}>{h}</Th>)}</tr></thead>
      <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={td + (j > 0 ? " num text-right" : "")}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

type TipEntry = { dataKey?: unknown; value?: unknown; name?: unknown; color?: unknown };
function Tip({ active, payload, label, suffix }: { active?: boolean; payload?: ReadonlyArray<TipEntry>; label?: unknown; suffix: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2 text-[0.8rem] shadow-lg">
      <p className="mb-1 font-medium text-muted">{String(label)}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-[2px] w-3 rounded-full" style={{ background: String(p.color) }} />
          <span className="num font-semibold text-ink">{suffix === "t" ? f1.format(Number(p.value)) : f0.format(Number(p.value))} {suffix}</span>
          <span className="text-muted">{String(p.name)}</span>
        </p>
      ))}
    </div>
  );
}

/** Orders received per month, SPF and Sai side by side. */
export function OrdersByMonthChart({ points }: { points: { k: string; spf: number; sai: number }[] }) {
  const t = useChartTheme();
  const data = points.map((p) => ({ label: monthLabel(p.k), spf: p.spf, sai: p.sai }));
  return (
    <ChartCard
      title="Orders received"
      subtitle="Per month, by order date"
      legend={<span className="hidden gap-3 sm:flex"><LegendKey color={t.in} label="SPF" /><LegendKey color={t.out} label="Sai" /></span>}
      table={<SimpleTable head={["Month", "SPF", "Sai"]} rows={data.map((d) => [d.label, String(d.spf), String(d.sai)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} width={36} allowDecimals={false} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} suffix="orders" />} />
            <Bar dataKey="spf" name="SPF" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="sai" name="Sai" fill={t.out} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Horizontal bars of counts or tonnes. */
export function CountHBar({ title, subtitle, rows, tone, head, unit }: { title: string; subtitle: string; rows: { label: string; value: number; extra?: string }[]; tone: "in" | "out"; head: string; unit: string }) {
  const t = useChartTheme();
  const color = tone === "in" ? t.in : t.out;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const fmt = (v: number) => (unit === "t" ? f1.format(v) : f0.format(v));
  return (
    <ChartCard title={title} subtitle={subtitle} table={<SimpleTable head={[head, unit === "t" ? "Tonnes" : "Count", ""]} rows={rows.map((r) => [r.label, fmt(r.value), r.extra ?? ""])} />}>
      {rows.length === 0 ? <p className="px-4 py-10 text-center text-[0.9rem] text-muted">Nothing to show.</p> : (
        <ul className="space-y-2.5 px-2 pb-1">
          {rows.map((r) => (
            <li key={r.label} className="group grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3" title={`${r.label}: ${fmt(r.value)} ${unit}${r.extra ? ` · ${r.extra}` : ""}`}>
              <span className="truncate text-[0.85rem] text-ink">{r.label}</span>
              <span className="relative h-[14px]"><span className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} /></span>
              <span className="num w-20 text-right text-[0.85rem] font-semibold text-ink">{fmt(r.value)}<span className="ml-1 font-normal text-muted">{unit}</span></span>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Tonnes sent out per month, by yard. */
export function TonnesByMonthChart({ points }: { points: { k: string; p753: number; d15: number }[] }) {
  const t = useChartTheme();
  const data = points.map((p) => ({ label: monthLabel(p.k), p753: p.p753 / 1000, d15: p.d15 / 1000 }));
  return (
    <ChartCard
      title="Material sent out"
      subtitle="Tonnes per month, by yard (from the vehicle register)"
      legend={<span className="hidden gap-3 sm:flex"><LegendKey color={t.in} label="Plot D-15" /><LegendKey color={t.out} label="Plot 753" /></span>}
      table={<SimpleTable head={["Month", "Plot D-15 (t)", "Plot 753 (t)"]} rows={data.map((d) => [d.label, f1.format(d.d15), f1.format(d.p753)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} width={40} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} suffix="t" />} />
            <Bar dataKey="d15" name="Plot D-15" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="p753" name="Plot 753" fill={t.out} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** One count per month: enquiries, quotations. */
export function MonthlyCountChart({ title, subtitle, points, name, tone = "in" }: { title: string; subtitle: string; points: { k: string; v: number }[]; name: string; tone?: "in" | "out" }) {
  const t = useChartTheme();
  const data = points.map((p) => ({ label: monthLabel(p.k), v: p.v }));
  return (
    <ChartCard title={title} subtitle={subtitle} table={<SimpleTable head={["Month", name]} rows={data.map((d) => [d.label, f0.format(d.v)])} />}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="22%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} width={40} allowDecimals={false} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} suffix={name.toLowerCase()} />} />
            <Bar dataKey="v" name={name} fill={tone === "in" ? t.in : t.out} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
