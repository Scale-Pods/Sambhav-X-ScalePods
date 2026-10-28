"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

const KEY = "sidebar-open";

/**
 * The left menu, like Gmail's: the three-line button folds it to a column of icons and back. While it is folded, pointing at it opens it over the page
 * (so you can read the names) and it folds again when the pointer leaves. The choice is remembered; the first time, narrow screens start folded.
 * Labels hide themselves with `group-data-[rail=true]/side:hidden`, so the menu items can stay ordinary server-rendered links.
 */
export function SidebarShell({ logo, children }: { logo: ReactNode; children: ReactNode }) {
  const [pinned, setPinned] = useState(true); // open for good (false: folded)
  const [hover, setHover] = useState(false);
  const leave = useRef<number | null>(null);
  const side = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      setPinned(v === null ? window.innerWidth >= 1536 : v === "1");
    } catch { setPinned(window.innerWidth >= 1536); }
  }, []);
  const toggle = () => {
    const next = !pinned;
    setPinned(next); setHover(false);
    try { window.localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* the choice is just not remembered */ }
  };
  // while it is open over the page, close it as soon as the pointer is anywhere else (a missed mouse-leave must never leave it stuck open)
  useEffect(() => {
    if (!hover) return;
    const move = (e: MouseEvent) => { if (side.current && !side.current.contains(e.target as Node)) setHover(false); };
    const out = () => setHover(false);
    window.addEventListener("mousemove", move);
    document.documentElement.addEventListener("mouseleave", out);
    window.addEventListener("blur", out);
    return () => { window.removeEventListener("mousemove", move); document.documentElement.removeEventListener("mouseleave", out); window.removeEventListener("blur", out); };
  }, [hover]);
  const rail = !pinned && !hover;

  return (
    <div className="relative hidden shrink-0 transition-[width] duration-200 lg:block" style={{ width: pinned ? "16rem" : "4.5rem" }}>
      <div className="sticky top-0 z-40 h-screen">
        <aside
          ref={side}
          data-rail={rail ? "true" : "false"}
          onMouseEnter={() => { if (leave.current) window.clearTimeout(leave.current); if (!pinned) setHover(true); }}
          onMouseLeave={() => { leave.current = window.setTimeout(() => setHover(false), 160); }}
          className={"group/side absolute left-0 top-0 z-30 flex h-full flex-col bg-steel py-5 transition-[width,padding] duration-200 " + (rail ? "w-[4.5rem] px-2.5" : "w-64 px-4") + (!pinned && hover ? " shadow-[10px_0_30px_rgba(0,0,0,0.4)]" : "")}
        >
          <div className="mb-6 flex items-center gap-2 group-data-[rail=true]/side:justify-center">
            <button type="button" onClick={toggle} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-steel-ink hover:bg-white/[0.08] hover:text-white" aria-label={pinned ? "Fold the menu" : "Keep the menu open"} title={pinned ? "Fold the menu" : "Keep the menu open"} aria-expanded={pinned}>
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/" className="block min-w-0 flex-1 px-1 group-data-[rail=true]/side:hidden">{logo}</Link>
          </div>
          {children}
        </aside>
      </div>
    </div>
  );
}
