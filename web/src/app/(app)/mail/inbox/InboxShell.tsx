"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { AlertCircle, CheckCheck, Clock, EyeOff, Factory, Inbox, Menu } from "lucide-react";

// The Inbox's frame: a menu button (three lines) that folds the labels on the left to icons, as Gmail does. Folded, the labels open again while the pointer is on them.
// The choice is remembered in the browser. Below the wide layout the labels are a row of chips and the button is not shown.

const KEY = "mail-rail";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); window.addEventListener("storage", cb); return () => { listeners.delete(cb); window.removeEventListener("storage", cb); }; };
const read = () => { try { return localStorage.getItem(KEY) === "closed"; } catch { return false; } };
const write = (closed: boolean) => { try { localStorage.setItem(KEY, closed ? "closed" : "open"); } catch { /* the choice is just not remembered */ } listeners.forEach((f) => f()); };

const ICONS = { inbox: Inbox, urgent: AlertCircle, followup: Clock, replied: CheckCheck, ignored: EyeOff, dispatch: Factory } as const;
export type RailItem = { key: keyof typeof ICONS; name: string; info: string; href: string; count: number; on: boolean };

export function InboxShell({ toolbar, items, admin, list, reader, reading }: { toolbar: ReactNode; items: RailItem[]; admin: boolean; list: ReactNode; reader: ReactNode; reading: boolean }) {
  const closed = useSyncExternalStore(subscribe, read, () => false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => write(!closed)} aria-label={closed ? "Show the labels" : "Hide the labels"} aria-pressed={!closed} title={closed ? "Show the labels" : "Hide the labels"}
          className="hidden rounded-full p-2 text-muted hover:bg-surface hover:text-ink xl:inline-flex"><Menu className="h-5 w-5" /></button>
        {toolbar}
      </div>

      <div className="grid gap-4 xl:[grid-template-columns:var(--rail)_minmax(0,27rem)_minmax(0,1fr)]" style={{ "--rail": closed ? "3.25rem" : "12.5rem" } as React.CSSProperties}>
        {/* the labels: full width, or icons that open while the pointer is on them */}
        <div className={"relative " + (reading ? "hidden xl:block" : "")}>
          <nav aria-label="Mail labels"
            className={"flex gap-1 overflow-x-auto xl:absolute xl:inset-y-0 xl:left-0 xl:z-20 xl:flex-col xl:gap-0.5 xl:overflow-hidden xl:rounded-xl xl:bg-surface/0 xl:transition-[width,box-shadow] xl:duration-150 " + (closed ? "xl:w-[3.25rem] xl:hover:w-52 xl:hover:bg-card xl:hover:shadow-lg xl:hover:ring-1 xl:hover:ring-line" : "xl:w-full")}>
            {admin && (
              <a href="/api/mail/google/connect" title="Add mailbox" className="mb-1 hidden items-center gap-3 rounded-2xl bg-brand-soft px-3.5 py-3 text-[0.9rem] font-semibold text-brand hover:bg-brand hover:text-white xl:flex">
                <span className="w-5 shrink-0 text-center text-lg leading-none">+</span><span className="whitespace-nowrap">Add mailbox</span>
              </a>
            )}
            {items.map((l) => {
              const Icon = ICONS[l.key];
              return (
                <Link key={l.key} href={l.href} title={l.info} aria-current={l.on ? "page" : undefined}
                  className={"flex shrink-0 items-center gap-3 whitespace-nowrap rounded-full px-3.5 py-2 text-[0.9rem] " + (l.on ? "bg-brand-soft font-bold text-brand" : "text-ink hover:bg-surface")}>
                  <Icon className="h-[1.1rem] w-[1.1rem] shrink-0" />
                  <span className="flex-1">{l.name}</span>
                  {l.count > 0 && <span className={"text-[0.78rem] " + (l.on ? "font-bold" : "text-muted")}>{l.count.toLocaleString("en-IN")}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        <section aria-label="Mails" className={(reading ? "hidden xl:block " : "block ") + "xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto"}>{list}</section>
        <section aria-label="Reading pane" className={"min-w-0 rounded-xl border border-line bg-card px-5 py-5 xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto " + (reading ? "block" : "hidden xl:block")}>{reader}</section>
      </div>
    </div>
  );
}
