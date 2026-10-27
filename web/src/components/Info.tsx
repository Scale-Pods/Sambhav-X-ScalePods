"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, explain } from "@/lib/glossary";

/**
 * A small "i" button that explains what the word or number next to it means, in plain language.
 * Opens on hover, keyboard focus or tap; closes on Escape, on a tap elsewhere or when the page scrolls.
 * Give it either `term` (a glossary key or a label, see lib/glossary.ts) or the explanation as children.
 * The box is drawn at the top of the page (portal), so a table's scroll area never cuts it off.
 */
export function Info({ term, children, className = "" }: { term?: string; children?: ReactNode; className?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const hold = useRef<number | null>(null);
  const entry = term ? (GLOSSARY[term] ?? explain(term)) : null;
  const text = children ?? entry?.text;

  const show = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    const above = r.bottom + 170 > window.innerHeight && r.top > 190;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    const away = (e: PointerEvent) => { if (!btn.current?.contains(e.target as Node)) setPos(null); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", away); };
  }, [pos]);

  if (!text) return null;
  const width = typeof window === "undefined" ? 320 : Math.min(320, window.innerWidth - 24);
  return (
    <>
      <button
        ref={btn} type="button" aria-label={entry?.title ? `What is “${entry.title}”?` : "What does this mean?"} aria-describedby={pos ? id : undefined} aria-expanded={pos !== null}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); pos ? hide() : show(); }}
        onMouseEnter={() => { if (hold.current) window.clearTimeout(hold.current); show(); }}
        onMouseLeave={() => { hold.current = window.setTimeout(hide, 120); }}
        onFocus={show} onBlur={hide}
        className={"ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-line bg-card align-middle text-[0.62rem] font-bold normal-case italic leading-none tracking-normal text-muted hover:border-brand hover:text-brand focus-visible:outline-2 " + className}
      >i</button>
      {pos && typeof document !== "undefined" && createPortal(
        <div id={id} role="tooltip" style={{ position: "fixed", top: pos.top, left: pos.left, width, transform: pos.above ? "translateY(-100%)" : undefined, zIndex: 80 }}
          onMouseEnter={() => { if (hold.current) window.clearTimeout(hold.current); }} onMouseLeave={hide}
          className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-left text-[0.82rem] font-normal normal-case not-italic leading-relaxed tracking-normal text-ink shadow-lg">
          {entry?.title && <p className="mb-0.5 font-display text-[0.86rem] font-bold">{entry.title}</p>}
          <div className="space-y-1.5">{text}</div>
        </div>, document.body)}
    </>
  );
}
