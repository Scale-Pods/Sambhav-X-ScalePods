import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export const CONTACT = "info@scalepods.co";
export const UPDATED = "14 November 2026";

/** The frame of the pages anyone may read without signing in (home, privacy policy, terms): logo, a sign-in link, and the links every visitor and Google's review look for. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/welcome" aria-label="Sambhav Stock home"><Logo className="w-44 sm:w-56" priority /></Link>
          <nav className="flex items-center gap-4 text-[0.9rem] font-medium">
            <Link href="/privacy" className="hidden text-muted hover:text-ink sm:inline">Privacy</Link>
            <Link href="/terms" className="hidden text-muted hover:text-ink sm:inline">Terms</Link>
            <Link href="/login" className="rounded-lg bg-brand px-3.5 py-1.5 text-white hover:bg-brand-dark">Sign in</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">{children}</main>
      <footer className="border-t border-line bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-5 text-[0.85rem] text-muted">
          <p>© Sambhav Pipes &amp; Fittings · Sambhav Stock · built by ScalePods</p>
          <p className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/welcome" className="hover:text-ink hover:underline">Home</Link>
            <Link href="/privacy" className="hover:text-ink hover:underline">Privacy policy</Link>
            <Link href="/terms" className="hover:text-ink hover:underline">Terms of service</Link>
            <a href={`mailto:${CONTACT}`} className="hover:text-ink hover:underline">{CONTACT}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => <h2 className="mt-9 font-display text-[1.25rem] font-bold tracking-[-0.01em]">{children}</h2>;
export const P = ({ children }: { children: ReactNode }) => <p className="mt-3 leading-relaxed text-ink/90">{children}</p>;
export const UL = ({ children }: { children: ReactNode }) => <ul className="mt-3 list-disc space-y-1.5 pl-6 leading-relaxed text-ink/90">{children}</ul>;
