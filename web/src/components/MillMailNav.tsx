import { Bell } from "lucide-react";
import Link from "next/link";
import { q } from "@/lib/db";

/** How many mill mails wait for someone to approve them (0 if the list cannot be read). */
async function waiting(): Promise<number> {
  try { return Number((await q<{ n: number }>(`select count(*)::int n from public.mill_receipts where status = 'pending'`))[0]?.n ?? 0); } catch { return 0; }
}

/** The bell in the top bar: a number on it when a mill mail waits for approval. */
export async function MillMailBell() {
  const n = await waiting();
  return (
    <Link href="/mail/dispatch" className="relative rounded-full p-2 text-muted hover:bg-surface hover:text-ink" title={n > 0 ? `${n} mill mail${n === 1 ? "" : "s"} waiting for approval` : "No mill mails waiting"} aria-label={n > 0 ? `${n} mill mails waiting for approval` : "Mill mails"}>
      <Bell className="h-[1.1rem] w-[1.1rem]" />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-accent px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white">{n}</span>}
    </Link>
  );
}
