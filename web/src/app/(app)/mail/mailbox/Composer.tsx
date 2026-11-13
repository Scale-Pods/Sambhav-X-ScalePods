"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bold, Italic, Link2, List, ListOrdered, Loader2, Minus, Paperclip, PenSquare, Send, Trash2, Underline, X } from "lucide-react";
import { COMPOSE_EVENT, openCompose, type ComposeInit } from "@/lib/mail/compose";

const MAX_BYTES = 3_500_000;
const box = "w-full border-b border-line bg-transparent px-3 py-1.5 text-[0.9rem] outline-none";
const size = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Mail from outside is put through this before it enters the editor: no script, no frames, no event handlers, no javascript: links. */
function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,form,meta,link,base,style,noscript").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "src" || n === "xlink:href") && /^(javascript|vbscript|data:text)/.test(v))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

/** The button that starts a new mail. */
export function ComposeButton({ mb, address, disabled, why }: { mb: string; address: string; disabled: boolean; why: string }) {
  return (
    <button type="button" disabled={disabled} title={disabled ? why : "Write a new mail"} onClick={() => openCompose({ mb, address, mode: "new", title: "New message", to: "", cc: "", bcc: "", subject: "", html: "" })}
      className="inline-flex items-center gap-2 rounded-2xl bg-brand-soft px-4 py-2 text-[0.9rem] font-semibold text-brand hover:bg-brand hover:text-white disabled:opacity-50 disabled:hover:bg-brand-soft disabled:hover:text-brand">
      <PenSquare className="h-4 w-4" />Compose
    </button>
  );
}

