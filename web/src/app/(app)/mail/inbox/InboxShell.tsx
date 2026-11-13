"use client";

import Link from "next/link";
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, CheckCheck, Clock, EyeOff, Factory, FileText, Inbox, Mail, Menu, Plus, Send, ShieldAlert, Star, Trash2 } from "lucide-react";

// The Inbox's frame: a menu button (three lines) folds the labels on the left to a column of icons, as Gmail does; pressed again, the names come back.
// The folded column takes its own room (the list never sits over it) and every icon says its name when the pointer rests on it.
// The choice is remembered in the browser. Below the wide layout the labels are a row of chips and the button is not shown.

const KEY = "mail-rail";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); window.addEventListener("storage", cb); return () => { listeners.delete(cb); window.removeEventListener("storage", cb); }; };
const read = () => { try { return localStorage.getItem(KEY) === "closed"; } catch { return false; } };
const write = (closed: boolean) => { try { localStorage.setItem(KEY, closed ? "closed" : "open"); } catch { /* the choice is just not remembered */ } listeners.forEach((f) => f()); };

const ICONS = { inbox: Inbox, urgent: AlertCircle, followup: Clock, replied: CheckCheck, ignored: EyeOff, dispatch: Factory, starred: Star, sent: Send, drafts: FileText, all: Mail, spam: ShieldAlert, trash: Trash2 } as const;
export type RailItem = { key: keyof typeof ICONS; name: string; info: string; href: string; count: number; on: boolean };

export function InboxShell({ toolbar, items, admin, list, reader, reading }: { toolbar: ReactNode; items: RailItem[]; admin: boolean; list: ReactNode; reader: ReactNode; reading: boolean }) {
  const closed = useSyncExternalStore(subscribe, read, () => false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => write(!closed)} aria-label={closed ? "Show the label names" : "Fold the labels"} aria-pressed={!closed} title={closed ? "Show the label names" : "Fold the labels"}
          className="hidden rounded-full p-2 text-muted hover:bg-surface hover:text-ink xl:inline-flex"><Menu className="h-5 w-5" /></button>
        {toolbar}
      </div>

      <div className="grid gap-4 xl:[grid-template-columns:var(--rail)_minmax(0,27rem)_minmax(0,1fr)]" style={{ "--rail": closed ? "3rem" : "12.5rem" } as CSSProperties}>
        <nav aria-label="Mail labels" className={"flex gap-1 overflow-x-auto xl:flex-col xl:gap-1 xl:overflow-visible " + (reading ? "hidden xl:flex" : "")}>
          {admin && (
            <a href="/api/mail/google/connect" title="Add mailbox"
              className={"mb-1 hidden items-center rounded-2xl bg-brand-soft text-[0.9rem] font-semibold text-brand hover:bg-brand hover:text-white xl:flex " + (closed ? "h-10 w-10 justify-center" : "gap-3 px-3.5 py-3")}>
              <Plus className="h-5 w-5 shrink-0" />{!closed && <span className="whitespace-nowrap">Add mailbox</span>}
            </a>
          )}
          {items.map((l) => {
            const Icon = ICONS[l.key];
            return (
              <Link key={l.key} href={l.href} title={`${l.name}${l.count ? ` (${l.count.toLocaleString("en-IN")})` : ""}: ${l.info}`} aria-current={l.on ? "page" : undefined} aria-label={l.name}
                className={"relative flex shrink-0 items-center whitespace-nowrap rounded-full text-[0.9rem] gap-3 px-3.5 py-2 " + (closed ? "xl:h-10 xl:w-10 xl:justify-center xl:gap-0 xl:p-0 " : "") + (l.on ? "bg-brand-soft font-bold text-brand" : "text-ink hover:bg-surface")}>
                <Icon className="h-[1.1rem] w-[1.1rem] shrink-0" />
                <span className={"flex-1 " + (closed ? "xl:hidden" : "")}>{l.name}</span>
                {l.count > 0 && <span className={"text-[0.78rem] " + (l.on ? "font-bold" : "text-muted") + (closed ? " xl:hidden" : "")}>{l.count.toLocaleString("en-IN")}</span>}
                {closed && l.count > 0 && <span className="absolute right-0.5 top-0.5 hidden h-2 w-2 rounded-full bg-accent xl:block" aria-hidden />}
              </Link>
            );
          })}
        </nav>

        <section aria-label="Mails" className={(reading ? "hidden xl:block " : "block ") + "min-w-0 xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto"}>{list}</section>
        <section aria-label="Reading pane" className={"min-w-0 rounded-xl border border-line bg-card px-5 py-5 xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto " + (reading ? "block" : "hidden xl:block")}>{reader}</section>
      </div>
    </div>
  );
}
