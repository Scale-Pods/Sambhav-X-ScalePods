"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";

/** The strip above the sheet while rows are highlighted: what the colours mean, and a way to clear them. It also scrolls the first marked row into view. */
export function HighlightBar({ add, del, see, clearHref, title }: { add: number; del: number; see: number; clearHref: string; title?: string }) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = document.querySelector("[data-hl]");
      if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(t);
  }, []);
  const chip = (n: number, cls: string, label: string) => n > 0 && <span className="inline-flex items-center gap-1.5"><span className={"inline-block h-3 w-3 rounded-sm " + cls} />{n} {label}</span>;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-card px-3.5 py-2 text-[0.86rem]">
      <span className="font-medium">{title ?? "Showing what changed"}</span>
      {chip(add, "bg-ok", add === 1 ? "line added" : "lines added")}
      {chip(del, "bg-bad", del === 1 ? "line taken out" : "lines taken out")}
      {chip(see, "bg-brand", see === 1 ? "line shown" : "lines shown")}
      <Link href={clearHref} className="ml-auto inline-flex items-center gap-1 text-[0.82rem] font-medium text-muted hover:text-ink"><X className="h-3.5 w-3.5" /> Clear highlight</Link>
    </div>
  );
}
