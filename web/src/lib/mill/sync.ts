import "server-only";
import { serviceQuery } from "../db";
import { unseal } from "../mail/crypto";
import { accessToken, attachmentText, collect, gmail, header, type Message } from "../mail/google";
import { readDispatch, type DispatchRead } from "./dispatchTable";

// The mail sync: look in a connected mailbox for the mill's "Dispatch details" mails, read the table in each, and leave a SUGGESTION for a person to approve.
// Nothing here adds stock. Each mail is stored once (the mailbox's Gmail id is unique), so running the sync again and again is safe.

const MAX_PER_RUN = 20;
const MAX_TEXT = 1_500_000;
const MAX_ATTACHMENT = 3_000_000;

type Box = { mailbox_id: string; address: string; token_enc: string; sender_filter: string; subject_filter: string };
export type SyncResult = { address: string; looked_at: number; new_mails: number; suggestions: number; error?: string };

const esc = (s: string) => s.replace(/["\\]/g, " ").trim();

/** Of everything a mail carries (attachments, then the body), the reading with the most rows wins: a forwarded body may be cut short while its attachment is whole. */
async function bestReading(token: string, m: Message): Promise<{ read: DispatchRead; kind: "attachment_html" | "attachment_text" | "body_html" | "body_text" | null; source: string; names: string[] }> {
  const f = collect(m.payload);
  const names = f.files.map((x) => x.name);
  const tries: { kind: "attachment_html" | "attachment_text" | "body_html" | "body_text"; html?: string; text?: string }[] = [];
  for (const file of f.files) {
    const isHtml = /\.html?$/i.test(file.name) || file.mime === "text/html";
    const isText = /\.(txt|csv)$/i.test(file.name) || file.mime === "text/plain";
    if ((!isHtml && !isText) || file.size > MAX_ATTACHMENT) continue;
    const body = await attachmentText(token, m.id, file.attachmentId).catch(() => "");
    if (body) tries.push(isHtml ? { kind: "attachment_html", html: body } : { kind: "attachment_text", text: body });
  }
  f.html.forEach((h) => tries.push({ kind: "body_html", html: h }));
  f.text.forEach((t) => tries.push({ kind: "body_text", text: t }));
  let best: { read: DispatchRead; kind: (typeof tries)[number]["kind"] | null; source: string } = { read: readDispatch({}), kind: null, source: "" };
  for (const t of tries) {
    const read = readDispatch({ html: t.html, text: t.text });
    if (read.rows.length > best.read.rows.length) best = { read, kind: t.kind, source: (t.html ?? t.text ?? "").slice(0, MAX_TEXT) };
  }
  return { ...best, names };
}

export async function syncMailbox(box: Box): Promise<SyncResult> {
  const result: SyncResult = { address: box.address, looked_at: 0, new_mails: 0, suggestions: 0 };
  try {
    const token = await accessToken(unseal(box.token_enc));
    // Gmail matches whole words, so "dispatch detail" would miss "Dispatch details-test" or "dispatch detaildispatch detail" (a real subject): Gmail is asked for the first word only,
    // and the full wording is checked here on each subject, ignoring case, as a part of the subject.
    const wanted = (box.subject_filter || "dispatch detail").trim().toLowerCase();
    const q = [`subject:${esc(wanted.split(/\s+/)[0])}`, box.sender_filter.trim() ? `from:(${esc(box.sender_filter)})` : "", "newer_than:90d"].filter(Boolean).join(" ");
    const list = await gmail<{ messages?: { id: string }[] }>(token, "/messages", { q, maxResults: "50" });
    const ids = (list.messages ?? []).map((x) => x.id);
    result.looked_at = ids.length;
    const known = ids.length ? new Set((await serviceQuery<{ gmail_id: string }>(`select gmail_id from public.mill_mails where mailbox_id = $1 and gmail_id = any($2::text[])`, [box.mailbox_id, ids])).map((r) => r.gmail_id)) : new Set<string>();
    for (const id of ids.filter((x) => !known.has(x)).slice(0, MAX_PER_RUN * 2)) {
      if (result.new_mails >= MAX_PER_RUN) break;
      const head = await gmail<Message>(token, `/messages/${id}`, { format: "metadata", metadataHeaders: "Subject" });
      if (!(header(head, "Subject") ?? "").toLowerCase().includes(wanted)) continue; // not a dispatch mail after all
      const m = await gmail<Message>(token, `/messages/${id}`, { format: "full" });
      const { read, kind, source, names } = await bestReading(token, m);
      const from = header(m, "From") ?? "";
      const fromName = from.replace(/<.*$/, "").replace(/["']/g, "").trim() || null;
      const fromAddr = /<([^>]+)>/.exec(from)?.[1] ?? (from.includes("@") ? from.trim() : null);
      const received = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null;
      const [saved] = await serviceQuery<{ id: string }>(
        `insert into public.mill_mails (mailbox_id, gmail_id, thread_id, from_name, from_addr, subject, received_at, attachment_names, source_kind, source_text, status, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (mailbox_id, gmail_id) do nothing returning id`,
        [box.mailbox_id, id, m.threadId, fromName, fromAddr, (header(m, "Subject") ?? "").slice(0, 300), received, names, kind, source || null, read.rows.length ? "read" : "no_table", read.rows.length ? read.warnings.join("; ") || null : "no dispatch table was found in this mail"]);
      if (!saved) continue;
      result.new_mails++;
      if (!read.rows.length) continue;
      // plates the books already hold, or that wait in an earlier mail (same mill invoice item), are flagged; a mail with nothing new is set aside by itself
      const items = read.rows.map((r) => r.invoice_item).filter((x): x is string => Boolean(x));
      const have = new Set((await serviceQuery<{ invoice_item: string }>(`select invoice_item from public.mill_receipt_lines where invoice_item = any($1::text[])`, [items])).map((r) => r.invoice_item));
      const waiting = new Set((await serviceQuery<{ invoice_item: string }>(
        `select distinct x->>'invoice_item' invoice_item from public.mill_receipts r, jsonb_array_elements(r.rows) x where r.status = 'pending' and x->>'invoice_item' = any($1::text[])`, [items])).map((r) => r.invoice_item));
      for (const r of read.rows) {
        if (r.invoice_item && have.has(r.invoice_item)) r.warnings.push("already received from an earlier mail");
        else if (r.invoice_item && waiting.has(r.invoice_item)) r.warnings.push("the same plates are already waiting in an earlier mail");
      }
      const allKnown = read.rows.every((r) => r.invoice_item && (have.has(r.invoice_item) || waiting.has(r.invoice_item)));
      const isTest = read.rows.every((r) => (r.batch ?? "").startsWith("TEST"));
      await serviceQuery(
        `insert into public.mill_receipts (message_id, status, rows, consignments, totals, warnings, is_test, note) values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8)`,
        [saved.id, allKnown ? "rejected" : "pending", JSON.stringify(read.rows), JSON.stringify(read.consignments), JSON.stringify(read.totals), JSON.stringify(read.warnings), isTest, allKnown ? "set aside by the system: every plate in this mail was already received or is already waiting in an earlier mail" : null]);
      if (!allKnown) result.suggestions++;
    }
    await serviceQuery(`update public.mailboxes set last_synced_at = now() where id = $1`, [box.mailbox_id]);
    await serviceQuery(`update public.mailbox_tokens set last_error = null where mailbox_id = $1`, [box.mailbox_id]);
  } catch (e) {
    result.error = e instanceof Error ? e.message.slice(0, 300) : "failed";
    await serviceQuery(`update public.mailbox_tokens set last_error = $2 where mailbox_id = $1`, [box.mailbox_id, result.error]).catch(() => {});
  }
  return result;
}

/** Every active mailbox that has a Google login. */
export async function syncAll(): Promise<SyncResult[]> {
  const boxes = await serviceQuery<Box>(
    `select m.id mailbox_id, m.address, t.token_enc, t.sender_filter, t.subject_filter from public.mailboxes m join public.mailbox_tokens t on t.mailbox_id = m.id where m.active`);
  const out: SyncResult[] = [];
  for (const b of boxes) out.push(await syncMailbox(b));
  return out;
}
