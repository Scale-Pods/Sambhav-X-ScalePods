import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { Info } from "./Info";
import { explain } from "@/lib/glossary";

export function PageHeader({ title, hint, actions, help }: { title: string; hint?: string; actions?: ReactNode; help?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="mb-3 h-1 w-10 rounded-full bg-accent" />
        <h1 className="font-display text-[1.9rem] font-extrabold leading-tight tracking-[-0.02em]">{title}{help && <Info className="!h-5 !w-5 !text-[0.72rem]">{help}</Info>}</h1>
        {hint && <p className="mt-1.5 max-w-2xl text-[0.97rem] leading-relaxed text-muted">{hint}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, aside, children, className = "", help }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string; help?: ReactNode }) {
  return (
    <section className={"rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(24,34,45,0.04)] " + className}>
      {(title || aside) && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-[1.02rem] font-bold tracking-[-0.01em]">{title}{help && <Info>{help}</Info>}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export type Delta = { text: string; tone: "good" | "bad" | "neutral"; up: boolean | null };

export function Stat({ label, value, unit, sub, tone, delta, info }: { label: string; value: string; unit?: string; sub?: string; tone?: "brand" | "accent"; delta?: Delta; info?: ReactNode }) {
  const dtone = delta?.tone === "good" ? "text-ok" : delta?.tone === "bad" ? "text-bad" : "text-muted";
  return (
    <div className="rounded-lg border border-line border-l-4 border-l-accent bg-card p-5 shadow-[0_1px_2px_rgba(24,34,45,0.04)]">
      <p className="text-[0.74rem] font-semibold uppercase tracking-[0.1em] text-muted">{label}{info ? <Info>{info}</Info> : explain(label) ? <Info term={label} /> : null}</p>
      <p className={"mt-2.5 font-display text-[2.1rem] font-extrabold leading-none tracking-[-0.02em] " + (tone === "accent" ? "text-accent" : "")}>
        {value}
        {unit && <span className="ml-1.5 font-sans text-base font-medium tracking-normal text-muted">{unit}</span>}
      </p>
      {delta && (
        <p className={"mt-2.5 text-[0.82rem] font-semibold " + dtone}>
          {delta.up === null ? "" : delta.up ? "▲ " : "▼ "}{delta.text}
        </p>
      )}
      {sub && <p className="mt-1.5 text-[0.82rem] text-muted">{sub}</p>}
    </div>
  );
}

const tones = {
  error: "bg-bad-soft text-bad ring-bad/25",
  warning: "bg-warn-soft text-warn ring-warn/25",
  info: "bg-info-soft text-brand-dark ring-brand/25",
  ok: "bg-ok-soft text-ok ring-ok/25",
  neutral: "bg-surface text-muted ring-line",
} as const;

/** A status label. `info` adds an "i" that says what this status means. */
export function Badge({ tone = "neutral", children, info }: { tone?: keyof typeof tones; children: ReactNode; info?: ReactNode }) {
  return <span className={"inline-flex items-center rounded-md px-2 py-0.5 text-[0.74rem] font-semibold ring-1 ring-inset " + tones[tone]}>{children}{info ? <Info>{info}</Info> : null}</span>;
}

export const th = "px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-wider text-muted";
/** A table heading. When its text is in the glossary (lib/glossary.ts) an "i" explains it; `info` gives the explanation directly, `info={false}` switches it off. */
export function Th({ children, right, className = "", info }: { children: ReactNode; right?: boolean; className?: string; info?: ReactNode | false }) {
  const label = typeof children === "string" ? children : null;
  return (
    <th className={th + (right ? " text-right" : "") + (className ? " " + className : "")}>
      {children}{info ? <Info>{info}</Info> : info === false || !label || !explain(label) ? null : <Info term={label} />}
    </th>
  );
}

export const td = "px-4 py-2.5 text-[0.92rem]";

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="skeleton h-4 w-1/4" />
          <div className="skeleton h-4 flex-1" style={{ maxWidth: `${38 + ((i * 13) % 30)}%` }} />
          <div className="skeleton ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading totals">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-line border-l-4 border-l-accent bg-card p-5">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton mt-4 h-8 w-36" />
          <div className="skeleton mt-4 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

/** First load: the Sambhav logo, breathing, with the page outline underneath. */
export function BrandLoader() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-8 flex flex-col items-center gap-3 pt-6">
        <Logo className="logo-breathe w-64" />
        <p className="text-sm text-muted">Getting your stock ready…</p>
      </div>
      <div className="mb-6 space-y-2"><div className="skeleton h-7 w-56" /><div className="skeleton h-4 w-96 max-w-full" /></div>
      <StatsSkeleton />
      <div className="mt-6 rounded-lg border border-line bg-card"><Skeleton rows={6} /></div>
    </div>
  );
}
