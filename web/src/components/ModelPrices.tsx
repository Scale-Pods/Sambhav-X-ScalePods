"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { INR_PER_USD, MODEL_LIST, typicalUsd, type ModelDef } from "@/lib/ask/models";

// An "i" button that opens the price guide for every model: what a question costs, the list price per million tokens, and which model suits what.
// All figures come from lib/ask/models.ts, so adding a model there adds it here.

const rs = (usd: number, dp?: number) => {
  const v = usd * INR_PER_USD;
  const d = dp ?? (v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 2 : 3);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const perQuestion = (m: ModelDef) => (m.measured !== undefined ? m.measured / 100 : typicalUsd(m));
const th = "px-2.5 py-1.5 text-left text-[0.72rem] font-semibold uppercase tracking-wide text-muted";
const td = "px-2.5 py-1.5 align-top";

export function ModelPrices({ roles = {} }: { roles?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  const rows = [...MODEL_LIST].sort((a, b) => perQuestion(a) - perQuestion(b));
  const name = (m: ModelDef) => (
    <>
      <span className="font-medium">{m.name}</span> <span className="text-muted">({m.tier})</span>
      <span className="block text-[0.72rem] text-muted">{m.provider === "anthropic" ? "Anthropic" : "OpenAI"}{roles[m.key] ? " · " + roles[m.key] : ""}</span>
    </>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Model prices and which model to use"
        className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-line bg-card align-middle text-[0.62rem] font-bold normal-case italic leading-none tracking-normal text-muted hover:border-brand hover:text-brand focus-visible:outline-2">i</button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-8" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl rounded-xl border border-line bg-card p-4 shadow-xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={id} className="font-display text-lg font-bold">What each model costs</h2>
                <p className="mt-0.5 text-[0.82rem] text-muted">In rupees at ₹{INR_PER_USD} to the dollar. Prices as read from Anthropic and OpenAI on 30 Oct 2026.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink"><X className="h-5 w-5" /></button>
            </div>

            <h3 className="mt-4 text-[0.92rem] font-bold">1. Cost of a question (cheapest first)</h3>
            <p className="text-[0.8rem] text-muted">Measured on 8 real questions about our stock, debtors, invoices, leads and orders. A longer or vaguer question costs more.</p>
            <div className="mt-1.5 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[34rem] text-[0.84rem]">
                <thead className="bg-surface"><tr><th className={th}>Model</th><th className={th + " text-right"}>One question</th><th className={th + " text-right"}>100 questions</th><th className={th + " text-right"}>1,000 questions</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map((m) => { const u = perQuestion(m); return (
                    <tr key={m.key}>
                      <td className={td}>{name(m)}</td>
                      <td className={td + " text-right tabular-nums"}>{m.measured === undefined ? "~" : ""}{rs(u)}</td>
                      <td className={td + " text-right tabular-nums"}>{rs(u * 100, u * 100 * INR_PER_USD >= 100 ? 0 : 1)}</td>
                      <td className={td + " text-right tabular-nums"}>{rs(u * 1000, 0)}</td>
                    </tr>); })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[0.76rem] text-muted">~ means not tested yet: a guess from the price list. Haiku was measured before a small fix, so its real cost is a little higher.</p>

            <h3 className="mt-5 text-[0.92rem] font-bold">2. List price per 1 million tokens</h3>
            <p className="text-[0.8rem] text-muted">What the providers charge. One question uses roughly 7,000 tokens, so 1 million tokens is about 150 questions. Output costs more than input. “Repeated input” is text the provider has seen a moment ago and bills lower (OpenAI only).</p>
            <div className="mt-1.5 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[34rem] text-[0.84rem]">
                <thead className="bg-surface"><tr><th className={th}>Model</th><th className={th + " text-right"}>Input</th><th className={th + " text-right"}>Repeated input</th><th className={th + " text-right"}>Output</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {[...MODEL_LIST].sort((a, b) => a.out - b.out || a.in - b.in).map((m) => (
                    <tr key={m.key}>
                      <td className={td}>{name(m)}</td>
                      <td className={td + " text-right tabular-nums"}>{rs(m.in, 2)}</td>
                      <td className={td + " text-right tabular-nums"}>{m.cached !== undefined ? rs(m.cached, 2) : "-"}</td>
                      <td className={td + " text-right tabular-nums"}>{rs(m.out, 2)}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>

            <h3 className="mt-5 text-[0.92rem] font-bold">3. Which model for what</h3>
            <div className="mt-1.5 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[34rem] text-[0.84rem]">
                <thead className="bg-surface"><tr><th className={th}>Model</th><th className={th}>Use it for</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {MODEL_LIST.map((m) => <tr key={m.key}><td className={td}>{name(m)}</td><td className={td}>{m.note}</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[0.78rem] text-muted">Reading documents (invoices, test certificates, orders) always uses Haiku 5.5 first and Sonnet 5.5 only when the first read is doubtful. That is separate from the models above.</p>
          </div>
        </div>, document.body)}
    </>
  );
}
