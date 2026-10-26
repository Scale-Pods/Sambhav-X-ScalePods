"use client";

import { useRef, useState } from "react";
import { Loader2, SendHorizonal } from "lucide-react";
import { Badge } from "@/components/ui";

type Answer = { answer: string; sources: string[]; follow_ups: string[]; confidence: "found" | "partly" | "not_found"; used: { name: string }[] };
type Item = { id: number; q: string; state: "loading" | "done" | "error"; a?: Answer; error?: string };

export function AskBox({ suggestions }: { suggestions: string[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const next = useRef(1);
  const busy = items.some((i) => i.state === "loading");

  async function send(question: string) {
    const qn = question.trim();
    if (!qn || busy) return;
    const id = next.current++;
    const history = items.filter((i) => i.state === "done" && i.a).slice(-3).map((i) => ({ q: i.q, a: i.a!.answer }));
    setItems((xs) => [{ id, q: qn, state: "loading" }, ...xs]);
    setText("");
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: qn, history }) });
      const j = await r.json().catch(() => ({}));
      setItems((xs) => xs.map((x) => (x.id !== id ? x : r.ok && j.ok ? { ...x, state: "done", a: j } : { ...x, state: "error", error: j.error ?? "It could not be answered. Please try again." })));
    } catch {
      setItems((xs) => xs.map((x) => (x.id !== id ? x : { ...x, state: "error", error: "The connection dropped. Please try again." })));
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-end gap-2">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          placeholder="Ask anything, e.g. Do we have 12 mm SA 516 Gr 70, 1500 × 6000? or What does Sai Steel owe us?"
          className="min-h-[3.2rem] flex-1 resize-y rounded-lg border border-line bg-field px-3 py-2.5 text-[0.95rem] focus:border-brand" aria-label="Your question"
        />
        <button type="submit" disabled={busy || text.trim().length < 2} className="inline-flex h-[3.2rem] items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}Ask
        </button>
      </form>

      {items.length === 0 && (
        <div>
          <p className="mb-2 text-[0.8rem] font-semibold uppercase tracking-wider text-muted">Try one</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-card px-3 py-1.5 text-[0.85rem] hover:border-brand hover:text-brand">{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {items.map((it) => (
          <section key={it.id} className="rounded-lg border border-line bg-card p-4 shadow-[0_1px_2px_rgba(24,34,45,0.04)]" aria-live="polite">
            <p className="text-[0.82rem] font-semibold text-muted">{it.q}</p>
            {it.state === "loading" && <p className="mt-2 flex items-center gap-2 text-[0.92rem] text-muted"><Loader2 className="h-4 w-4 animate-spin" />Looking it up…</p>}
            {it.state === "error" && <p className="mt-2 text-[0.92rem] text-bad">{it.error}</p>}
            {it.state === "done" && it.a && (
              <div className="mt-2 space-y-2.5">
                <p className="whitespace-pre-line text-[0.97rem] leading-relaxed">{it.a.answer}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-[0.78rem] text-muted">
                  {it.a.confidence === "not_found" && <Badge tone="warning">Nothing found</Badge>}
                  {it.a.confidence === "partly" && <Badge tone="info">Partly answered</Badge>}
                  {it.a.sources.length > 0 && <span>From: {it.a.sources.join(" · ")}</span>}
                </div>
                {it.a.follow_ups.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {it.a.follow_ups.map((f) => <button key={f} type="button" disabled={busy} onClick={() => void send(f)} className="rounded-full border border-line px-3 py-1 text-[0.82rem] hover:border-brand hover:text-brand disabled:opacity-50">{f}</button>)}
                  </div>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
