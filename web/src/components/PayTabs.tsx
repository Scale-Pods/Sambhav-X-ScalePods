"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS: [string, string][] = [
  ["/payments", "Overview"], ["/payments/sales", "Sales invoices"], ["/payments/purchases", "Purchase invoices"], ["/payments/expenses", "Expenses"],
  ["/payments/receivables", "Debtors"], ["/payments/reminders", "Reminders"], ["/payments/payables", "Creditors"], ["/payments/other", "Other payments"],
];
const KEEP = ["entity", "p", "from", "to"];

/** The sections of Invoices and payments. The company and period choice follows you from tab to tab. */
export function PayTabs() {
  const path = usePathname();
  const sp = useSearchParams();
  const keep = new URLSearchParams();
  KEEP.forEach((k) => sp.get(k) && keep.set(k, sp.get(k)!));
  const qs = keep.toString() ? "?" + keep.toString() : "";
  return (
    <nav className="mb-6 flex flex-wrap gap-x-6 gap-y-1 border-b border-line" aria-label="Invoices and payments">
      {TABS.map(([href, label]) => {
        const on = href === "/payments" ? path === "/payments" : path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href + qs} aria-current={on ? "page" : undefined}
            className={"border-b-2 px-1 pb-3 text-[0.95rem] font-semibold transition-colors " + (on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
