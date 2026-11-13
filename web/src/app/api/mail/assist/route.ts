import { NextResponse, type NextRequest } from "next/server";
import { canSeeBusiness, canUploadDocs, currentStaff } from "@/lib/auth";
import { complete, refineSystem, summariseSystem, tidy, writeSystem } from "@/lib/mail/assist";
import { getThread, liveMailboxes } from "@/lib/mail/live";
import { htmlToText } from "@/lib/mail/mime";

const UUID = /^[0-9a-f-]{36}$/i;
const THREAD = /^[0-9a-f]{8,40}$/i;
const used = new Map<string, number[]>(); // 60 AI requests an hour per person

const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/** The AI help of the mail window: "write" (a mail from a few words), "refine" (change what a person wrote) and "summarise" (a conversation). Nothing is sent or saved: the answer goes back to the person. */
export async function POST(req: NextRequest) {
  const me = await currentStaff().catch(() => null);
  if (!me || !canSeeBusiness(me.role)) return fail("Not allowed", 403);
  const b = (await req.json().catch(() => null)) as { mode?: string; mb?: string; threadId?: string; instruction?: string; text?: string; original?: string; subject?: string } | null;
  if (!b || !["write", "refine", "summarise"].includes(b.mode ?? "")) return fail("Bad request");
  if (b.mode !== "summarise" && !canUploadDocs(me.role)) return fail("Your login may read mail but not write it.", 403);
  const now = Date.now(), recent = (used.get(me.id) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 60) return fail("That is the limit of 60 AI requests an hour. Try again later.", 429);
  used.set(me.id, [...recent, now]);
  try {
    if (b.mode === "summarise") {
      if (!b.mb || !UUID.test(b.mb) || !b.threadId || !THREAD.test(b.threadId)) return fail("Bad request");
      const box = (await liveMailboxes()).find((x) => x.id === b.mb);
      if (!box) return fail("That mailbox is not connected.", 404);
      const t = await getThread(box.id, b.threadId, box.address);
      const body = t.messages.map((m) => `From: ${m.from.name} <${m.from.addr}>\nDate: ${m.at}\n${(m.text ?? htmlToText(m.html ?? "")).slice(0, 6000)}`).join("\n\n----\n\n").slice(0, 36_000);
      const r = await complete(summariseSystem, `Subject: ${t.subject}\n\n<mail>\n${body}\n</mail>`, 700);
      return NextResponse.json({ ok: true, text: tidy(r.text), model: r.model, usd: r.usd });
    }
    const instruction = clip(b.instruction, 800).trim();
    if (b.mode === "refine") {
      const text = clip(b.text, 12_000).trim();
      if (!text || !instruction) return fail("There is nothing to change yet.");
      const r = await complete(refineSystem, `Instruction: ${instruction}\n\n<mail>\n${text}\n</mail>`, 1500);
      return NextResponse.json({ ok: true, html: tidy(r.text), model: r.model, usd: r.usd });
    }
    const original = clip(b.original, 12_000).trim();
    const subject = clip(b.subject, 300).trim();
    const user = [instruction ? `What the e-mail should say: ${instruction}` : "Write a suitable reply to the mail below.", subject ? `Subject: ${subject}` : "", original ? `The mail being answered:\n<mail>\n${original}\n</mail>` : ""].filter(Boolean).join("\n\n");
    if (!instruction && !original) return fail("Say what the mail should be about.");
    const r = await complete(writeSystem(me.full_name || "Accounts Department"), user, 1500);
    return NextResponse.json({ ok: true, html: tidy(r.text), model: r.model, usd: r.usd });
  } catch (e) {
    return fail(e instanceof Error && /No AI key/.test(e.message) ? "No AI key is set on the server." : "The AI could not answer. Please try again.", 502);
  }
}
