"use client";

/* eslint-disable @next/next/no-img-element -- the attached picture is shown from the bytes in the page (a data address), which next/image cannot take */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Check, ChevronDown, Copy, Download, ExternalLink, FileSpreadsheet, FileText, Folder, FolderInput, FolderPlus, Loader2, Menu, MessageSquarePlus, Paperclip, Pencil, Pin, PinOff, ChevronRight, RefreshCw, Search, SendHorizonal, Square, ThumbsDown, ThumbsUp, Trash2, UploadCloud, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { ModelPrices } from "@/components/ModelPrices";
import { Markdown, type RefLink } from "./Markdown";

type ModelKey = string; // a model's API id (lib/ask/models.ts)
type Chat = { id: string; title: string; pinned: boolean; model: ModelKey; scope: string; origin?: string; project_id?: string | null; updated_at: string };
type Project = { id: string; name: string; instructions: string; chats: number; updated_at: string };
type Meta = { files?: string[]; sources?: string[]; refs?: RefLink[]; follow_ups?: string[]; confidence?: string; used?: { name: string; rows: number | null }[]; usd?: number; model?: string; auto?: { tier: number; picked: number; upgraded: boolean; reasons: string[] } };
type Msg = { id: string; role: "user" | "assistant"; content: string; feedback: number | null; meta: Meta | null; created_at?: string; pending?: boolean; status?: string; error?: string };

type Saved = { id: string; title: string; question: string; model: ModelKey; scope: string };
type Attached = { name: string; mime: string; data: string; size: number; image: boolean };

const IMAGES = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "heic", "heif"];
const SHEETS = ["xlsx", "xlsm", "csv", "tsv"];
const TEXTS = ["pdf", "docx", "pptx", "txt", "md", "markdown", "json", "xml", "html", "htm", "log", "yaml", "yml", "ini", "sql", "eml"];
const ACCEPT = [...IMAGES, ...SHEETS, ...TEXTS].map((e) => "." + e).join(",");
const OLD_KIND: Record<string, string> = { xls: "Excel (.xls)", doc: "Word (.doc)", ppt: "PowerPoint (.ppt)", rtf: "Rich Text (.rtf)", odt: "OpenDocument (.odt)", ods: "OpenDocument (.ods)" };
const FORMATS = "pictures, PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV and text files";
const MAX_FILES = 5, MAX_BYTES = 3_000_000; // the server's limits too (lib/ask/engine.ts)
const BIG_IMAGE = 900_000, LONGEST_SIDE = 2000;
// the question used when a file is sent with no words (the server uses the same)
const DEFAULT_FILE_QUESTION = "Read the attached file and tell me what it contains. Then check the important details against our records.";

// when something was asked: "5 hours ago" while it is recent, the date and time after that; the full date and time is always in the tooltip
const fullTime = (iso?: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
function agoText(iso: string | undefined | null, nowMs: number): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const s = Math.max(0, (nowMs - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return plural(Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86400) return plural(Math.floor(s / 3600), "hour");
  return fullTime(iso);
}
function agoShort(iso: string | undefined | null, nowMs: number): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const s = Math.max(0, (nowMs - Date.parse(iso)) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

const readB64 = (f: Blob) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onerror = () => no(new Error("read"));
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.readAsDataURL(f);
});

/** A large picture made smaller before it is sent (a phone photo is several MB, and the model reads no more detail than 2000 pixels give). Null when the browser cannot open it. */
async function shrinkImage(f: File): Promise<{ data: string; size: number } | null> {
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && f.size <= BIG_IMAGE) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob && blob.size < f.size ? { data: await readB64(blob), size: blob.size } : null;
  } catch { return null; }
}

