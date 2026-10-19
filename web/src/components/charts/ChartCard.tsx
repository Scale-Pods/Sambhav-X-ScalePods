"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";

/** A chart with a "view as table" twin, so no value is reachable only by hovering. */
export function ChartCard({ title, subtitle, legend, table, children, className = "" }: {
  title: string; subtitle?: string; legend?: ReactNode; table: ReactNode; children: ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={"rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(24,34,45,0.04)] " + className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="font-display text-[1.02rem] font-bold tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[0.82rem] text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {legend}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            title={asTable ? "Show as chart" : "Show as table"}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[0.78rem] font-medium text-muted hover:bg-surface hover:text-ink"
          >
            {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
            {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </div>
      {asTable ? <div className="max-h-[22rem] overflow-auto">{table}</div> : <div className="px-3 pb-3 pt-4">{children}</div>}
    </section>
  );
}

/** Legend key that mirrors the mark: a small rounded rect for bars, a short stroke for lines. */
export function LegendKey({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.78rem] text-muted">
      <span className={line ? "h-[2px] w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"} style={{ background: color }} />
      {label}
    </span>
  );
}
