"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FILTER_KEYS } from "@/lib/filters";
import type { ReactNode } from "react";

const CARRY = ["/", "/summary", "/stock", "/review"];

export function NavLink({ href, children, soon }: { href: string; children: ReactNode; soon?: boolean }) {
  const path = usePathname();
  const sp = useSearchParams();
  // the stock pages share one filter: carry it along when moving between them
  const carry = CARRY.includes(href) && CARRY.includes(path) ? FILTER_KEYS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!] as [string, string]) : [];
  const to = carry.length ? `${href}?${new URLSearchParams(carry)}` : href;
  const active = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={to}
      aria-current={active ? "page" : undefined}
      className={
        "group flex items-center gap-3 rounded-md px-3 py-2 text-[0.95rem] font-medium transition-colors " +
        (active ? "bg-accent text-white shadow-[0_2px_10px_rgba(242,101,34,0.35)]" : "text-steel-ink hover:bg-white/[0.06] hover:text-white")
      }
    >
      {children}
      {soon && <span className="ml-auto rounded-sm bg-white/[0.07] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-steel-muted">Soon</span>}
    </Link>
  );
}
