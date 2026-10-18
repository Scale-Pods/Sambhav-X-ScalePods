"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children, soon }: { href: string; children: ReactNode; soon?: boolean }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] font-medium transition-colors " +
        (active ? "bg-brand-soft text-brand-dark" : "text-muted hover:bg-surface hover:text-ink")
      }
    >
      {children}
      {soon && <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">Soon</span>}
    </Link>
  );
}
