"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Clock, Copy, ExternalLink, FileText, Loader2, PackageSearch, Plus, Receipt, RefreshCw, Search, SendHorizonal, Sparkles, Square, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Markdown, type RefLink } from "@/app/(app)/digital-brain/Markdown";

type Hit = { kind: "plate" | "invoice" | "order"; label: string; sub: string; href: string };
type Meta = { refs?: RefLink[]; follow_ups?: string[]; confidence?: string; usd?: number; model?: string } | null;
type PMsg = { id: string; role: "user" | "assistant"; content: string; pending?: boolean; status?: string; error?: string; meta?: Meta; feedback?: number | null };
type PastChat = { id: string; title: string; updated_at: string };

// the page the person is on -> a name, the part of the records that fits it (narrows what the AI looks in: faster and cheaper) and a few starting questions
const PAGES: { prefix: string; title: string; scope: string; ask: string[] }[] = [
  { prefix: "/stock/check", title: "Stock check", scope: "stock", ask: ["Do we have SA 387 GR 22 CL2, 40 mm, 1250 × 6000?", "Which grades have the least stock?"] },
  { prefix: "/stock", title: "Plates", scope: "stock", ask: ["Which plates are the oldest in stock?", "How much SA 516 Gr 70 do we have?"] },
  { prefix: "/summary", title: "Summary", scope: "stock", ask: ["Which grade has the most stock?", "How much 50 mm plate do we have in all?"] },
  { prefix: "/count", title: "Physical count", scope: "stock", ask: ["How is the physical count going?"] },
  { prefix: "/mill-orders", title: "Mill orders", scope: "stock", ask: ["Which mill orders are still to arrive?"] },
  { prefix: "/orders", title: "Orders and dispatch", scope: "orders", ask: ["Which orders are open and late?", "What left the yard this week?"] },
  { prefix: "/payments", title: "Invoices and payments", scope: "money", ask: ["Which customers owe us the most?", "What is overdue by more than 60 days?"] },
  { prefix: "/mail", title: "Mail and leads", scope: "mail", ask: ["Any new leads this week?", "Which quotes have had no follow-up?"] },
  { prefix: "/tally/invoices", title: "Tally invoices", scope: "tally", ask: ["Which invoices have no PO on file?", "Which invoices are missing certificates?"] },
  { prefix: "/tally", title: "Tally", scope: "tally", ask: ["Is Tally connected and when was the last sync?", "What do customers owe us in Tally?"] },
  { prefix: "/documents", title: "Documents", scope: "documents", ask: ["Which documents are waiting for review?"] },
  { prefix: "/drafts", title: "Drafts", scope: "documents", ask: ["Which drafts are still open?"] },
  { prefix: "/sheets", title: "Sheet view", scope: "sheets", ask: ["Find this text in the sheets"] },
  { prefix: "/review", title: "Needs review", scope: "all", ask: ["What are the most serious items to review?"] },
  { prefix: "/", title: "Overview", scope: "all", ask: ["Give me the overview", "What changed in stock this week?"] },
];
const pageOf = (path: string) => PAGES.find((p) => (p.prefix === "/" ? path === "/" : path === p.prefix || path.startsWith(p.prefix + "/"))) ?? { prefix: path, title: "this app", scope: "all", ask: ["Give me the overview"] };

const QUESTION = /^(do|does|did|how|what|which|who|whom|when|where|why|is|are|was|were|can|could|show|give|find|list|tell|take|open|compare|explain|any)\b/i;
const looksLikeQuestion = (v: string) => /\?\s*$/.test(v.trim()) || QUESTION.test(v.trim()) || v.trim().split(/\s+/).length >= 6;

const ICON = { plate: PackageSearch, invoice: Receipt, order: FileText } as const;