/** The writing window, bottom right like Gmail's. It opens when a button asks for it (new, reply, reply all, forward, edit a draft). */
export function ComposeHost({ canSend }: { canSend: boolean }) {
  const router = useRouter();
  const [init, setInit] = useState<ComposeInit | null>(null);
  const [small, setSmall] = useState(false);
  const [to, setTo] = useState(""); const [cc, setCc] = useState(""); const [bcc, setBcc] = useState(""); const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [busy, setBusy] = useState<null | "send" | "draft">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const pending = useRef<string>("");

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ComposeInit>).detail;
      if (init && dirty && !window.confirm("Replace the mail you are writing?")) return;
      pending.current = d.html;
      setInit(d); setTo(d.to); setCc(d.cc); setBcc(d.bcc); setSubject(d.subject); setShowCc(Boolean(d.cc || d.bcc)); setFiles([]); setDraftId(d.draftId); setMsg(null); setSmall(false); setDirty(false);
    };
    window.addEventListener(COMPOSE_EVENT, on);
    return () => window.removeEventListener(COMPOSE_EVENT, on);
  }, [init, dirty]);

  // the opening text goes into the editor once it is on the screen
  useEffect(() => { if (init && editor.current) { editor.current.innerHTML = pending.current ? safeHtml(pending.current) : "<p><br></p>"; if (init.mode === "new" || init.mode === "reply" || init.mode === "replyall" || init.mode === "forward") editor.current.focus(); } }, [init]);

  const cmd = (c: string, v?: string) => { editor.current?.focus(); document.execCommand(c, false, v); setDirty(true); };
  const addLink = () => { const u = window.prompt("Link address (https://...)"); if (u && /^(https?:\/\/|mailto:)/i.test(u.trim())) cmd("createLink", u.trim()); };
  const attach = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    if (next.reduce((a, f) => a + f.size, 0) > MAX_BYTES) { setMsg({ ok: false, text: "Attachments can be about 3.5 MB in all, for now." }); return; }
    setFiles(next); setDirty(true); setMsg(null);
  };

  const form = useCallback((action: "send" | "draft" | "discard") => {
    const f = new FormData();
    if (!init) return f;
    f.set("action", action); f.set("mb", init.mb); f.set("to", to); f.set("cc", cc); f.set("bcc", bcc); f.set("subject", subject);
    f.set("html", editor.current?.innerHTML ?? ""); f.set("text", editor.current?.innerText ?? "");
    if (init.threadId) f.set("threadId", init.threadId); if (init.inReplyTo) f.set("inReplyTo", init.inReplyTo); if (init.references) f.set("references", init.references);
    if (draftId) f.set("draftId", draftId); if (init.fwdMessageId) f.set("fwd", init.fwdMessageId);
    files.forEach((x) => f.append("files", x));
    return f;
  }, [init, to, cc, bcc, subject, draftId, files]);

  async function run(action: "send" | "draft") {
    if (busy) return;
    setBusy(action); setMsg(null);
    try {
      const r = await fetch("/api/mail/send", { method: "POST", body: form(action) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; draftId?: string };
      if (!r.ok || !j.ok) { setMsg({ ok: false, text: j.error ?? "It could not be done." }); return; }
      if (action === "draft") { if (j.draftId) setDraftId(j.draftId); setDirty(false); setMsg({ ok: true, text: "Saved as a draft." }); router.refresh(); return; }
      setInit(null); setDirty(false); router.refresh();
      window.alert("Message sent.");
    } catch { setMsg({ ok: false, text: "The connection failed. Please try again." }); } finally { setBusy(null); }
  }
  async function discard() {
    if (!init) return;
    if (dirty || draftId) { if (!window.confirm(draftId ? "Delete this draft?" : "Discard this mail?")) return; }
    if (draftId) { await fetch("/api/mail/send", { method: "POST", body: form("discard") }).catch(() => {}); router.refresh(); }
    setInit(null); setDirty(false);
  }
  function close() {
    if (dirty && !window.confirm("Close without saving? What you wrote will be lost. Use “Save draft” to keep it.")) return;
    setInit(null); setDirty(false);
  }

  if (!init) return null;
  return (
    <div className="fixed bottom-0 right-3 z-[60] flex w-[min(36rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-t-xl border border-line bg-card shadow-2xl" role="dialog" aria-label={init.title}>
      <div className="flex items-center gap-1 bg-steel px-3 py-2 text-steel-ink">
        <button type="button" onClick={() => setSmall((s) => !s)} className="flex-1 truncate text-left text-[0.9rem] font-semibold">{subject.trim() ? `${init.title}: ${subject}` : init.title}</button>
        <button type="button" onClick={() => setSmall((s) => !s)} className="rounded p-1 hover:bg-white/10" aria-label="Minimise"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={close} className="rounded p-1 hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      {!small && (
        <>
          <p className="border-b border-line px-3 py-1.5 text-[0.82rem] text-muted">From <span className="font-medium text-ink">{init.address}</span></p>
          <div className="relative">
            <input value={to} onChange={(e) => { setTo(e.target.value); setDirty(true); }} placeholder="To" aria-label="To" className={box + " pr-16"} autoComplete="off" />
            {!showCc && <button type="button" onClick={() => setShowCc(true)} className="absolute right-3 top-1.5 text-[0.8rem] text-muted hover:text-ink">Cc Bcc</button>}
          </div>
          {showCc && <><input value={cc} onChange={(e) => { setCc(e.target.value); setDirty(true); }} placeholder="Cc" aria-label="Cc" className={box} autoComplete="off" /><input value={bcc} onChange={(e) => { setBcc(e.target.value); setDirty(true); }} placeholder="Bcc" aria-label="Bcc" className={box} autoComplete="off" /></>}
          <input value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} placeholder="Subject" aria-label="Subject" className={box} autoComplete="off" />
          <div ref={editor} contentEditable suppressContentEditableWarning onInput={() => setDirty(true)} role="textbox" aria-multiline="true" aria-label="Message"
            className="max-h-[48vh] min-h-[16rem] overflow-y-auto bg-white px-3 py-2 text-[0.92rem] leading-relaxed text-[#1a2530] outline-none [&_a]:text-[#0a76ad] [&_blockquote]:border-l [&_blockquote]:pl-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc" />
          {(files.length > 0 || (init.fwdCount ?? 0) > 0) && (
            <ul className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
              {(init.fwdCount ?? 0) > 0 && <li className="rounded-md bg-surface px-2 py-1 text-[0.78rem] text-muted">{init.fwdCount} attachment{init.fwdCount === 1 ? "" : "s"} of the original mail will go along</li>}
              {files.map((f, i) => <li key={i} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[0.78rem]"><Paperclip className="h-3 w-3" />{f.name} <span className="text-muted">{size(f.size)}</span><button type="button" onClick={() => { setFiles(files.filter((_, j) => j !== i)); setDirty(true); }} aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button></li>)}
            </ul>
          )}
          {msg && <p className={"border-t border-line px-3 py-1.5 text-[0.82rem] " + (msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
          {!canSend && <p className="border-t border-line bg-warn-soft px-3 py-1.5 text-[0.78rem] text-warn">Only an approver, an administrator or the owner can send. Save it as a draft and ask one of them.</p>}
          <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-2">
            <button type="button" disabled={!canSend || busy !== null} onClick={() => void run("send")} title={canSend ? "Send" : "Only an approver, an administrator or the owner can send"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send</button>
            <button type="button" disabled={busy !== null} onClick={() => void run("draft")} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface disabled:opacity-50">{busy === "draft" ? "Saving…" : "Save draft"}</button>
            <span className="mx-1 h-5 w-px bg-line" />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("bold")} className="rounded p-1.5 hover:bg-surface" aria-label="Bold"><Bold className="h-4 w-4" /></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("italic")} className="rounded p-1.5 hover:bg-surface" aria-label="Italic"><Italic className="h-4 w-4" /></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("underline")} className="rounded p-1.5 hover:bg-surface" aria-label="Underline"><Underline className="h-4 w-4" /></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertUnorderedList")} className="rounded p-1.5 hover:bg-surface" aria-label="Bulleted list"><List className="h-4 w-4" /></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("insertOrderedList")} className="rounded p-1.5 hover:bg-surface" aria-label="Numbered list"><ListOrdered className="h-4 w-4" /></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addLink} className="rounded p-1.5 hover:bg-surface" aria-label="Link"><Link2 className="h-4 w-4" /></button>
            <label className="cursor-pointer rounded p-1.5 hover:bg-surface" title="Attach files" aria-label="Attach files"><Paperclip className="h-4 w-4" /><input type="file" multiple className="hidden" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} /></label>
            <button type="button" onClick={() => void discard()} className="ml-auto rounded p-1.5 text-muted hover:bg-surface hover:text-bad" aria-label="Discard" title="Discard"><Trash2 className="h-4 w-4" /></button>
          </div>
        </>
      )}
    </div>
  );
}