const download = (name: string, body: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff", body], { type: type + ";charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const fileStem = (s: string) => (s.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "answer");

const clean = (c: string) => c.replace(/\s*\[r\d+\]/gi, "").replace(/\*\*|__|`/g, "").trim();
const csvCell = (v: string) => { const t = /^[=+@]/.test(v) || /^-[^\d.]/.test(v) ? "'" + v : v; return '"' + t.replace(/"/g, '""') + '"'; };
const absUrl = (u: string) => (u.startsWith("/") ? window.location.origin + u : u);

/** The tables of an answer as CSV (all tables, one after another). A last column holds the links to check each row, when the answer cites them. */
function tablesCsv(md: string, refs: RefLink[] = []): string | null {
  const by = new Map(refs.map((r) => [r.id, r]));
  const tables: string[][][] = []; let cur: string[][] = [];
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|")) {
      const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      cur.push(cells);
    } else if (cur.length) { tables.push(cur); cur = []; }
  }
  if (cur.length) tables.push(cur);
  if (tables.length === 0) return null;
  const hasRefs = refs.length > 0;
  return tables.map((t) => t.map((row, i) => {
    const links = hasRefs ? (i === 0 ? ["Check it here"] : [[...new Set([...row.join(" ").matchAll(/\[(r\d+)\]/gi)].map((m) => by.get(m[1].toLowerCase())?.url).filter(Boolean) as string[])].map(absUrl).join(" ")]) : [];
    return [...row.map(clean), ...links].map(csvCell).join(",");
  }).join("\r\n")).join("\r\n\r\n");
}

/** The whole chat as readable text, with the numbered sources under each answer. */
function chatText(title: string, ms: { role: string; content: string; meta: Meta | null }[]) {
  const out = [`# ${title}`, ""];
  for (const m of ms) {
    if (m.role === "user") { out.push(`You: ${m.content}`, ""); continue; }
    const refs = m.meta?.refs ?? [];
    const n = new Map(refs.map((r) => [r.id, r.n]));
    out.push(m.content.replace(/\[(r\d+)\]/gi, (_x, id: string) => (n.has(id.toLowerCase()) ? `[${n.get(id.toLowerCase())}]` : "")), "");
    if (refs.length) { out.push("Sources:"); for (const r of refs) out.push(`  [${r.n}] ${r.label} - ${absUrl(r.url)}`); out.push(""); }
  }
  return out.join("\n");
}

export type AskAppProps = {
  mode?: "brain" | "stock"; // "stock" = the Stock check page: looks only in the stock, lists only its own chats
  canAttach: boolean;
  initialChat?: string | null;
  initialQuestion?: string | null; // typed into the box (not sent) when the page is opened from a suggestion elsewhere
  suggestions: string[];
  scopes: { value: string; label: string }[];
  models: { value: ModelKey; label: string; hint: string; provider: "anthropic" | "openai"; ready: boolean }[];
  defaultModel: ModelKey;
  roles: Record<string, string>; // model key -> where it is used ("default", "AI mode", "Think harder")
  spend: { spent: number; cap: number | null } | null;
};

const LOOKED: Record<string, string> = {
  stock_check: "Stock check", stock_summary: "Stock totals", plate_lookup: "Plate lookup", overview: "Overview", orders_search: "Orders", order_detail: "Order lines", dispatch_search: "Vehicle register",
  receivables: "Receivables", payables: "Payables", invoices_search: "Invoices", payments_search: "Payments", leads_mail_quotes: "Mail and leads", invoice_trail: "Invoice paperwork",
  tally_voucher: "Tally vouchers", tally_party: "Tally party", documents_search: "Documents", drafts_search: "Drafts", count_status: "Stock counts", sheet_search: "Sheets",
};

const cents = (usd: number) => (usd < 0.01 ? "under 1 cent" : `${Math.round(usd * 100)} cents`);

export function AskApp({ mode = "brain", canAttach, initialChat, initialQuestion, suggestions, scopes, models, defaultModel, roles, spend }: AskAppProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatCost, setChatCost] = useState(0);
  const [loadingChat, setLoadingChat] = useState(false);
  const [text, setText] = useState(initialQuestion ?? "");
  const [model, setModel] = useState<ModelKey>(defaultModel);
  const stockMode = mode === "stock";
  const [scope, setScope] = useState(stockMode ? "stock" : "all");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [today, setToday] = useState(spend?.spent ?? 0);
  const [now] = useState(() => new Date());
  const [nowMs, setNowMs] = useState(() => Date.now()); // the "5 hours ago" labels move on by themselves
  useEffect(() => { const id = window.setInterval(() => setNowMs(Date.now()), 60_000); return () => window.clearInterval(id); }, []);
  // the chats column folds to a strip of icons and opens when pointed at, like the main menu; the choice is remembered
  const [railOpen, setRailOpen] = useState(true);
  const [railHover, setRailHover] = useState(false);
  const railLeave = useRef<number | null>(null);
  const railEl = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!railHover) return;
    const move = (e: MouseEvent) => { if (railEl.current && !railEl.current.contains(e.target as Node)) setRailHover(false); };
    const out = () => setRailHover(false);
    window.addEventListener("mousemove", move);
    document.documentElement.addEventListener("mouseleave", out);
    window.addEventListener("blur", out);
    return () => { window.removeEventListener("mousemove", move); document.documentElement.removeEventListener("mouseleave", out); window.removeEventListener("blur", out); };
  }, [railHover]);
  useEffect(() => {
    try { const v = window.localStorage.getItem("brain-rail-open"); setRailOpen(v === null ? window.innerWidth >= 1536 : v === "1"); } catch { setRailOpen(window.innerWidth >= 1536); }
  }, []);
  const toggleRail = () => { const next = !railOpen; setRailOpen(next); setRailHover(false); try { window.localStorage.setItem("brain-rail-open", next ? "1" : "0"); } catch { /* not remembered */ } };
  const compact = !railOpen && !railHover;
  const [files, setFiles] = useState<Attached[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [newIn, setNewIn] = useState<string | null>(null); // the project a new chat will start in
  const [pform, setPform] = useState<{ id: string | null; name: string; instructions: string } | null>(null);
  const [pbusy, setPbusy] = useState(false);
  const [perr, setPerr] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const loadChats = useCallback(async () => {
    try { const r = await fetch("/api/ask/chats", { cache: "no-store" }); if (r.ok) setChats(((await r.json()) as Chat[]).filter((c) => !stockMode || c.scope === "stock")); } catch { /* the list stays as it was */ }
  }, []);
  const loadProjects = useCallback(async () => {
    try { const r = await fetch("/api/ask/projects", { cache: "no-store" }); if (r.ok) setProjects((await r.json()) as Project[]); } catch { /* the list stays as it was */ }
  }, []);
  useEffect(() => { void loadChats(); void loadProjects(); }, [loadChats, loadProjects]);
  useEffect(() => { if (!pform) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setPform(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [pform]);
  // a chat opened from AI mode ("Continue in Digital Brain")
  const opened = useRef(false);
  const opening = useRef(0);
  useEffect(() => { if (initialChat && !opened.current) { opened.current = true; void openChat(initialChat); } }, [initialChat]); // eslint-disable-line react-hooks/exhaustive-deps
  // searching inside the words of past questions and answers, not only their titles
  const [inside, setInside] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = filter.trim();
    if (t.length < 3) { setInside(new Set()); return; }
    const id = window.setTimeout(async () => {
      try { const r = await fetch(`/api/ask/chats?q=${encodeURIComponent(t)}`, { cache: "no-store" }); if (r.ok) setInside(new Set(((await r.json()) as Chat[]).map((c) => c.id))); } catch { /* titles only */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, [filter]);
  const loadSaved = useCallback(async () => {
    try { const r = await fetch("/api/ask/saved", { cache: "no-store" }); if (r.ok) setSaved((await r.json()) as Saved[]); } catch { /* the list stays as it was */ }
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, [menu]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages]);
  useEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; } }, [text]);

  async function openChat(id: string) {
    if (busy) return;
    const mine = ++opening.current; // only the chat opened last may fill the screen
    // the chat that was on screen goes away at once: never show its answers under another chat's title while this one loads
    setDrawer(false); setLoadingChat(true); setActiveId(id); setNewIn(null); setFiles([]); setFileNote(null); setMessages([]); setChatCost(0);
    try {
      const r = await fetch(`/api/ask/chats/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { chat: Chat; messages: Msg[]; usd: number };
      if (mine !== opening.current) return;
      setMessages(j.messages.map((m) => ({ ...m, meta: m.meta ?? null })));
      setModel(models.some((x) => x.value === j.chat.model) ? j.chat.model : defaultModel); setScope(stockMode ? "stock" : j.chat.scope); setChatCost(j.usd);
    } catch { if (mine === opening.current) setMessages([]); }
    if (mine === opening.current) setLoadingChat(false);
  }
  function newChatIn(projectId: string | null) { if (busy) return; setNewIn(projectId); if (projectId) setOpenProjects((s) => new Set(s).add(projectId)); setActiveId(null); setMessages([]); setChatCost(0); setFiles([]); setFileNote(null); setDrawer(false); box.current?.focus(); }
  function newChat() { if (busy) return; setNewIn(null); setActiveId(null); setMessages([]); setChatCost(0); setFiles([]); setFileNote(null); setDrawer(false); box.current?.focus(); }

  async function send(question: string, regenerate = false) {
    const typed = question.trim();
    const sendFiles = files; // the files stay on the chat: each follow-up question is answered with them until they are removed
    if ((!regenerate && typed.length < 2 && sendFiles.length === 0) || busy) return;
    const qn = typed.length >= 2 ? typed : sendFiles.length ? DEFAULT_FILE_QUESTION : typed;
    const aId = "pending-" + Math.random().toString(36).slice(2);
    setMessages((ms) => {
      const base = regenerate ? (ms.at(-1)?.role === "assistant" ? ms.slice(0, -1) : ms) : [...ms, { id: "u-" + aId, role: "user" as const, content: qn, feedback: null, created_at: new Date().toISOString(), meta: sendFiles.length ? { files: sendFiles.map((f) => f.name) } : null }];
      return [...base, { id: aId, role: "assistant", content: "", feedback: null, created_at: new Date().toISOString(), meta: null, pending: true, status: "Thinking" }];
    });
    setText(""); setFileNote(null); setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    const patch = (p: Partial<Msg>) => setMessages((ms) => ms.map((m) => (m.id === aId || (p.id && m.id === aId) ? { ...m, ...p } : m)));
    let realId = aId;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ question: typed, chatId: activeId, projectId: activeId ? undefined : newIn ?? undefined, model, scope, regenerate, files: sendFiles.length ? sendFiles.map((f) => ({ name: f.name, mime: f.mime, data: f.data })) : undefined }) });
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
          const e = JSON.parse(line) as { type: string; text?: string; chatId?: string; messageId?: string; error?: string; result?: { answer: string; sources: string[]; refs?: RefLink[]; follow_ups: string[]; confidence: string; used: { name: string; rows: number | null }[]; usd: number; model: string; auto?: { tier: number; picked: number; upgraded: boolean; reasons: string[] } } };
          if (e.type === "meta" && e.chatId) { setActiveId(e.chatId); void loadChats(); void loadProjects(); }
          else if (e.type === "status") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, status: e.text } : m)));
          else if (e.type === "delta") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, content: m.content + (e.text ?? ""), status: undefined } : m)));
          else if (e.type === "reset") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, content: "" } : m)));
          else if (e.type === "saved" && e.messageId) { const old = realId; realId = e.messageId; setMessages((ms) => ms.map((m) => (m.id === old ? { ...m, id: e.messageId! } : m))); }
          else if (e.type === "done" && e.result) {
            const r = e.result;
            setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, content: r.answer, pending: false, status: undefined, meta: { sources: r.sources, refs: r.refs, follow_ups: r.follow_ups, confidence: r.confidence, used: r.used, usd: r.usd, model: r.model, auto: r.auto } } : m)));
            setChatCost((c) => c + r.usd); setToday((t) => t + r.usd);
          } else if (e.type === "error") setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, pending: false, status: undefined, error: e.error } : m)));
        }
      }
      setMessages((ms) => ms.map((m) => (m.id === realId && m.pending ? { ...m, pending: false, status: undefined } : m)));
    } catch (err) {
      const stopped = err instanceof DOMException && err.name === "AbortError";
      setMessages((ms) => ms.map((m) => (m.id === realId ? { ...m, pending: false, status: undefined, error: stopped ? undefined : "The connection dropped. Please try again.", content: m.content || (stopped ? "Stopped." : "") } : m)));
    } finally {
      setBusy(false); abort.current = null; void loadChats(); void loadProjects();
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
  async function saveProject() {
    if (!pform || pbusy) return;
    setPbusy(true); setPerr(null);
    try {
      const r = await fetch(pform.id ? `/api/ask/projects/${pform.id}` : "/api/ask/projects", { method: pform.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: pform.name, instructions: pform.instructions }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok) { setPerr(j.error ?? "The project could not be saved."); setPbusy(false); return; }
      await loadProjects();
      if (!pform.id && j.id) { setOpenProjects((s) => new Set(s).add(j.id!)); if (!activeId) setNewIn(j.id); } // a new project becomes the place for the next new chat
      setPform(null);
    } catch { setPerr("The project could not be saved."); }
    setPbusy(false);
  }
  async function removeProject(id: string) {
    if (!window.confirm("Delete this project? Its chats are kept and move back to the plain list.")) return;
    await fetch(`/api/ask/projects/${id}`, { method: "DELETE" }).catch(() => {});
    if (newIn === id) setNewIn(null);
    setPform(null);
    await Promise.all([loadProjects(), loadChats()]);
  }
  async function moveChat(chatId: string, projectId: string | null) {
    setMenu(null);
    await patchChat(chatId, { projectId });
    if (projectId) setOpenProjects((s) => new Set(s).add(projectId));
    await loadProjects();
  }
  async function attach(list: FileList | File[] | null) {
    if (!list || !canAttach) return;
    setFileNote(null); setReading(true);
    const next = [...files];
    const notes: string[] = [];
    let pasted = 0;
    for (const f of Array.from(list)) {
      const name = f.name && f.name !== "image.png" ? f.name : `pasted-image-${++pasted}.png`; // a screenshot pasted from the clipboard has no name of its own
      const ext = extOf(name);
      const image = IMAGES.includes(ext);
      if (OLD_KIND[ext]) { notes.push(`"${name}" is an old ${OLD_KIND[ext]} file. Save it as ${ext === "xls" || ext === "ods" ? ".xlsx or CSV" : ext === "ppt" ? ".pptx or PDF" : ".docx or PDF"} and attach that.`); continue; }
      if (!image && !SHEETS.includes(ext) && !TEXTS.includes(ext)) { notes.push(`"${name}" cannot be attached. You can attach ${FORMATS}.`); continue; }
      if (next.some((x) => x.name === name && x.size === f.size)) continue;
      if (next.length >= MAX_FILES) { notes.push(`Up to ${MAX_FILES} files at a time.`); break; }
      try {
        let data: string, size = f.size, outName = name, mime = f.type || "application/octet-stream";
        const small = image ? await shrinkImage(f) : null;
        if (small) { data = small.data; size = small.size; outName = name.replace(/\.[^.]+$/, "") + ".jpg"; mime = "image/jpeg"; } else data = await readB64(f);
        if (next.reduce((n, x) => n + x.size, 0) + size > MAX_BYTES) { notes.push(`"${name}" is too large: the files together can be ${MAX_BYTES / 1_000_000} MB at most${image ? "" : ". For a big spreadsheet, attach only the sheet you need as CSV"}.`); continue; }
        next.push({ name: outName, mime, size, data, image: image && mime.startsWith("image/") });
      } catch { notes.push(`"${name}" could not be read.`); }
    }
    setFiles(next);
    setReading(false);
    if (notes.length) setFileNote(notes.join(" "));
    if (picker.current) picker.current.value = "";
  }

  // Dropping files anywhere on the page attaches them (and a file dropped outside the box would otherwise open in the browser, away from the chat)
  const attachRef = useRef(attach); attachRef.current = attach;
  const dropOk = useRef(false); dropOk.current = canAttach && !busy;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = dropOk.current ? "copy" : "none"; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      if (dropOk.current) void attachRef.current(e.dataTransfer?.files ?? null);
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, []);

  async function saveQuestion(m: Msg) {
    const title = window.prompt("Name for this saved question", m.content.slice(0, 60));
    if (title === null) return;
    const r = await fetch("/api/ask/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, question: m.content, model, scope }) });
    if (!r.ok) window.alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "It could not be saved.");
    await loadSaved();
  }
  async function removeSaved(id: string) {
    await fetch(`/api/ask/saved/${id}`, { method: "DELETE" }).catch(() => {});
    await loadSaved();
  }
  function runSaved(s: Saved) { if (busy) return; setModel(s.model); setScope(stockMode ? "stock" : s.scope); setDrawer(false); void send(s.question); }

  const questionFor = (m: Msg) => { const i = messages.findIndex((x) => x.id === m.id); return messages.slice(0, i).findLast((x) => x.role === "user")?.content ?? ""; };
  function exportCsv(m: Msg) { const csv = tablesCsv(m.content, m.meta?.refs); if (csv) download(`${fileStem(questionFor(m))}.csv`, csv, "text/csv"); }
  function exportText(m: Msg) { download(`${fileStem(questionFor(m))}.txt`, chatText(questionFor(m), [{ role: "user", content: questionFor(m), meta: null }, m]), "text/plain"); }
  function exportChat() { const title = chats.find((c) => c.id === activeId)?.title ?? "Ask chat"; download(`${fileStem(title)}.txt`, chatText(title, messages.filter((x) => !x.pending)), "text/plain"); }
  function printAnswer(m: Msg) {
    const el = document.querySelector(`[data-answer="${m.id}"]`);
    if (!el) return;
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll(".no-print").forEach((n) => n.remove());
    const w = window.open("", "_blank");
    if (!w) { window.alert("Allow pop-ups for this site to print or save as PDF."); return; }
    const q = document.createElement("p"); q.className = "q"; q.textContent = questionFor(m);
    const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date());
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${window.location.origin}/"><title>${fileStem(questionFor(m))}</title><style>
      body{font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:28px}h1{font-size:15px;margin:0 0 2px}.q{font-size:16px;font-weight:600;margin:10px 0 14px}.foot{margin-top:18px;font-size:11px;color:#666}
      table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #bbb;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1}a{color:#0b5cad}ol{padding-left:18px}
      details{display:none}</style></head><body><h1>Sambhav Pipes &amp; Fittings: from the Ask box</h1><div>${when}</div>${q.outerHTML}${c.innerHTML}<p class="foot">Answers come from the company's records and can still be wrong: check the linked sources.</p></body></html>`);
    w.document.close(); w.focus(); window.setTimeout(() => w.print(), 400);
  }

  function copy(m: Msg) { void navigator.clipboard?.writeText(m.content); setCopied(m.id); window.setTimeout(() => setCopied(null), 1400); }

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = chats.filter((c) => !q || c.title.toLowerCase().includes(q) || inside.has(c.id));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: { label: string; items: Chat[] }[] = [];
    const add = (label: string, items: Chat[]) => { if (items.length) out.push({ label, items }); };
    add("Pinned", list.filter((c) => c.pinned));
    const rest = list.filter((c) => !c.pinned && !c.project_id);
    const age = (c: Chat) => Math.floor((start - new Date(c.updated_at).getTime()) / 86400000);
    add("Today", rest.filter((c) => new Date(c.updated_at).getTime() >= start));
    add("Yesterday", rest.filter((c) => { const a = age(c); return a >= 0 && a < 1 && new Date(c.updated_at).getTime() < start; }));
    add("Previous 7 days", rest.filter((c) => { const a = age(c); return a >= 1 && a < 7 && new Date(c.updated_at).getTime() < start - 86400000 + 1; }));
    add("Older", rest.filter((c) => age(c) >= 7));
    return out;
  }, [chats, filter, now, inside]);

  const filtering = filter.trim().length > 0;
  const projectGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return projects.map((p) => ({ p, items: chats.filter((c) => c.project_id === p.id && !c.pinned && (!q || c.title.toLowerCase().includes(q) || inside.has(c.id))) })).filter((g) => !q || g.items.length > 0);
  }, [projects, chats, filter, inside]);
  const activeChat = chats.find((c) => c.id === activeId);
  const currentProject = projects.find((p) => p.id === (activeId ? activeChat?.project_id : newIn)) ?? null;
  const projectName = (id?: string | null) => (id ? projects.find((p) => p.id === id)?.name : undefined);

  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  const empty = messages.length === 0 && !loadingChat;

  const chatRow = (c: Chat) => (
    <div key={c.id} className={"group relative flex items-center gap-1 rounded-md px-2 py-1.5 " + (c.id === activeId ? "bg-brand-soft" : "hover:bg-surface")}>
      {editing === c.id ? (
        <input autoFocus value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={80} className="min-w-0 flex-1 rounded border border-line bg-field px-1.5 py-0.5 text-[0.85rem]" aria-label="Chat name"
          onKeyDown={(e) => { if (e.key === "Enter") { void patchChat(c.id, { title: draftTitle }); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
          onBlur={() => { if (draftTitle.trim() && draftTitle !== c.title) void patchChat(c.id, { title: draftTitle }); setEditing(null); }} />
      ) : (
        <button type="button" onClick={() => void openChat(c.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[0.88rem]" title={`${c.title}\n${fullTime(c.updated_at)} (${agoText(c.updated_at, nowMs) || ""})`}>
          {c.pinned && <Pin className="h-3 w-3 shrink-0 text-brand" aria-label="Pinned" />}
          {c.origin === "ai_mode" && <span className="shrink-0 rounded bg-brand-soft px-1 text-[0.62rem] font-semibold uppercase text-brand">AI</span>}
          <span className="truncate">{c.title}</span>
          <span className="ml-auto shrink-0 pl-1 text-[0.68rem] text-muted">{agoShort(c.updated_at, nowMs)}</span>
          {c.pinned && projectName(c.project_id) && <span className="ml-auto max-w-[5rem] shrink-0 truncate rounded bg-surface px-1 text-[0.62rem] text-muted" title={"In the project " + projectName(c.project_id)}>{projectName(c.project_id)}</span>}
        </button>
      )}
      {editing !== c.id && (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={() => void patchChat(c.id, { pinned: !c.pinned })} className="rounded p-1 text-muted hover:text-ink" aria-label={c.pinned ? "Unpin" : "Pin"} title={c.pinned ? "Unpin" : "Pin to the top"}>{c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setMenu(menu === "move:" + c.id ? null : "move:" + c.id); }} className="rounded p-1 text-muted hover:text-ink" aria-label="Move to a project" title="Move to a project" aria-haspopup="menu" aria-expanded={menu === "move:" + c.id}><FolderInput className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => { setEditing(c.id); setDraftTitle(c.title); }} className="rounded p-1 text-muted hover:text-ink" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => void removeChat(c.id)} className="rounded p-1 text-muted hover:text-bad" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </span>
      )}
      {menu === "move:" + c.id && (
        <div role="menu" className="absolute right-1 top-full z-30 mt-1 w-52 rounded-lg border border-line bg-card py-1 text-[0.84rem] shadow-lg" onClick={(e) => e.stopPropagation()}>
          <p className="px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">Move to a project</p>
          {projects.map((p) => (
            <button key={p.id} type="button" role="menuitem" onClick={() => void moveChat(c.id, p.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface"><Folder className="h-3.5 w-3.5 shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{p.name}</span>{c.project_id === p.id && <Check className="h-3.5 w-3.5 text-brand" />}</button>
          ))}
          {projects.length === 0 && <p className="px-3 py-1.5 text-muted">No projects yet.</p>}
          {c.project_id && <button type="button" role="menuitem" onClick={() => void moveChat(c.id, null)} className="block w-full border-t border-line px-3 py-1.5 text-left hover:bg-surface">Take out of the project</button>}
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setPerr(null); setPform({ id: null, name: "", instructions: "" }); }} className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left text-brand hover:bg-surface"><FolderPlus className="h-3.5 w-3.5" />New project…</button>
        </div>
      )}
    </div>
  );

  const renderSidebar = (desktop: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      {desktop && (
        <div className="flex items-center gap-2 px-3 pt-3">
          <button type="button" onClick={toggleRail} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink" aria-label={railOpen ? "Fold the chat list" : "Keep the chat list open"} title={railOpen ? "Fold the chat list" : "Keep the chat list open"} aria-expanded={railOpen}><Menu className="h-5 w-5" /></button>
          <span className="text-[0.74rem] font-semibold uppercase tracking-[0.12em] text-muted">Chats</span>
        </div>
      )}
      <button type="button" onClick={newChat} className="mx-3 mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[0.92rem] font-medium hover:border-brand hover:text-brand"><MessageSquarePlus className="h-4 w-4" />New chat</button>
      <div className="relative mx-3 mt-3"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats" className="w-full rounded-md border border-line bg-field py-1.5 pl-8 pr-2 text-[0.85rem]" aria-label="Search chats" /></div>
      {saved.length > 0 && (
        <div className="mx-3 mt-3 rounded-lg border border-line">
          <p className="flex items-center gap-1.5 px-2.5 pt-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted"><Bookmark className="h-3 w-3" />Saved questions</p>
          <ul className="max-h-36 overflow-y-auto px-1 pb-1.5 pt-1">
            {saved.map((q) => (
              <li key={q.id} className="group/sv flex items-center gap-1 rounded px-1.5 py-1 hover:bg-surface">
                <button type="button" onClick={() => runSaved(q)} disabled={busy} className="min-w-0 flex-1 truncate text-left text-[0.84rem] disabled:opacity-50" title={q.question}>{q.title}</button>
                <button type="button" onClick={() => void removeSaved(q.id)} className="shrink-0 rounded p-0.5 text-muted opacity-0 hover:text-bad group-hover/sv:opacity-100 focus:opacity-100" aria-label={`Remove saved question ${q.title}`}><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <nav className="nav-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Past chats">
        <div className="mb-3">
          <div className="flex items-center justify-between px-2 pb-1">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">Projects</p>
            <button type="button" onClick={() => { setPerr(null); setPform({ id: null, name: "", instructions: "" }); }} className="rounded p-1 text-muted hover:bg-surface hover:text-ink" aria-label="New project" title="New project"><FolderPlus className="h-3.5 w-3.5" /></button>
          </div>
          {projects.length === 0 && !filtering && <p className="px-2 pb-1 text-[0.78rem] leading-snug text-muted">A project keeps related chats together and gives them standing instructions.</p>}
          {projectGroups.map(({ p, items }) => {
            const open = openProjects.has(p.id) || filtering;
            const here = !activeId && newIn === p.id;
            return (
              <div key={p.id}>
                <div className={"group/pr flex items-center gap-1 rounded-md px-2 py-1.5 " + (here ? "bg-brand-soft" : "hover:bg-surface")}>
                  <button type="button" onClick={() => setOpenProjects((s0) => { const n = new Set(s0); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[0.88rem] font-medium" title={p.instructions ? p.name + ": " + p.instructions : p.name}>
                    <ChevronRight className={"h-3.5 w-3.5 shrink-0 text-muted transition-transform " + (open ? "rotate-90" : "")} /><Folder className="h-3.5 w-3.5 shrink-0 text-brand" /><span className="truncate">{p.name}</span><span className="shrink-0 text-[0.72rem] font-normal text-muted">{p.chats}</span>
                  </button>
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/pr:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => newChatIn(p.id)} className="rounded p-1 text-muted hover:text-ink" aria-label={`New chat in ${p.name}`} title="New chat in this project"><MessageSquarePlus className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => { setPerr(null); setPform({ id: p.id, name: p.name, instructions: p.instructions }); }} className="rounded p-1 text-muted hover:text-ink" aria-label={`Edit ${p.name}`} title="Name and instructions"><Pencil className="h-3.5 w-3.5" /></button>
                  </span>
                </div>
                {open && (
                  <div className="ml-3 border-l border-line pl-1">
                    {items.map(chatRow)}
                    {items.length === 0 && <p className="px-2 py-1.5 text-[0.78rem] text-muted">{filtering ? "No chat matches." : "No chats yet. Use the new-chat button on the project to start one."}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {groups.length === 0 && projectGroups.length === 0 && <p className="px-3 py-4 text-[0.85rem] text-muted">{chats.length === 0 ? "Your chats will be listed here." : "No chat matches."}</p>}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">{g.label}</p>
            {g.items.map(chatRow)}
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
      <div className="relative hidden shrink-0 transition-[width] duration-200 lg:block" style={{ width: railOpen ? "17rem" : "3.25rem" }}>
        <aside
          ref={railEl}
          onMouseEnter={() => { if (railLeave.current) window.clearTimeout(railLeave.current); if (!railOpen) setRailHover(true); }}
          onMouseLeave={() => { railLeave.current = window.setTimeout(() => setRailHover(false), 160); }}
          className={"absolute inset-y-0 left-0 z-20 border-r border-line bg-card transition-[width] duration-200 " + (compact ? "w-[3.25rem]" : "w-[17rem]") + (!railOpen && railHover ? " shadow-xl" : "")}
        >
          {compact ? (
            <div className="flex h-full flex-col items-center gap-1 py-3">
              <button type="button" onClick={toggleRail} className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink" aria-label="Keep the chat list open" title="Keep the chat list open"><Menu className="h-5 w-5" /></button>
              <button type="button" onClick={newChat} className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink" aria-label="New chat" title="New chat"><MessageSquarePlus className="h-5 w-5" /></button>
              <button type="button" onClick={() => setRailHover(true)} className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink" aria-label="Past chats" title="Past chats"><Search className="h-5 w-5" /></button>
            </div>
          ) : renderSidebar(true)}
        </aside>
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Chats">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-label="Close" />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs bg-card shadow-xl"><button type="button" onClick={() => setDrawer(false)} className="absolute right-2 top-2 rounded p-1 text-muted" aria-label="Close"><X className="h-4 w-4" /></button>{renderSidebar(false)}</div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <button type="button" onClick={() => setDrawer(true)} className="rounded p-1.5 text-muted hover:text-ink lg:hidden" aria-label="Chats"><Menu className="h-5 w-5" /></button>
          <h1 className="min-w-0 flex-1 truncate font-display text-[1.02rem] font-bold">{activeChat?.title ?? "New chat"}</h1>
          {currentProject && (
            <span className="inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[0.74rem] font-medium text-brand" title={currentProject.instructions ? "Project instructions: " + currentProject.instructions : "This project has no instructions yet"}>
              <Folder className="h-3 w-3 shrink-0" /><span className="truncate">{currentProject.name}</span>
              {!activeId && <button type="button" onClick={() => setNewIn(null)} className="rounded hover:text-bad" aria-label="Start this chat outside the project"><X className="h-3 w-3" /></button>}
            </span>
          )}
          {activeChat && <button type="button" onClick={() => void patchChat(activeChat.id, { pinned: !activeChat.pinned })} className={"shrink-0 rounded p-1.5 hover:bg-surface " + (activeChat.pinned ? "text-brand" : "text-muted hover:text-ink")} aria-label={activeChat.pinned ? "Unpin this chat" : "Pin this chat to the top of the list"} title={activeChat.pinned ? "Unpin this chat" : "Pin this chat"} aria-pressed={activeChat.pinned}>{activeChat.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button>}
          {spend && chatCost > 0 && <span className="shrink-0 text-[0.78rem] text-muted">this chat {cents(chatCost)}</span>}
          {messages.some((m) => !m.pending && m.content) && <button type="button" onClick={exportChat} className="shrink-0 rounded p-1.5 text-muted hover:text-ink" aria-label="Download this chat as text" title="Download this chat"><Download className="h-4 w-4" /></button>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 2xl:px-10" aria-live="polite">
          {loadingChat && <p className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" />Opening the chat…</p>}
          {empty && (
            <div className="mx-auto mt-6 max-w-2xl text-center sm:mt-14">
              <h2 className="font-display text-[1.6rem] font-extrabold tracking-[-0.02em]">{stockMode ? "Stock check" : "Digital Brain"}</h2>
              <p className="mt-1.5 text-[0.95rem] text-muted">{stockMode
                ? "Do we have this plate? Type the grade, thickness and size, or drop a photo or file of the enquiry. I check the stock and show the plates behind the answer. Nothing is reserved."
                : "Ask anything about stock, orders, money, mail or Tally. I look the answer up in your records and show where it came from. I only read: I cannot change anything."}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {saved.slice(0, 4).map((q) => <button key={q.id} type="button" onClick={() => runSaved(q)} className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3.5 py-1.5 text-[0.86rem] hover:border-brand hover:text-brand" title={q.question}><Bookmark className="h-3 w-3" />{q.title}</button>)}
                {suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-card px-3.5 py-1.5 text-[0.86rem] hover:border-brand hover:text-brand">{s}</button>)}
              </div>
            </div>
          )}
          <div className="mx-auto max-w-4xl space-y-5 2xl:space-y-6">
            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="group/q flex items-start justify-end gap-1">
                {<button type="button" onClick={() => void saveQuestion(m)} className="mt-2 rounded p-1 text-muted opacity-0 hover:text-brand focus:opacity-100 group-hover/q:opacity-100" aria-label="Save this question" title="Save this question"><BookmarkPlus className="h-4 w-4" /></button>}
                <div className="max-w-[85%]">
                  {m.meta?.files && m.meta.files.length > 0 && <div className="mb-1 flex flex-wrap justify-end gap-1.5">{m.meta.files.map((f, i) => <span key={i} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[0.76rem] text-muted"><FileText className="h-3 w-3" />{f}</span>)}</div>}
                  <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-soft px-4 py-2 text-[0.9rem] 2xl:py-2.5 2xl:text-[0.95rem]">{m.content}</p>
                  {m.created_at && <p className="mt-0.5 text-right text-[0.72rem] text-muted" title={fullTime(m.created_at)}>{agoText(m.created_at, nowMs)}</p>}
                </div>
              </div>
            ) : (
              <div key={m.id} className="group/ans" data-answer={m.id}>
                {m.pending && !m.content && <p className="no-print flex items-center gap-2 text-[0.92rem] text-muted"><Loader2 className="h-4 w-4 animate-spin" />{m.status ?? "Thinking"}…</p>}
                {m.pending && m.content && m.status && <p className="no-print mb-1 flex items-center gap-2 text-[0.8rem] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{m.status}…</p>}
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
                    {m.meta.auto && (
                      <p className="text-[0.78rem] text-muted" title={m.meta.auto.reasons.length ? m.meta.auto.reasons.join("; ") : undefined}>
                        Auto used {models.find((x) => x.value === m.meta?.model)?.label.replace(/ \(.*\)$/, "") ?? m.meta.model}
                        {m.meta.auto.upgraded ? " after the first try did not work out" : ` for ${m.meta.auto.tier >= 3 ? "a hard question" : m.meta.auto.tier === 2 ? "a question needing care" : "a simple question"}`}.
                      </p>
                    )}
                    {m.meta.used && m.meta.used.length > 0 && (
                      <details className="text-[0.78rem] text-muted"><summary className="inline-flex cursor-pointer items-center gap-1 hover:text-ink">Looked at <ChevronDown className="h-3 w-3" /></summary>
                        <ul className="mt-1 space-y-0.5 pl-1">{m.meta.used.map((u, i) => <li key={i}>{LOOKED[u.name] ?? u.name}{u.rows != null ? `: ${u.rows} row${u.rows === 1 ? "" : "s"}` : ""}</li>)}</ul>
                      </details>
                    )}
                  </div>
                )}
                {!m.pending && m.content && (
                  <div className="no-print mt-1.5 flex items-center gap-0.5 text-muted">
                    <button type="button" onClick={() => copy(m)} className="rounded p-1.5 hover:bg-surface hover:text-ink" aria-label="Copy the answer">{copied === m.id ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}</button>
                    {!m.id.startsWith("pending-") && <>
                      <button type="button" onClick={() => void feedback(m, 1)} className={"rounded p-1.5 hover:bg-surface hover:text-ink " + (m.feedback === 1 ? "text-ok" : "")} aria-label="Good answer" aria-pressed={m.feedback === 1}><ThumbsUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void feedback(m, -1)} className={"rounded p-1.5 hover:bg-surface hover:text-ink " + (m.feedback === -1 ? "text-bad" : "")} aria-label="Not a good answer" aria-pressed={m.feedback === -1}><ThumbsDown className="h-4 w-4" /></button></>}
                    <span className="relative">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setMenu(menu === m.id ? null : m.id); }} className="rounded p-1.5 hover:bg-surface hover:text-ink" aria-label="Download or print this answer" aria-expanded={menu === m.id}><Download className="h-4 w-4" /></button>
                      {menu === m.id && (
                        <div className="absolute bottom-full left-0 z-20 mb-1 w-52 rounded-lg border border-line bg-card py-1 text-[0.84rem] text-ink shadow-lg" role="menu" onClick={(e) => e.stopPropagation()}>
                          {/^\s*\|/m.test(m.content) && <button type="button" role="menuitem" onClick={() => { exportCsv(m); setMenu(null); }} className="block w-full px-3 py-1.5 text-left hover:bg-surface">Table as CSV (Excel)</button>}
                          <button type="button" role="menuitem" onClick={() => { printAnswer(m); setMenu(null); }} className="block w-full px-3 py-1.5 text-left hover:bg-surface">Print or save as PDF</button>
                          <button type="button" role="menuitem" onClick={() => { exportText(m); setMenu(null); }} className="block w-full px-3 py-1.5 text-left hover:bg-surface">Text with sources</button>
                        </div>
                      )}
                    </span>
                    {m === lastAssistant && !busy && !(messages.findLast((x) => x.role === "user")?.meta?.files?.length && files.length === 0) && <button type="button" onClick={() => void send("", true)} className="rounded p-1.5 hover:bg-surface hover:text-ink" aria-label="Answer again"><RefreshCw className="h-4 w-4" /></button>}
                  </div>
                )}
                {m === lastAssistant && !busy && m.meta?.follow_ups && m.meta.follow_ups.length > 0 && (
                  <div className="no-print mt-2 flex flex-wrap gap-2">{m.meta.follow_ups.map((f) => <button key={f} type="button" onClick={() => void send(f)} className="rounded-full border border-line px-3 py-1 text-[0.82rem] hover:border-brand hover:text-brand">{f}</button>)}</div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-line px-4 py-2.5 sm:px-6 2xl:px-10 2xl:py-3">
          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="mx-auto max-w-4xl rounded-xl border border-line bg-field p-1.5 focus-within:border-brand 2xl:p-2">
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={600} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
              onPaste={(e) => { const pasted = Array.from(e.clipboardData.files); if (pasted.length && canAttach) { e.preventDefault(); void attach(pasted); } }}
              placeholder={files.length ? "What should I do with the file? e.g. Do we have stock for this PO? Or just press Ask to have it read." : stockMode ? (canAttach ? "Is it in stock? e.g. 12 mm SA 516 Gr 70, 1500 × 6000, 5 plates. Or drop a photo of the enquiry here." : "Is it in stock? e.g. 12 mm SA 516 Gr 70, 1500 × 6000, 5 plates") : canAttach ? "Ask anything, or drop a file here. e.g. Do we have 12 mm SA 516 Gr 70, 1500 × 6000?" : "Ask anything, e.g. Do we have 12 mm SA 516 Gr 70, 1500 × 6000?"} aria-label="Your question"
              className="max-h-[200px] w-full resize-none bg-transparent px-2 py-1.5 text-[0.95rem] outline-none" />
            {files.length > 0 && <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1">{files.map((f, i) => {
              const Icon = SHEETS.includes(extOf(f.name)) ? FileSpreadsheet : FileText;
              return (
              <span key={i} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-line bg-surface py-0.5 pl-1 pr-2 text-[0.78rem]">
                {f.image ? <img src={`data:${f.mime};base64,${f.data}`} alt="" className="h-6 w-6 rounded object-cover" /> : <Icon className="ml-1 h-3.5 w-3.5 shrink-0 text-muted" />}
                <span className="truncate" title={f.name}>{f.name}</span><span className="shrink-0 text-muted">({f.size >= 1_000_000 ? (f.size / 1_000_000).toFixed(1) + " MB" : Math.max(1, Math.round(f.size / 1000)) + " KB"})</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="shrink-0 rounded text-muted hover:text-bad" aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button></span>);
            })}<span className="text-[0.72rem] text-muted">stay on this chat for follow-up questions</span></div>}
            {reading && <p className="flex items-center gap-1.5 px-1 pb-1 text-[0.78rem] text-muted"><Loader2 className="h-3 w-3 animate-spin" />Reading the files…</p>}
            {fileNote && <p className="px-1 pb-1 text-[0.78rem] text-bad">{fileNote}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
              {canAttach && <>
                <input ref={picker} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void attach(e.target.files)} aria-label="Attach files" />
                <button type="button" onClick={() => picker.current?.click()} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[0.82rem] text-muted hover:text-ink disabled:opacity-50" title={`Attach files, or drop them anywhere on this page, or paste a screenshot. ${FORMATS[0].toUpperCase() + FORMATS.slice(1)}; up to ${MAX_FILES} files, ${MAX_BYTES / 1_000_000} MB in all. Read for this chat only, not stored.`}><Paperclip className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Attach</span></button>
              </>}
              <label className="flex items-center gap-1.5 text-[0.78rem] text-muted"><span className="sr-only sm:not-sr-only">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} className="max-w-[13rem] rounded-md border border-line bg-card px-1.5 py-1 text-[0.82rem] text-ink" aria-label="Model" title={models.find((m) => m.value === model)?.hint}>
                  {models.filter((m) => m.value === "auto").map((m) => <option key={m.value} value={m.value} disabled={!m.ready}>{m.label}{m.ready ? "" : " - key not set"}</option>)}
                  {(["anthropic", "openai"] as const).map((pv) => (
                    <optgroup key={pv} label={pv === "anthropic" ? "Anthropic (Claude)" : "OpenAI"}>
                      {models.filter((m) => m.provider === pv && m.value !== "auto").map((m) => <option key={m.value} value={m.value} disabled={!m.ready}>{m.label}{m.ready ? "" : " - key not set"}</option>)}
                    </optgroup>
                  ))}</select><ModelPrices roles={roles} /></label>
              {!stockMode && <label className="flex items-center gap-1.5 text-[0.78rem] text-muted"><span className="sr-only sm:not-sr-only">Look in</span>
                <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy} className="rounded-md border border-line bg-card px-1.5 py-1 text-[0.82rem] text-ink" aria-label="Look in">
                  {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>}
              <span className="hidden text-[0.74rem] text-muted 2xl:inline">{models.find((m) => m.value === model)?.hint}</span>
              {busy
                ? <button type="button" onClick={() => abort.current?.abort()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface"><Square className="h-3.5 w-3.5" />Stop</button>
                : <button type="submit" disabled={text.trim().length < 2 && files.length === 0} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"><SendHorizonal className="h-4 w-4" />Ask</button>}
            </div>
          </form>
          <p className="mx-auto mt-1 hidden max-w-4xl text-center text-[0.72rem] text-muted sm:block">Answers come from your records and can still be wrong. Check anything important. Enter sends, Shift+Enter adds a line.</p>
        </div>
      </section>
      {pform && (
        <div className="fixed inset-0 z-[85] grid place-items-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setPform(null); }}>
          <form role="dialog" aria-modal="true" aria-label={pform.id ? "Edit project" : "New project"} onSubmit={(e) => { e.preventDefault(); void saveProject(); }} className="w-full max-w-lg rounded-xl border border-line bg-card p-5 shadow-2xl">
            <h2 className="font-display text-lg font-bold">{pform.id ? "Edit project" : "New project"}</h2>
            <p className="mt-0.5 text-[0.84rem] text-muted">A project keeps related chats together. Its instructions are followed in every chat inside it.</p>
            <label className="mt-4 block text-[0.82rem] font-medium">Name
              <input autoFocus value={pform.name} onChange={(e) => setPform({ ...pform, name: e.target.value })} maxLength={60} placeholder="e.g. SPF stock questions" className="mt-1 w-full rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.92rem] font-normal" />
            </label>
            <label className="mt-3 block text-[0.82rem] font-medium">Instructions <span className="font-normal text-muted">(optional)</span>
              <textarea value={pform.instructions} onChange={(e) => setPform({ ...pform, instructions: e.target.value })} maxLength={2000} rows={5} placeholder="e.g. Always give weights in tonnes. Focus on SPF stock. Keep answers to a short table and one line." className="mt-1 w-full resize-y rounded-md border border-line bg-field px-2.5 py-1.5 text-[0.9rem] font-normal" />
            </label>
            <p className="mt-1 text-[0.74rem] text-muted">{pform.instructions.length}/2000. These set focus and style only: answers still come from your records, with sources.</p>
            {perr && <p className="mt-2 text-[0.84rem] text-bad">{perr}</p>}
            <div className="mt-4 flex items-center gap-2">
              {pform.id && <button type="button" onClick={() => void removeProject(pform.id!)} className="rounded-lg px-2.5 py-1.5 text-[0.85rem] font-medium text-bad hover:bg-surface">Delete project</button>}
              <span className="flex-1" />
              <button type="button" onClick={() => setPform(null)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface">Cancel</button>
              <button type="submit" disabled={pform.name.trim().length === 0 || pbusy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">{pbusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
            </div>
          </form>
        </div>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6" role="presentation">
          <div className="max-w-md rounded-2xl border-2 border-dashed border-brand bg-card px-8 py-10 text-center shadow-2xl">
            <UploadCloud className="mx-auto h-10 w-10 text-brand" />
            <p className="mt-3 font-display text-lg font-bold">{canAttach ? (busy ? "Wait for the answer, then drop the file" : "Drop files to attach") : "Your account cannot attach files"}</p>
            {canAttach && !busy && <p className="mt-1 text-[0.85rem] text-muted">{FORMATS[0].toUpperCase() + FORMATS.slice(1)}. Up to {MAX_FILES} files.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