/** The search bar in the top of every page: instant exact matches as you type, plus AI mode, a quick answer panel that knows which page you are on. */
export function TopSearch({ admin, thinkKey }: { admin: boolean; thinkKey: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const page = pageOf(path);

  const [value, setValue] = useState(path === "/stock" ? (sp.get("q") ?? "") : "");
  const [focus, setFocus] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [messages, setMessages] = useState<PMsg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [past, setPast] = useState<PastChat[]>([]);
  const [pastQ, setPastQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pageRef = useRef(page); pageRef.current = page;

  // the bar lives in the layout, so it would keep the last words typed on every page: empty it when another page opens (the plate search shows its own query)
  const stockQ = path === "/stock" ? (sp.get("q") ?? "") : "";
  const [seen, setSeen] = useState(path + "|" + stockQ);
  if (seen !== path + "|" + stockQ) { setSeen(path + "|" + stockQ); setValue(stockQ); setHits([]); }

  // exact matches while typing (plates, and for administrators invoices and orders): free, no AI
  useEffect(() => {
    const t = value.trim();
    if (t.length < 3) { setHits([]); return; }
    const id = window.setTimeout(async () => {
      try { const r = await fetch(`/api/search?q=${encodeURIComponent(t)}`); if (r.ok) setHits((await r.json()) as Hit[]); } catch { /* the list stays as it was */ }
    }, 220);
    return () => window.clearTimeout(id);
  }, [value]);

  // "/" or Ctrl+K jumps to the search bar
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); input.current?.focus(); }
      if (e.key === "Escape") { setFocus(false); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages, view]);
  useEffect(() => { if (open && view === "chat") window.setTimeout(() => box.current?.focus(), 60); }, [open, view]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const loadPast = useCallback(async (q: string) => {
    try { const r = await fetch(`/api/ask/chats?origin=ai_mode${q ? `&q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" }); if (r.ok) setPast((await r.json()) as PastChat[]); } catch { /* keep */ }
  }, []);
  useEffect(() => { if (open && view === "history") { const id = window.setTimeout(() => void loadPast(pastQ.trim()), pastQ ? 250 : 0); return () => window.clearTimeout(id); } }, [open, view, pastQ, loadPast]);

  function context() {
    const params: Record<string, string> = {};
    sp.forEach((v, k) => { if (v && Object.keys(params).length < 10) params[k] = v.slice(0, 80); });
    return { path, title: pageRef.current.title, params };
  }

  async function ask(question: string, opts: { regenerate?: boolean; model?: "ai_mode" | "think_harder" } = {}) {
    const text = question.trim();
    if ((!opts.regenerate && text.length < 2) || busy) return;
    const aId = "p-" + Math.random().toString(36).slice(2);
    setView("chat"); setOpen(true); setFocus(false);
    setMessages((ms) => {
      const base = opts.regenerate ? (ms.at(-1)?.role === "assistant" ? ms.slice(0, -1) : ms) : [...ms, { id: "u-" + aId, role: "user" as const, content: text }];
      return [...base, { id: aId, role: "assistant", content: "", pending: true, status: "Thinking" }];
    });
    setDraft(""); setValue(""); setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    let realId = aId;
    const set = (f: (m: PMsg) => PMsg) => setMessages((ms) => ms.map((m) => (m.id === realId ? f(m) : m)));
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ question: text, chatId, model: opts.model ?? "ai_mode", scope: pageRef.current.scope, mode: "quick", page: context(), regenerate: opts.regenerate === true }),
      });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); set((m) => ({ ...m, pending: false, status: undefined, error: (j as { error?: string }).error ?? "It could not be answered. Please try again." })); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buf += dec.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as { type: string; text?: string; chatId?: string; messageId?: string; error?: string; result?: { answer: string; refs?: RefLink[]; follow_ups: string[]; confidence: string; usd: number; model: string } };
          if (e.type === "meta" && e.chatId) setChatId(e.chatId);
          else if (e.type === "status") set((m) => ({ ...m, status: e.text }));
          else if (e.type === "delta") set((m) => ({ ...m, content: m.content + (e.text ?? ""), status: undefined }));
          else if (e.type === "reset") set((m) => ({ ...m, content: "" }));
          else if (e.type === "saved" && e.messageId) { const old = realId; realId = e.messageId; setMessages((ms) => ms.map((m) => (m.id === old ? { ...m, id: e.messageId! } : m))); }
          else if (e.type === "done" && e.result) { const r = e.result; set((m) => ({ ...m, content: r.answer, pending: false, status: undefined, meta: { refs: r.refs, follow_ups: r.follow_ups, confidence: r.confidence, usd: r.usd, model: r.model } })); }
          else if (e.type === "error") set((m) => ({ ...m, pending: false, status: undefined, error: e.error }));
        }
      }
      set((m) => (m.pending ? { ...m, pending: false, status: undefined } : m));
    } catch (err) {
      const stopped = err instanceof DOMException && err.name === "AbortError";
      set((m) => ({ ...m, pending: false, status: undefined, error: stopped ? undefined : "The connection dropped. Please try again.", content: m.content || (stopped ? "Stopped." : "") }));
    } finally { setBusy(false); abort.current = null; }
  }

  async function openPast(id: string) {
    try {
      const r = await fetch(`/api/ask/chats/${id}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { messages: { id: string; role: "user" | "assistant"; content: string; feedback: number | null; meta: Meta }[] };
      setMessages(j.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, feedback: m.feedback, meta: m.meta })));
      setChatId(id); setView("chat");
    } catch { /* keep */ }
  }
  function fresh() { if (busy) return; setMessages([]); setChatId(null); setView("chat"); setDraft(""); window.setTimeout(() => box.current?.focus(), 30); }
  async function feedback(m: PMsg, v: 1 | -1) {
    const next = m.feedback === v ? 0 : v;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, feedback: next || null } : x)));
    await fetch("/api/ask/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m.id, value: next }) }).catch(() => {});
  }
  function copy(m: PMsg) { void navigator.clipboard?.writeText(m.content.replace(/\s*\[r\d+\]/g, "")); setCopied(m.id); window.setTimeout(() => setCopied(null), 1400); }

  // the rows of the dropdown, in order, for the keyboard
  const t = value.trim();
  const question = looksLikeQuestion(t);
  const rows = useMemo(() => {
    const out: { key: string; run: () => void }[] = [];
    if (t.length >= 2) {
      const aiRow = { key: "ai", run: () => void ask(t) };
      const plateRow = { key: "plates", run: () => { setFocus(false); router.push(`/stock?q=${encodeURIComponent(t)}`); } };
      if (question) out.push(aiRow);
      hits.forEach((h) => out.push({ key: h.href, run: () => { setFocus(false); router.push(h.href); } }));
      out.push(plateRow);
      if (!question) out.push(aiRow);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, hits, question, busy, chatId]);
  useEffect(() => { setActive(0); }, [t, hits.length]);

  const showDrop = focus && t.length >= 2;
  const suggestions = page.ask.filter((s) => admin || !/owe|overdue|lead|quote|Tally|invoice|order|mail/i.test(s));

  return (
    <>
      <form
        onSubmit={(e) => { e.preventDefault(); if (rows[active]) rows[active].run(); else if (t) router.push(`/stock?q=${encodeURIComponent(t)}`); }}
        className="relative ml-auto w-full max-w-md lg:ml-0"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          ref={input} name="q" value={value} autoComplete="off" aria-label="Search" aria-expanded={showDrop}
          onChange={(e) => setValue(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(rows.length - 1, 0))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && t) { e.preventDefault(); void ask(t); }
          }}
          placeholder="Search a plate, heat number or invoice, or ask a question"
          className="w-full rounded-md border border-line bg-field py-2 pl-9 pr-24 text-[0.95rem] placeholder:text-muted/80"
        />
        <button type="button" onClick={() => { if (t) void ask(t); else { setOpen(true); setView("chat"); } }} title="AI mode: ask a question in plain words (Ctrl+Enter)"
          className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded bg-brand-soft px-2 py-1 text-[0.78rem] font-semibold text-brand hover:bg-brand hover:text-white">
          <Sparkles className="h-3.5 w-3.5" />AI mode
        </button>

        {showDrop && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg" role="listbox">
            {rows.map((r, i) => {
              const cls = "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[0.88rem] " + (i === active ? "bg-brand-soft" : "hover:bg-surface");
              if (r.key === "ai") return (
                <button key="ai" type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={r.run} onMouseEnter={() => setActive(i)} className={cls}>
                  <Sparkles className="h-4 w-4 shrink-0 text-brand" /><span className="min-w-0 flex-1 truncate"><b>Ask AI mode:</b> “{t}”</span><span className="hidden shrink-0 text-[0.72rem] text-muted sm:inline">Ctrl+Enter</span>
                </button>);
              if (r.key === "plates") return (
                <button key="plates" type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={r.run} onMouseEnter={() => setActive(i)} className={cls}>
                  <Search className="h-4 w-4 shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">Search plates for “{t}”</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                </button>);
              const h = hits.find((x) => x.href === r.key)!;
              const Icon = ICON[h.kind];
              return (
                <button key={r.key} type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={r.run} onMouseEnter={() => setActive(i)} className={cls}>
                  <Icon className="h-4 w-4 shrink-0 text-muted" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.label}</span><span className="block truncate text-[0.78rem] text-muted">{h.sub}</span></span>
                </button>);
            })}
          </div>
        )}
      </form>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="AI mode">
          <button type="button" className="absolute inset-0 bg-black/25" onClick={() => setOpen(false)} aria-label="Close AI mode" />
          <aside className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-card shadow-2xl sm:w-[28rem] lg:w-[32rem]">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Sparkles className="h-4 w-4 text-brand" />
              <h2 className="font-display text-[1rem] font-bold">AI mode</h2>
              <span className="truncate rounded-full bg-surface px-2 py-0.5 text-[0.72rem] text-muted" title="The page you are on: questions like “this” or “these” mean what it shows">On: {page.title}</span>
              <span className="ml-auto flex items-center">
                <button type="button" onClick={() => setView(view === "history" ? "chat" : "history")} className={"rounded p-1.5 hover:bg-surface " + (view === "history" ? "text-brand" : "text-muted hover:text-ink")} aria-label="Past questions" title="Past questions"><Clock className="h-4 w-4" /></button>
                <button type="button" onClick={fresh} disabled={busy} className="rounded p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-40" aria-label="New question" title="New conversation"><Plus className="h-4 w-4" /></button>
                {chatId && <Link href={`/digital-brain?chat=${chatId}`} onClick={() => setOpen(false)} className="rounded p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Open in Digital Brain" title="Continue in Digital Brain"><ExternalLink className="h-4 w-4" /></Link>}
                <button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></button>
              </span>
            </header>

            {view === "history" ? (
              <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <input value={pastQ} onChange={(e) => setPastQ(e.target.value)} placeholder="Search past questions and answers" className="w-full rounded-md border border-line bg-field py-1.5 pl-8 pr-2 text-[0.88rem]" autoFocus /></div>
                <ul className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                  {past.length === 0 && <li className="px-1 py-3 text-[0.88rem] text-muted">{pastQ ? "No past question matches." : "Your AI mode questions will be listed here."}</li>}
                  {past.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => void openPast(c.id)} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-surface">
                      <span className="block truncate text-[0.9rem] font-medium">{c.title}</span>
                      <span className="block text-[0.74rem] text-muted">{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(c.updated_at))}</span>
                    </button></li>
                  ))}
                </ul>
                <p className="pt-2 text-[0.74rem] text-muted">Also kept in Digital Brain under your chats.</p>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
                  {messages.length === 0 && (
                    <div className="mt-4">
                      <p className="text-[0.95rem] font-medium">Ask anything about {page.title === "this app" ? "the business" : page.title.toLowerCase()}.</p>
                      <p className="mt-1 text-[0.84rem] text-muted">Short answers from your records, with links to check them. I only read; I cannot change anything.</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {suggestions.map((s) => <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-[0.82rem] hover:border-brand hover:text-brand">{s}</button>)}
                      </div>
                    </div>
                  )}
                  <div className="space-y-5">
                    {messages.map((m, idx) => m.role === "user" ? (
                      <div key={m.id} className="flex justify-end"><p className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-[0.9rem]">{m.content}</p></div>
                    ) : (
                      <div key={m.id}>
                        {m.pending && !m.content && <p className="flex items-center gap-2 text-[0.88rem] text-muted"><Loader2 className="h-4 w-4 animate-spin" />{m.status ?? "Thinking"}…</p>}
                        {m.pending && m.content && m.status && <p className="mb-1 flex items-center gap-2 text-[0.78rem] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{m.status}…</p>}
                        {m.content && <Markdown text={m.content} refs={m.pending ? undefined : m.meta?.refs ?? []} />}
                        {m.error && <p className="text-[0.88rem] text-bad">{m.error}</p>}
                        {!m.pending && m.meta?.refs && m.meta.refs.length > 0 && (
                          <ol className="mt-2 space-y-1 rounded-lg border border-line bg-surface/50 px-3 py-2">
                            {m.meta.refs.map((r) => (
                              <li key={r.id} className="flex items-start gap-2 text-[0.78rem]">
                                <span className="mt-0.5 inline-flex h-[1.05rem] min-w-[1.05rem] shrink-0 items-center justify-center rounded-full bg-brand-soft px-1 text-[0.64rem] font-semibold text-brand">{r.n}</span>
                                <span className="min-w-0"><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">{r.label}<ExternalLink className="h-3 w-3 shrink-0" /></a>{r.note && <span className="block truncate text-muted" title={r.note}>{r.note}</span>}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {!m.pending && m.content && !m.error && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-0.5 text-muted">
                            <button type="button" onClick={() => copy(m)} className="rounded p-1.5 hover:bg-surface hover:text-ink" aria-label="Copy the answer">{copied === m.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}</button>
                            {!m.id.startsWith("p-") && <>
                              <button type="button" onClick={() => void feedback(m, 1)} className={"rounded p-1.5 hover:bg-surface hover:text-ink " + (m.feedback === 1 ? "text-ok" : "")} aria-label="Good answer" aria-pressed={m.feedback === 1}><ThumbsUp className="h-4 w-4" /></button>
                              <button type="button" onClick={() => void feedback(m, -1)} className={"rounded p-1.5 hover:bg-surface hover:text-ink " + (m.feedback === -1 ? "text-bad" : "")} aria-label="Not a good answer" aria-pressed={m.feedback === -1}><ThumbsDown className="h-4 w-4" /></button></>}
                            {idx === messages.length - 1 && !busy && m.meta?.model !== thinkKey && (
                              <button type="button" onClick={() => void ask("", { regenerate: true, model: "think_harder" })} className="ml-1 inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[0.76rem] hover:border-brand hover:text-brand" title="Ask the same question again with the stronger model. It takes a little longer and costs about 50 paise."><RefreshCw className="h-3 w-3" />Think harder</button>
                            )}
                          </div>
                        )}
                        {idx === messages.length - 1 && !busy && m.meta?.follow_ups && m.meta.follow_ups.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">{m.meta.follow_ups.map((f) => <button key={f} type="button" onClick={() => void ask(f)} className="rounded-full border border-line px-2.5 py-1 text-[0.78rem] hover:border-brand hover:text-brand">{f}</button>)}</div>
                        )}
                      </div>
                    ))}
                    <div ref={endRef} />
                  </div>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); void ask(draft); }} className="border-t border-line p-3">
                  <div className="flex items-end gap-2 rounded-xl border border-line bg-field p-1.5 focus-within:border-brand">
                    <textarea ref={box} value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} maxLength={600} disabled={busy} placeholder="Ask a question…" aria-label="Your question"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); } }}
                      className="max-h-32 min-h-[2rem] flex-1 resize-none bg-transparent px-2 py-1 text-[0.92rem] outline-none" />
                    {busy
                      ? <button type="button" onClick={() => abort.current?.abort()} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[0.82rem] font-medium hover:bg-surface"><Square className="h-3.5 w-3.5" />Stop</button>
                      : <button type="submit" disabled={draft.trim().length < 2} className="inline-flex items-center rounded-lg bg-brand p-2 text-white hover:bg-brand-dark disabled:opacity-50" aria-label="Ask"><SendHorizonal className="h-4 w-4" /></button>}
                  </div>
                  <p className="mt-1.5 text-center text-[0.7rem] text-muted">Quick answers can be wrong: check the linked sources.</p>
                </form>
              </>
            )}
          </aside>
        </div>, document.body)}
    </>
  );
}
