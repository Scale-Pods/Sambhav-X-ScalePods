import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BarChart3, ClipboardCheck, FileText, Home, Layers, Mail, Package, ReceiptIndianRupee, Search, ShieldAlert, Table2 } from "lucide-react";
import { NavLink } from "./NavLink";
import { UserChip } from "./UserChip";

const icon = "h-[1.15rem] w-[1.15rem] shrink-0";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-card px-4 py-5 lg:flex">
        <Link href="/" className="mb-6 block px-1">
          <Image src="/logo.jpg" alt="Sambhav Pipes & Fittings" width={361} height={86} priority className="h-auto w-full" />
        </Link>

        <Suspense fallback={<div className="flex-1" />}>
        <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Stock</p>
            <NavLink href="/"><Home className={icon} />Overview</NavLink>
            <NavLink href="/summary"><Table2 className={icon} />Summary</NavLink>
            <NavLink href="/stock"><Layers className={icon} />Plates</NavLink>
            <NavLink href="/count"><ClipboardCheck className={icon} />Physical count</NavLink>
          </div>
          <div className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Business</p>
            <NavLink href="/orders" soon><Package className={icon} />Orders &amp; dispatch</NavLink>
            <NavLink href="/quotations" soon><FileText className={icon} />Quotations</NavLink>
            <NavLink href="/mail" soon><Mail className={icon} />Mail &amp; leads</NavLink>
            <NavLink href="/payments" soon><ReceiptIndianRupee className={icon} />Payments</NavLink>
          </div>
          <div className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[0.72rem] font-semibold uppercase tracking-wider text-muted">Control</p>
            <NavLink href="/review"><ShieldAlert className={icon} />Needs review</NavLink>
          </div>
        </nav>
        </Suspense>

        <div className="mt-4 rounded-lg bg-brand-soft p-3 text-[0.8rem] leading-snug text-brand-dark">
          <p className="font-semibold">Practice data</p>
          <p className="mt-0.5 opacity-90">Loaded from your WB1 and WB2 sheets. Nothing here changes your sheets.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card/90 px-4 py-3 backdrop-blur sm:px-8">
          <Link href="/" className="lg:hidden">
            <Image src="/logo.jpg" alt="Sambhav" width={140} height={33} className="h-8 w-auto" />
          </Link>
          <form action="/stock" className="relative ml-auto w-full max-w-md lg:ml-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              name="q"
              placeholder="Search a plate number, heat number or grade"
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-[0.95rem] placeholder:text-muted/80 focus:bg-white"
            />
          </form>
          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-3 py-1 text-[0.8rem] text-muted">
              <BarChart3 className="h-3.5 w-3.5" /> FY 2026-27
            </span>
          </div>
          <Suspense fallback={<span className="h-9 w-9 rounded-full bg-surface" />}>
            <UserChip />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-7 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
