"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Loader2, Menu, MessageSquarePlus, Pencil, Pin, PinOff, RefreshCw, Search, SendHorizonal, Square, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { Markdown, type RefLink } from "./Markdown";

type ModelKey = "fast" | "balanced";
type Chat = { id: string; title: string; pinned: boolean; model: ModelKey; scope: string; updated_at: string };
type Meta = { sources?: string[]; refs?: RefLink[]; follow_ups?: string[]; confidence?: string; used?: { name: string; rows: number | null }[]; usd?: number; model?: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; feedback: number | null; meta: Meta | null; pending?: boolean; status?: string; error?: string };

export type AskAppProps = {
  suggestions: string[];
  scopes: { value: string; label: string }[];
  models: { value: ModelKey; label: string; hint: string }[];
  spend: { spent: number; cap: number | null } | null;
};

const LOOKED: Record<string, string> = {
  stock_check: "Stock check", stock_summary: "Stock totals", plate_lookup: "Plate lookup", overview: "Overview", orders_search: "Orders", order_detail: "Order lines", dispatch_search: "Vehicle register",
  receivables: "Receivables", payables: "Payables", invoices_search: "Invoices", payments_search: "Payments", leads_mail_quotes: "Mail and leads", invoice_trail: "Invoice paperwork",
  tally_voucher: "Tally vouchers", tally_party: "Tally party", documents_search: "Documents", drafts_search: "Drafts", count_status: "Stock counts", sheet_search: "Sheets",
};

const cents = (usd: number) => (usd < 0.01 ? "under 1 cent" : `${Math.round(usd * 100)} cents`);

