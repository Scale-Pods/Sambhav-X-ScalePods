"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, LayoutDashboard } from "lucide-react";

/** Switch between the app's own pages and the Google-Sheets-style view of the client's sheets. Both stay available. */
export function ViewToggle() {
  const path = usePathname();
  const sheets = path === "/sheets" || path.startsWith("/sheets/");
  const seg = (on: boolean) =>
    "flex items-center gap-1.5 px-2 py-1.5 text-[0.82rem] sm:px-3 font-semibold transition-colors " + (on ? "bg-ink text-surface" : "text-muted hover:text-ink");
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-line bg-field" role="group" aria-label="View">
      <Link href="/" aria-current={!sheets ? "page" : undefined} className={seg(!sheets)} title="The app's own pages: charts, plates, count">
        <LayoutDashboard className="h-3.5 w-3.5" /> <span className="hidden sm:inline">App view</span>
      </Link>
      <Link href="/sheets" aria-current={sheets ? "page" : undefined} className={seg(sheets)} title="Your Google Sheets, tab by tab, as they look today">
        <FileSpreadsheet className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sheet view</span>
      </Link>
    </div>
  );
}
