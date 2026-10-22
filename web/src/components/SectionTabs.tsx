"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Tabs for a section of the app. `keep` names the address choices (period, company) that follow you from tab to tab. */
export function SectionTabs({ tabs, label, keep = ["p", "from", "to"] }: { tabs: [string, string][]; label: string; keep?: string[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  const k = new URLSearchParams();
  keep.forEach((x) => sp.get(x) && k.set(x, sp.get(x)!));
  const qs = k.toString() ? "?" + k.toString() : "";
  const root = tabs[0][0];
  return (
    <nav className="mb-6 flex flex-wrap gap-x-6 gap-y-1 border-b border-line" aria-label={label}>
      {tabs.map(([href, text]) => {
        const on = href === root ? path === root : path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href + qs} aria-current={on ? "page" : undefined}
            className={"border-b-2 px-1 pb-3 text-[0.95rem] font-semibold transition-colors " + (on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
            {text}
          </Link>
        );
      })}
    </nav>
  );
}
