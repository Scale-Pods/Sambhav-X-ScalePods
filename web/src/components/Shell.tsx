import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ClipboardCheck, Factory, FileSpreadsheet, FileText, Home, Layers, Search, ShieldAlert, Table2 } from "lucide-react";
import { Logo } from "./Logo";
import { BusinessNav } from "./BusinessNav";
import { NavLink } from "./NavLink";
import { NavProgress } from "./NavProgress";
import { PeriodPill } from "./PeriodPill";
import { ThemeToggle } from "./ThemeToggle";
import { UserChip } from "./UserChip";
import { ViewToggle } from "./ViewToggle";

const icon = "h-[1.15rem] w-[1.15rem] shrink-0";
const group = "px-3 pb-1.5 font-display text-[0.68rem] font-bold uppercase tracking-[0.14em] text-steel-muted";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Suspense fallback={null}><NavProgress /></Suspense>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-steel px-4 py-5 lg:flex">
        <Link href="/" className="mb-8 block px-1">
          <Logo variant="dark" priority />
        </Link>

        <Suspense fallback={<div className="flex-1" />}>
          <nav className="nav-scroll -mr-2 flex flex-1 flex-col gap-6 overflow-y-auto pr-2">
            <div className="flex flex-col gap-1">
              <p className={group}>Stock</p>
              <NavLink href="/"><Home className={icon} />Overview</NavLink>
              <NavLink href="/summary"><Table2 className={icon} />Summary</NavLink>
              <NavLink href="/stock"><Layers className={icon} />Plates</NavLink>
              <NavLink href="/count"><ClipboardCheck className={icon} />Physical count</NavLink>
              <NavLink href="/mill-orders"><Factory className={icon} />Mill orders</NavLink>
            </div>
            <Suspense fallback={null}><BusinessNav /></Suspense>
            <div className="flex flex-col gap-1">
              <p className={group}>Your sheets</p>
              <NavLink href="/sheets"><FileSpreadsheet className={icon} />Sheet view</NavLink>
            </div>
            <div className="flex flex-col gap-1">
              <p className={group}>Control</p>
              <NavLink href="/review"><ShieldAlert className={icon} />Needs review</NavLink>
              <NavLink href="/documents"><FileText className={icon} />Documents</NavLink>
            </div>
          </nav>
        </Suspense>

        <div className="mt-4 border-l-2 border-accent bg-white/[0.04] px-3 py-2.5 text-[0.78rem] leading-snug text-steel-ink">
          <p className="font-semibold text-white">Practice data</p>
          <p className="mt-0.5 text-steel-muted">Loaded from your WB1 and WB2 sheets. Nothing here changes your sheets.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 sm:gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur sm:px-8">
          <Link href="/" className="w-28 shrink-0 sm:w-40 lg:hidden">
            <Logo />
          </Link>
          <form action="/stock" className="relative ml-auto w-full max-w-md lg:ml-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              name="q"
              placeholder="Search a plate number, heat number or grade"
              className="w-full rounded-md border border-line bg-field py-2 pl-9 pr-3 text-[0.95rem] placeholder:text-muted/80"
            />
          </form>
          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <Suspense fallback={null}><PeriodPill /></Suspense>
          </div>
          <Suspense fallback={null}><ViewToggle /></Suspense>
          <ThemeToggle />
          <Suspense fallback={<span className="h-9 w-9 rounded-full bg-line" />}>
            <UserChip />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-[110rem] flex-1 px-4 py-8 sm:px-8 2xl:px-12">{children}</main>
      </div>
    </div>
  );
}
