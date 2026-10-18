"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** A thin brand-coloured line across the top while the next page loads. */
export function NavProgress() {
  const key = usePathname() + "?" + useSearchParams().toString();
  const [state, setState] = useState<"idle" | "run" | "done">("idle");

  // a click on an in-app link, or a search form, starts the bar
  useEffect(() => {
    const here = () => location.pathname + location.search;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname + u.search === here()) return;
      setState("run");
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement | null;
      if (f && f.method.toLowerCase() === "get") setState("run");
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  // the new page arrived: finish the bar, then hide it
  useEffect(() => {
    setState((s) => (s === "run" ? "done" : s));
    const t = setTimeout(() => setState("idle"), 500);
    return () => clearTimeout(t);
  }, [key]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
      <div
        className={"h-full rounded-r-full bg-gradient-to-r from-brand via-brand to-accent " + (state === "run" ? "nav-progress-run" : state === "done" ? "nav-progress-done" : "opacity-0")}
        style={state === "idle" ? { width: 0 } : undefined}
      />
    </div>
  );
}
