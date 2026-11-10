import Link from "next/link";
import { SearchX } from "lucide-react";

export function NotFound({ inApp = true }: { inApp?: boolean }) {
  return (
    <div className={"grid place-items-center px-4 " + (inApp ? "py-20" : "min-h-screen bg-surface")}>
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-accent-soft text-accent"><SearchX className="h-6 w-6" /></span>
        <div className="mx-auto mt-6 h-1 w-10 rounded-full bg-accent" />
        <h1 className="mt-4 font-display text-[1.8rem] font-extrabold tracking-[-0.02em]">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-[0.97rem] leading-relaxed text-muted">The plate or page may not exist, or the link was mistyped. Try searching for the plate number instead.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/plates" className="rounded-md bg-ink px-4 py-2.5 font-semibold text-surface hover:bg-accent hover:text-white">Search plates</Link>
          <Link href="/" className="rounded-md border border-line px-4 py-2.5 font-semibold hover:bg-card">Overview</Link>
        </div>
      </div>
    </div>
  );
}