export function AskApp({ suggestions, scopes, models, spend }: AskAppProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatCost, setChatCost] = useState(0);
  const [loadingChat, setLoadingChat] = useState(false);
  const [text, setText] = useState("");
  const [model, setModel] = useState<ModelKey>("balanced");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [today, setToday] = useState(spend?.spent ?? 0);
  const [now] = useState(() => new Date());
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const loadChats = useCallback(async () => {
    try { const r = await fetch("/api/ask/chats", { cache: "no-store" }); if (r.ok) setChats((await r.json()) as Chat[]); } catch { /* the list stays as it was */ }
  }, []);
  useEffect(() => { void loadChats(); }, [loadChats]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages]);
  useEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; } }, [text]);

  async function openChat(id: string) {
    if (busy) return;
    setDrawer(false); setLoadingChat(true); setActiveId(id);
    try {
      const r = await fetch(`/api/ask/chats/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { chat: Chat; messages: Msg[]; usd: number };
      setMessages(j.messages.map((m) => ({ ...m, meta: m.meta ?? null })));
      setModel(j.chat.model); setScope(j.chat.scope); setChatCost(j.usd);
    } catch { setMessages([]); }
    setLoadingChat(false);
  }
  function newChat() { if (busy) return; setActiveId(null); setMessages([]); setChatCost(0); setDrawer(false); box.current?.focus(); }

  async function send(question: string, regenerate = false) {
    const qn = question.trim();
    if ((!regenerate && qn.length < 2) || busy) return;
    const aId = "pending-" + Math.random().toString(36).slice(2);
    setMessages((ms) => {
      const base = regenerate ? (ms.at(-1)?.role === "assistant" ? ms.slice(0, -1) : ms) : [...ms, { id: "u-" + aId, role: "user" as const, content: qn, feedback: null, meta: null }];
      return [...base, { id: aId, role: "assistant", content: "", feedback: null, meta: null, pending: true, status: "Thinking" }];
    });
    setText(""); setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    const patch = (p: Partial<Msg>) => setMessages((ms) => ms.map((m) => (m.id === aId || (p.id && m.id === aId) ? { ...m, ...p } : m)));
    let realId = aId;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ question: qn, chatId: activeId, model, scope, regenerate }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); patch({ pending: false, error: j.error ?? "It could not be answered. Please try again." }); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as { type: string; text?: string; chatId?: string; messageId?: string; error?: string; result?: { answer: string; sources: string[]; refs?: RefLink[]; follow_ups: string[]; confidence: string; used: { name: string; rows: number | null }[]; usd: number; model: string } };
          if (e.type === "meta" && e.chatId) { setActiveId(e.chatId); void loadChats(); }
          else if (e.type === "status") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, status: e.text } : m)));
          else if (e.type === "delta") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, content: m.content + (e.text ?? ""), status: undefined } : m)));
          else if (e.type === "reset") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, content: "" } : m)));
          else if (e.type === "saved" && e.messageId) { const old = realId; realId = e.messageId; setMessages((ms) => ms.map((m) => (m.id === old ? { ...m, id: e.messageId! } : m))); }
          else if (e.type === "done" && e.result) {
            const r = e.result;
            setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, content: r.answer, pending: false, status: undefined, meta: { sources: r.sources, refs: r.refs, follow_ups: r.follow_ups, confidence: r.confidence, used: r.used, usd: r.usd, model: r.model } } : m)));
            setChatCost((c) => c + r.usd); setToday((t) => t + r.usd);
          } else if (e.type === "error") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, pending: false, status: undefined, error: e.error } : m)));
        }
      }
      setMessages((ms) => ms.map((m) => (m.id === realId && m.pending ? { ...m, pending: false, status: undefined } : m)));
    } catch (err) {
      const stopped = err instanceof DOMException && err.name === "AbortError";
      setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, pending: false, status: undefined, error: stopped ? undefined : "The connection dropped. Please try again.", content: m.content || (stopped ? "Stopped." : "") } : m)));
    } finally {
      setBusy(false); abort.current = null; void loadChats();
    }
  }

  async function feedback(m: Msg, v: 1 | -1) {
    const next = m.feedback === v ? 0 : v;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, feedback: next || null } : x)));
    await fetch("/api/ask/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m.id, value: next }) }).catch(() => {});
  }
  async function patchChat(id: string, body: Record<string, unknown>) {
    await fetch(`/api/ask/chats/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    await loadChats();
  }
  async function removeChat(id: string) {
    if (!window.confirm("Delete this chat?")) return;
    await fetch(`/api/ask/chats/${id}`, { method: "DELETE" }).catch(() => {});
    if (activeId === id) newChat();
    await loadChats();
  }
  function copy(m: Msg) { void navigator.clipboard?.writeText(m.content); setCopied(m.id); window.setTimeout(() => setCopied(null), 1400); }

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = chats.filter((c) => !q || c.title.toLowerCase().includes(q));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: { label: string; items: Chat[] }[] = [];
    const add = (label: string, items: Chat[]) => { if (items.length) out.push({ label, items }); };
    add("Pinned", list.filter((c) => c.pinned));
    const rest = list.filter((c) => !c.pinned);
    const age = (c: Chat) => Math.floor((start - new Date(c.updated_at).getTime()) / 86400000);
    add("Today", rest.filter((c) => new Date(c.updated_at).getTime() >= start));
    add("Yesterday", rest.filter((c) => { const a = age(c); return a >= 0 && a < 1 && new Date(c.updated_at).getTime() < start; }));
    add("Previous 7 days", rest.filter((c) => { const a = age(c); return a >= 1 && a < 7 && new Date(c.updated_at).getTime() < start - 86400000 + 1; }));
    add("Older", rest.filter((c) => age(c) >= 7));
    return out;
  }, [chats, filter, now]);

  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  const empty = messages.length === 0 && !loadingChat;

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <button type="button" onClick={newChat} className="mx-3 mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[0.92rem] font-medium hover:border-brand hover:text-brand"><MessageSquarePlus className="h-4 w-4" />New chat</button>
      <div className="relative mx-3 mt-3"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats" className="w-full rounded-md border border-line bg-field py-1.5 pl-8 pr-2 text-[0.85rem]" aria-label="Search chats" /></div>
      <nav className="nav-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Past chats">
        {groups.length === 0 && <p className="px-3 py-4 text-[0.85rem] text-muted">{chats.length === 0 ? "Your chats will be listed here." : "No chat matches."}</p>}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">{g.label}</p>
            {g.items.map((c) => (
              <div key={c.id} className={"group flex items-center gap-1 rounded-md px-2 py-1.5 " + (c.id === activeId ? "bg-brand-soft" : "hover:bg-surface")}>
                {editing === c.id ? (
                  <input autoFocus value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={80} className="min-w-0 flex-1 rounded border border-line bg-field px-1.5 py-0.5 text-[0.85rem]" aria-label="Chat name"
                    onKeyDown={(e) => { if (e.key === "Enter") { void patchChat(c.id, { title: draftTitle }); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                    onBlur={() => { if (draftTitle.trim() && draftTitle !== c.title) void patchChat(c.id, { title: draftTitle }); setEditing(null); }} />
                ) : (
                  <button type="button" onClick={() => void openChat(c.id)} className="min-w-0 flex-1 truncate text-left text-[0.88rem]" title={c.title}>{c.title}</button>
                )}
                {editing !== c.id && (
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => void patchChat(c.id, { pinned: !c.pinned })} className="rounded p-1 text-muted hover:text-ink" aria-label={c.pinned ? "Unpin" : "Pin"}>{c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
                    <button type="button" onClick={() => { setEditing(c.id); setDraftTitle(c.title); }} className="rounded p-1 text-muted hover:text-ink" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => void removeChat(c.id)} className="rounded p-1 text-muted hover:text-bad" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
      {spend && (
        <div className="border-t border-line px-4 py-3 text-[0.78rem] text-muted">
          <p>Today: <span className="num font-medium text-ink">${today.toFixed(2)}</span>{spend.cap != null ? <> of ${spend.cap} limit</> : null}</p>
          {spend.cap != null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (today / spend.cap) * 100)}%` }} /></div>}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[30rem] overflow-hidden rounded-lg border border-line bg-card">
      <aside className="hidden w-72 shrink-0 border-r border-line bg-card lg:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Chats">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-label="Close" />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs bg-card shadow-xl"><button type="button" onClick={() => setDrawer(false)} className="absolute right-2 top-2 rounded p-1 text-muted" aria-label="Close"><X className="h-4 w-4" /></button>{sidebar}</div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <button type="button" onClick={() => setDrawer(true)} className="rounded p-1.5 text-muted hover:text-ink lg:hidden" aria-label="Chats"><Menu className="h-5 w-5" /></button>
          <h1 className="min-w-0 flex-1 truncate font-display text-[1.02rem] font-bold">{chats.find((c) => c.id === activeId)?.title ?? "New chat"}</h1>
          {spend && chatCost > 0 && <span className="shrink-0 text-[0.78rem] text-muted">this chat {cents(chatCost)}</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" aria-live="polite">
          {loadingChat && <p className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" />Opening the chat…</p>}
          {empty && (
            <div className="mx-auto mt-6 max-w-2xl text-center sm:mt-14">
              <h2 className="font-display text-[1.6rem] font-extrabold tracking-[-0.02em]">How can I help?</h2>
              <p className="mt-1.5 text-[0.95rem] text-muted">Ask about stock, orders, money, mail or Tally. I look the answer up in your records and show where it came from. I only read: I cannot change anything.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-card px-3.5 py-1.5 text-[0.86rem] hover:border-brand hover:text-brand">{s}</button>)}
              </div>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-[0.95rem]">{m.content}</p></div>
            ) : (
              <div key={m.id} className="group/ans">
                {m.pending && !m.content && <p className="flex items-center gap-2 text-[0.92rem] text-muted"><Loader2 className="h-4 w-4 animate-spin" />{m.status ?? "Thinking"}…</p>}
                {m.pending && m.content && m.status && <p className="mb-1 flex items-center gap-2 text-[0.8rem] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{m.status}…</p>}
                {m.content && <Markdown text={m.content} refs={m.pending ? undefined : m.meta?.refs ?? []} />}
                {m.error && <p className="text-[0.92rem] text-bad">{m.error}</p>}
                {!m.pending && !m.error && m.meta && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[0.78rem] text-muted">
                      {m.meta.confidence === "not_found" && <Badge tone="warning">Nothing found</Badge>}
                      {m.meta.confidence === "partly" && <Badge tone="info">Partly answered</Badge>}
                      {(!m.meta.refs || m.meta.refs.length === 0) && m.meta.sources && m.meta.sources.length > 0 && <span>From: {m.meta.sources.join(" · ")}</span>}
                    </div>
                    {m.meta.refs && m.meta.refs.length > 0 && (
                      <div className="rounded-lg border border-line bg-surface/50 px-3 py-2">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted">Check it here</p>
                        <ol className="mt-1 space-y-1">
                          {m.meta.refs.map((r) => (
                            <li key={r.id} className="flex items-start gap-2 text-[0.82rem]">
                              <span className="mt-0.5 inline-flex h-[1.1rem] min-w-[1.1rem] shrink-0 items-center justify-center rounded-full bg-brand-soft px-1 text-[0.68rem] font-semibold text-brand">{r.n}</span>
                              <span className="min-w-0">
                                <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">{r.label}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a>
                                {r.note && <span className="block truncate text-muted" title={r.note}>{r.note}</span>}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {m.meta.used && m.meta.used.length > 0 && (
                      <details className="text-[0.78rem] text-muted"><summary className="inline-flex cursor-pointer items-center gap-1 hover:text-ink">Looked at <ChevronDown className="h-3 w-3" /></summary>
                        <ul className="mt-1 space-y-0.5 pl-1">{m.meta.used.map((u, i) => <li key={i}>{LOOKED[u.name] ?? u.name}{u.rows != null ? `: ${u.rows} row${u.rows === 1 ? "" : "s"}` : ""}</li>)}</ul>
                      </details>
                    )}
                  </div>
                )}
                {!m.pending && m.content && (
                  <div className="mt-1.5 flex items-center gap-0.5 text-muted">
                    <button type="button" onClick={() => copy(m)} className="rounded p-1.5 hover:bg-surface hover:text-ink" aria-label="Copy the answer">{copied === m.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}</button>
                    {!m.id.startsWith("pending-") && <>
                      <button type="button" onClick={() => void feedback(m, 1)} className={"rounded p-1.5 hover:bg-surface hover:text-ink " + (m.feedback === 1 ? "text-ok" : "")} aria-label="Good answer" aria-pressed={m.feedback === 1}><ThumbsUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void feedback(m, -1)} className={"rounded p-1.5 hover:bg-surface hover:text-ink " + (m.feedback === -1 ? "text-bad" : "")} aria-label="Not a good answer" aria-pressed={m.feedback === -1}><ThumbsDown className="h-4 w-4" /></button></>}
                    {m === lastAssistant && !busy && <button type="button" onClick={() => void send("", true)} className="rounded p-1.5 hover:bg-surface hover:text-ink" aria-label="Answer again"><RefreshCw className="h-4 w-4" /></button>}
                  </div>
                )}
                {m === lastAssistant && !busy && m.meta?.follow_ups && m.meta.follow_ups.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{m.meta.follow_ups.map((f) => <button key={f} type="button" onClick={() => void send(f)} className="rounded-full border border-line px-3 py-1 text-[0.82rem] hover:border-brand hover:text-brand">{f}</button>)}</div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-line px-4 py-3 sm:px-8">
          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="mx-auto max-w-3xl rounded-xl border border-line bg-field p-2 focus-within:border-brand">
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={600} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
              placeholder="Ask anything, e.g. Do we have 12 mm SA 516 Gr 70, 1500 × 6000?" aria-label="Your question"
              className="max-h-[200px] w-full resize-none bg-transparent px-2 py-1.5 text-[0.95rem] outline-none" />
            <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
              <label className="flex items-center gap-1.5 text-[0.78rem] text-muted"><span className="sr-only sm:not-sr-only">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value as ModelKey)} disabled={busy} className="rounded-md border border-line bg-card px-1.5 py-1 text-[0.82rem] text-ink" aria-label="Model" title={models.find((m) => m.value === model)?.hint}>
                  {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
              <label className="flex items-center gap-1.5 text-[0.78rem] text-muted"><span className="sr-only sm:not-sr-only">Look in</span>
                <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy} className="rounded-md border border-line bg-card px-1.5 py-1 text-[0.82rem] text-ink" aria-label="Look in">
                  {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
              <span className="hidden text-[0.74rem] text-muted md:inline">{models.find((m) => m.value === model)?.hint}</span>
              {busy
                ? <button type="button" onClick={() => abort.current?.abort()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface"><Square className="h-3.5 w-3.5" />Stop</button>
                : <button type="submit" disabled={text.trim().length < 2} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"><SendHorizonal className="h-4 w-4" />Ask</button>}
            </div>
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-[0.72rem] text-muted">Answers come from your records and can still be wrong. Check anything important. Enter sends, Shift+Enter adds a line.</p>
        </div>
      </section>
    </div>
  );
}
