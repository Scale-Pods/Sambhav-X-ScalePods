"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, LegendKey } from "./ChartCard";
import { useChartTheme } from "./theme";
import { rupeesShort } from "@/lib/money";

const th = "px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-muted";
const td = "px-4 py-2 text-[0.88rem]";
const axisMoney = (v: number) => (v >= 1e7 ? `${+(v / 1e7).toFixed(1)}cr` : v >= 1e5 ? `${+(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}k` : String(v));

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full">
      <thead className="border-b border-line bg-surface/60"><tr>{head.map((h, i) => <th key={h} className={th + (i > 0 ? " text-right" : "")}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={td + (j > 0 ? " num text-right" : "")}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

type TipEntry = { dataKey?: unknown; value?: unknown; name?: unknown; color?: unknown };
function Tip({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<TipEntry>; label?: unknown }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2 text-[0.8rem] shadow-lg">
      <p className="mb-1 font-medium text-muted">{String(label)}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-[2px] w-3 rounded-full" style={{ background: String(p.color) }} />
          <span className="num font-semibold text-ink">{rupeesShort(Number(p.value))}</span>
          <span className="text-muted">{String(p.name)}</span>
        </p>
      ))}
    </div>
  );
}

const monthLabel = (k: string) => new Date(k + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Sales invoiced vs purchases invoiced, per month. */
export function SalesPurchaseChart({ points }: { points: { k: string; sales: number; purchases: number }[] }) {
  const t = useChartTheme();
  const data = points.map((p) => ({ label: monthLabel(p.k), sales: p.sales, purchases: p.purchases }));
  return (
    <ChartCard
      title="Sales and purchases invoiced"
      subtitle="Per month, by invoice date. Each invoice number counted once"
      legend={<span className="hidden gap-3 sm:flex"><LegendKey color={t.in} label="Sales" /><LegendKey color={t.out} label="Purchases" /></span>}
      table={<SimpleTable head={["Month", "Sales", "Purchases"]} rows={data.map((d) => [d.label, rupeesShort(d.sales), rupeesShort(d.purchases)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={axisMoney} width={48} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} />} />
            <Bar dataKey="sales" name="Sales" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="purchases" name="Purchases" fill={t.out} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Horizontal bars of rupee amounts with a label and a note: top debtors, creditors, expense heads. */
export function MoneyHBar({ title, subtitle, rows, tone, head }: { title: string; subtitle: string; rows: { label: string; value: number; extra?: string }[]; tone: "in" | "out"; head: string }) {
  const t = useChartTheme();
  const color = tone === "in" ? t.in : t.out;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ChartCard title={title} subtitle={subtitle} table={<SimpleTable head={[head, "Amount", ""]} rows={rows.map((r) => [r.label, rupeesShort(r.value), r.extra ?? ""])} />}>
      {rows.length === 0 ? <p className="px-4 py-10 text-center text-[0.9rem] text-muted">Nothing to show.</p> : (
        <ul className="space-y-2.5 px-2 pb-1">
          {rows.map((r) => (
            <li key={r.label} className="group grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3" title={`${r.label}: ${rupeesShort(r.value)}${r.extra ? ` · ${r.extra}` : ""}`}>
              <span className="truncate text-[0.85rem] text-ink">{r.label}</span>
              <span className="relative h-[14px]"><span className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} /></span>
              <span className="num w-24 text-right text-[0.85rem] font-semibold text-ink">{rupeesShort(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Money owed by how late it is. Not-yet-due is one colour, the late bands another. */
export function AgeingChart({ rows }: { rows: { label: string; value: number; count: number }[] }) {
  const t = useChartTheme();
  const data = rows.map((r) => ({ ...r, fill: r.label === "Not yet due" ? t.in : t.out }));
  return (
    <ChartCard
      title="How late the money is"
      subtitle="What customers owe, by days past the due date"
      table={<SimpleTable head={["Band", "Amount", "Invoices"]} rows={rows.map((r) => [r.label, rupeesShort(r.value), String(r.count)])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={t.grid} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: t.grid }} tick={{ fill: t.axis, fontSize: 11 }} interval={0} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={axisMoney} width={48} />
            <Tooltip cursor={{ fill: t.grid, opacity: 0.6 }} content={(p) => <Tip active={p.active} payload={p.payload as ReadonlyArray<TipEntry>} label={p.label} />} />
            <Bar dataKey="value" name="Owed" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { fill: string } }) => (
                <rect x={props.x} y={props.y} width={props.width} height={props.height} rx={4} fill={props.payload?.fill} />
              )} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
