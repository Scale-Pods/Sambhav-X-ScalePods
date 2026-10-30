import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import type { Filter } from "@/lib/filters";
import type { OrderParams } from "@/lib/orders";
import type { PayParams } from "@/lib/payments";

/** What every part of the Business overview is given: the period filter, the company choice for money and orders, and the address parameters to carry into links. */
export type OverviewProps = { f: Filter; pay: PayParams; ord: OrderParams; sp: Record<string, string | undefined> };

/** A link to another page that keeps the company and period the person has chosen. */
export function carry(sp: Record<string, string | undefined>, path: string, extra: Record<string, string> = {}, keys: string[] = ["entity", "p", "from", "to"]) {
  const u = new URLSearchParams(extra);
  keys.forEach((k) => sp[k] && u.set(k, sp[k]!));
  return `${path}${u.toString() ? "?" + u : ""}`;
}

export const ago = (min: number | null | undefined) => {
  if (min == null) return "never";
  return min < 2 ? "just now" : min < 90 ? `${min} minutes ago` : min < 2880 ? `${Math.round(min / 60)} hours ago` : `${Math.round(min / 1440)} days ago`;
};

/** One part of the page. Its heading, one line saying what it shows, and a link to the full page. */
export function Section({ id, title, hint, href, linkLabel, children }: { id: string; title: string; hint?: string; href?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5">
        <div>
          <h2 className="font-display text-[1.4rem] font-extrabold tracking-[-0.015em]">{title}</h2>
          {hint && <p className="mt-0.5 max-w-3xl text-[0.9rem] text-muted">{hint}</p>}
        </div>
        {href && <Link href={href} className="text-[0.9rem] font-medium text-brand hover:underline">{linkLabel ?? "Open the full page"} →</Link>}
      </div>
      {children}
    </section>
  );
}

/** A tile that opens its page. */
export function TileLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="block rounded-lg focus-visible:outline-2">{children}</Link>;
}

/** Runs one part of the page. If its data cannot be read, that part says so and the rest of the page still shows. */
export async function safe(name: string, render: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await render();
  } catch (e) {
    console.warn(`[overview] ${name}: ${(e as Error).message}`);
    return <Card><p className="px-5 py-8 text-center text-[0.92rem] text-muted">{name} could not be loaded just now. Reload the page to try again.</p></Card>;
  }
}

export const f0 = new Intl.NumberFormat("en-IN");
