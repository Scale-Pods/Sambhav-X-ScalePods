import type { ReactNode } from "react";

export function PageHeader({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.65rem] font-semibold tracking-tight">{title}</h1>
        {hint && <p className="mt-1 max-w-2xl text-[0.95rem] text-muted">{hint}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, aside, children, className = "" }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={"rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(18,41,58,0.04)] " + className}>
      {(title || aside) && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[1rem] font-semibold">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: "brand" | "accent" }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(18,41,58,0.04)]">
      <p className="text-[0.8rem] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={"num mt-2 text-[2rem] font-semibold leading-none " + (tone === "accent" ? "text-accent" : tone === "brand" ? "text-brand-dark" : "")}>
        {value}
        {unit && <span className="ml-1.5 text-base font-medium text-muted">{unit}</span>}
      </p>
      {sub && <p className="mt-2 text-[0.85rem] text-muted">{sub}</p>}
    </div>
  );
}

const tones = {
  error: "bg-red-50 text-bad ring-red-200",
  warning: "bg-amber-50 text-warn ring-amber-200",
  info: "bg-sky-50 text-brand-dark ring-sky-200",
  ok: "bg-emerald-50 text-ok ring-emerald-200",
  neutral: "bg-surface text-muted ring-line",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={"inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold ring-1 ring-inset " + tones[tone]}>{children}</span>;
}

export const th = "px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-muted";
export const td = "px-4 py-2.5 text-[0.92rem]";

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-surface" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}
