"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { pageDefault, parseFilter, periodLabel } from "@/lib/filters";
import { useToday } from "./useToday";

const FILTERED = ["/", "/summary", "/plates", "/review"];

/** Header reminder of which period the page is showing (the picker itself sits above the content). */
export function PeriodPill() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const today = useToday();
  if (!FILTERED.includes(pathname)) return null;
  const f = parseFilter(Object.fromEntries(sp.entries()), pageDefault(pathname), today);
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-field px-3 py-1.5 text-[0.8rem] font-medium text-muted" title="Period shown on this page">
      <BarChart3 className="h-3.5 w-3.5" /> {periodLabel(f, today)}
    </span>
  );
}
